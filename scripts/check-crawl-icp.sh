#!/usr/bin/env bash
# Health check for the Crawl4AI service and the generate-icp Edge Function.
#
# Why this exists: generate-icp returns {"needs_manual_input": true} whenever a
# scrape yields fewer than MIN_CONTENT_LENGTH (200) characters. A dead crawl
# service and a genuinely contentless website are therefore indistinguishable
# from the outside. This probes the crawl service directly so the two can be
# told apart, and tests generate-icp's LLM path separately via fallback_text
# (which bypasses the crawler entirely).
#
# Usage:
#   scripts/check-crawl-icp.sh                 # probe crawl only (no Supabase needed)
#   scripts/check-crawl-icp.sh --icp           # also probe the deployed generate-icp
#   scripts/check-crawl-icp.sh --icp --local   # probe generate-icp on localhost:54321
#
# Config resolution, in order:
#   1. Environment variables already set in your shell
#   2. supabase/functions/generate-icp/.env
#
#   CRAWL_SERVICE_URL     e.g. https://crawl-service-production.up.railway.app
#   CRAWL_SERVICE_SECRET  bearer token the crawl service expects
#   SUPABASE_URL          only needed with --icp (defaults to the linked project)
#   SUPABASE_JWT          only needed with --icp; any valid JWT (service_role works),
#                         because generate-icp is deployed with verify_jwt = true
#
# Secrets are never printed. Exits non-zero if any probe fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/supabase/functions/generate-icp/.env"
# Must be a content-rich page: generate-icp treats anything under 200 scraped
# characters as needs_manual_input, so a thin page (example.com yields ~170)
# reads as a crawl failure when the crawler is actually fine.
PROBE_URL="${PROBE_URL:-https://stripe.com}"
TIMEOUT=35

WANT_ICP=0
USE_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --icp)   WANT_ICP=1 ;;
    --local) USE_LOCAL=1 ;;
    -h|--help) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

pass=0; fail=0; warn=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warn=$((warn+1)); }
info() { printf '        %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Read KEY from the env file without sourcing it (values may contain spaces/#).
from_env_file() {
  [ -f "$ENV_FILE" ] || return 1
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

CRAWL_SERVICE_URL="${CRAWL_SERVICE_URL:-$(from_env_file CRAWL_SERVICE_URL || true)}"
CRAWL_SERVICE_SECRET="${CRAWL_SERVICE_SECRET:-$(from_env_file CRAWL_SERVICE_SECRET || true)}"
CRAWL_SERVICE_URL="${CRAWL_SERVICE_URL%/}"   # strip trailing slash

# ---------------------------------------------------------------- crawl4ai ---
head_ "Crawl4AI service"

if [ -z "$CRAWL_SERVICE_URL" ]; then
  bad "CRAWL_SERVICE_URL is not set (checked \$CRAWL_SERVICE_URL and $ENV_FILE)"
  info "Set it to the deployed Railway URL, e.g."
  info "  CRAWL_SERVICE_URL=https://... CRAWL_SERVICE_SECRET=... $0"
else
  info "target: $CRAWL_SERVICE_URL"

  # A local address can't be the deployed service. Failing to reach it is a
  # stale-config problem, not an outage, so downgrade those to warnings —
  # otherwise this section screams FAIL while --icp proves the real service up.
  LOCAL_TARGET=0
  case "$CRAWL_SERVICE_URL" in
    *host.docker.internal*|*localhost*|*127.0.0.1*)
      LOCAL_TARGET=1
      note "URL points at a local address, so this section can only ever test a"
      info "local crawler. The custom FastAPI wrapper it once referred to was"
      info "deleted; only the deployed Crawl4AI server exists now. To probe that:"
      info "  CRAWL_SERVICE_URL=https://<railway-host> CRAWL_SERVICE_SECRET=... $0"
      info "Recover both from Railway (\`railway link\` then \`railway variables\`)"
      info "or from the Supabase dashboard's Edge Function secrets."
      ;;
  esac
  unreachable() { if [ "$LOCAL_TARGET" -eq 1 ]; then note "$1"; else bad "$1"; fi; }

  # 1. Reachability. Crawl4AI's server exposes /health.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$CRAWL_SERVICE_URL/health" 2>/dev/null)
  if [ "$code" = "200" ]; then
    ok "GET /health -> 200"
  elif [ -z "$code" ] || [ "$code" = "000" ]; then
    unreachable "GET /health -> unreachable (DNS, TLS, or connection refused)"
  else
    note "GET /health -> $code (service answered, but not 200)"
  fi

  # 2. Auth is actually enforced. An unauthenticated /md must not succeed.
  if [ -n "$CRAWL_SERVICE_SECRET" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
      -X POST "$CRAWL_SERVICE_URL/md" \
      -H 'Content-Type: application/json' \
      -d "{\"url\":\"$PROBE_URL\"}" 2>/dev/null)
    case "$code" in
      401|403) ok "POST /md without a token -> $code (auth enforced)" ;;
      200)     bad "POST /md without a token -> 200 (service is UNAUTHENTICATED)" ;;
      000|"")  unreachable "POST /md without a token -> unreachable" ;;
      *)       note "POST /md without a token -> $code" ;;
    esac
  else
    note "CRAWL_SERVICE_SECRET not set; skipping the auth-enforcement probe"
  fi

  # 3. The call generate-icp actually makes, with the same contract it expects:
  #    200 + {success: true, markdown: "..."}
  if [ -n "$CRAWL_SERVICE_SECRET" ]; then
    body=$(curl -s --max-time "$TIMEOUT" \
      -X POST "$CRAWL_SERVICE_URL/md" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $CRAWL_SERVICE_SECRET" \
      -d "{\"url\":\"$PROBE_URL\"}" 2>/dev/null)

    verdict=$(printf '%s' "$body" | python -c '
import sys, json
raw = sys.stdin.read()
if not raw.strip():
    print("EMPTY|no response body"); raise SystemExit
try:
    d = json.loads(raw)
except Exception:
    print("NONJSON|" + raw[:120].replace("\n", " ")); raise SystemExit
if not isinstance(d, dict):
    print("NONJSON|top-level JSON is not an object"); raise SystemExit
md = d.get("markdown")
if d.get("success") and isinstance(md, str):
    print(f"OK|{len(md)}")
else:
    print("SHAPE|success=%r markdown=%s" % (d.get("success"), type(md).__name__))
' 2>/dev/null)

    kind="${verdict%%|*}"; detail="${verdict#*|}"
    case "$kind" in
      OK)
        if [ "$detail" -ge 200 ] 2>/dev/null; then
          ok "POST /md ($PROBE_URL) -> success, ${detail} chars of markdown"
          info "generate-icp needs >= 200 chars; this would proceed to the LLM."
        else
          note "POST /md -> success but only ${detail} chars"
          info "Under generate-icp's MIN_CONTENT_LENGTH (200): it would return"
          info "needs_manual_input for this URL even though the crawler works."
        fi
        ;;
      SHAPE)   bad "POST /md -> 200 but wrong shape: $detail" ;;
      NONJSON) bad "POST /md -> non-JSON response: $detail" ;;
      EMPTY)   unreachable "POST /md -> empty response (timeout or bad token?)" ;;
      *)       bad "POST /md -> could not evaluate response" ;;
    esac
  fi
fi

# ------------------------------------------------------------- generate-icp ---
if [ "$WANT_ICP" -eq 1 ]; then
  head_ "generate-icp Edge Function"

  if [ "$USE_LOCAL" -eq 1 ]; then
    SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
  fi
  if [ -z "${SUPABASE_URL:-}" ]; then
    SUPABASE_URL=$(pnpm exec supabase projects list --output json 2>/dev/null | python -c '
import sys, json
d = json.load(sys.stdin)
ps = d["projects"] if isinstance(d, dict) else d
for p in ps:
    if p.get("linked"):
        print("https://" + p["ref"] + ".supabase.co"); break
')
  fi
  if [ -z "${SUPABASE_JWT:-}" ]; then
    # generate-icp is deployed with verify_jwt = true; the service_role key is a
    # valid JWT and satisfies the gateway. Never printed.
    SUPABASE_JWT=$(pnpm exec supabase projects api-keys --output json 2>/dev/null | python -c '
import sys, json
print("".join(k["api_key"] for k in json.load(sys.stdin) if k["name"] == "service_role"))
' 2>/dev/null)
  fi

  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_JWT:-}" ]; then
    bad "need SUPABASE_URL and SUPABASE_JWT (or a linked Supabase project)"
  else
    info "target: $SUPABASE_URL/functions/v1/generate-icp"

    call_icp() { # $1 = json body -> prints "<http_code>|<body>"
      curl -s -w '\n%{http_code}' --max-time "$TIMEOUT" \
        -X POST "$SUPABASE_URL/functions/v1/generate-icp" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $SUPABASE_JWT" \
        -d "$1" 2>/dev/null | python -c '
import sys
p = sys.stdin.read().rsplit("\n", 1)
print((p[1] if len(p) > 1 else "000") + "|" + p[0])'
    }

    # A. LLM path in isolation. fallback_text bypasses the crawler, so a failure
    #    here is the model/provider, never the crawl service.
    long_text="We sell an AI sales assistant to B2B SaaS founders and heads of \
sales at seed to Series B startups. Our buyers struggle with low reply rates on \
cold outbound, spend hours manually researching prospects on LinkedIn, and \
cannot tell which leads actually match their ideal customer profile. They are \
technical, budget conscious, and buy self serve before talking to sales."
    res=$(call_icp "$(python -c '
import json, sys
print(json.dumps({"fallback_text": sys.argv[1]}))' "$long_text")")
    code="${res%%|*}"; body="${res#*|}"

    if [ "$code" = "200" ]; then
      shape=$(printf '%s' "$body" | python -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: print("NONJSON"); raise SystemExit
need = ("target_roles", "company_types", "pain_points", "raw_summary")
missing = [k for k in need if k not in d]
print("MISSING:" + ",".join(missing) if missing else "OK:" + str(len(d.get("target_roles") or [])))
' 2>/dev/null)
      case "$shape" in
        OK:*) ok "fallback_text -> 200, valid ICP (${shape#OK:} target roles). LLM path healthy." ;;
        MISSING:*) bad "fallback_text -> 200 but ICP is missing keys: ${shape#MISSING:}" ;;
        *) bad "fallback_text -> 200 but body was not JSON" ;;
      esac
    elif [ "$code" = "502" ]; then
      bad "fallback_text -> 502. The LLM call failed; the crawler is not involved."
      info "Check OPENROUTER_API_KEY on the deployed project, and note that the"
      info "live generate-icp may still be the OpenAI-era build reading OPENAI_API_KEY."
    elif [ "$code" = "401" ]; then
      bad "fallback_text -> 401. The JWT was rejected by the gateway."
    else
      bad "fallback_text -> $code"
      info "$(printf '%s' "$body" | head -c 160)"
    fi

    # B. Crawl path end-to-end, through the function.
    res=$(call_icp "$(python -c '
import json, sys
print(json.dumps({"website_url": sys.argv[1]}))' "$PROBE_URL")")
    code="${res%%|*}"; body="${res#*|}"

    if [ "$code" = "200" ]; then
      if printf '%s' "$body" | grep -q '"needs_manual_input"'; then
        note "website_url ($PROBE_URL) -> needs_manual_input"
        info "The scrape returned < 200 chars. Two very different causes:"
        info "  a) the deployed crawl service is down or misconfigured, or"
        info "  b) $PROBE_URL is genuinely too thin to scrape."
        info "Re-run against a known content-rich page to tell them apart:"
        info "  PROBE_URL=https://stripe.com $0 --icp"
        info "This path exercises the crawl service the DEPLOYED function uses,"
        info "which may differ from the local CRAWL_SERVICE_URL probed above."
      else
        ok "website_url -> 200 with a real ICP. Crawl + LLM healthy end to end."
        info "This proves the crawl service the deployed function uses is up,"
        info "regardless of what the local CRAWL_SERVICE_URL probe reported."
      fi
    else
      bad "website_url -> $code"
      info "$(printf '%s' "$body" | head -c 160)"
    fi
  fi
fi

# ----------------------------------------------------------------- summary ---
head_ "Summary"
printf '  %d passed, %d failed, %d warnings\n' "$pass" "$fail" "$warn"
if [ "$fail" -gt 0 ]; then
  printf '\n  Remember: generate-icp maps every crawl failure to "" and then to\n'
  printf '  needs_manual_input. A silent crawl outage looks exactly like a website\n'
  printf '  with no content, which is why the direct probe above exists.\n'
  exit 1
fi
exit 0
