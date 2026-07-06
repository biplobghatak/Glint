import Link from "next/link"

type Row = {
  initials: string
  name: string
  headline: string
  score: number
  delay: number
}

const FEED: Row[] = [
  { initials: "PN", name: "Priya N.", headline: "VP Sales · Series B SaaS", score: 92, delay: 0.2 },
  { initials: "CL", name: "Chen L.", headline: "Head of Growth · Fintech", score: 88, delay: 0.5 },
  { initials: "MD", name: "Marcus D.", headline: "Founder · 3-person agency", score: 74, delay: 0.8 },
  { initials: "SR", name: "Sam R.", headline: "Student · seeking internships", score: 19, delay: 1.1 },
]

function scoreTone(score: number): string {
  if (score >= 80) return "gl-hi"
  if (score >= 50) return "gl-mid"
  return "gl-lo"
}

const STEPS = [
  {
    n: "01",
    title: "Describe who you sell to",
    body: "Paste your website. Glint drafts your ideal customer — roles, company types, pain points — and you edit it in a minute.",
  },
  {
    n: "02",
    title: "Pair the extension",
    body: "Generate a code in Glint, paste it into the extension. No LinkedIn login, ever.",
  },
  {
    n: "03",
    title: "Browse like normal",
    body: "Search, scroll, open profiles. Glint scores what's on screen and syncs the strong matches to your inbox, live.",
  },
]

const SAFETY = [
  {
    title: "No LinkedIn credentials",
    body: "Glint never sees your login. It reads the page you're already viewing — nothing more.",
  },
  {
    title: "No bots, no scraping farms",
    body: "The extension is a passenger, not a driver. It never clicks, navigates, or opens tabs on its own.",
  },
  {
    title: "Your data, scoped to you",
    body: "Every lead is locked to your account with row-level security.",
  },
]

export function Landing() {
  return (
    <div className="gl-root">
      <style>{css}</style>

      <header className="gl-nav">
        <span className="gl-wordmark">
          Glint<span className="gl-dot">.</span>
        </span>
        <Link href="/login" className="gl-navlink">
          Sign in
        </Link>
      </header>

      <section className="gl-hero">
        <div className="gl-hero-copy">
          <p className="gl-eyebrow">Lead scoring, inline</p>
          <h1 className="gl-h1 font-heading">
            Your best leads are already on your screen.
          </h1>
          <p className="gl-sub">
            Glint reads the LinkedIn profiles and posts you&apos;re already
            looking at, scores each one against your ideal customer, and drops
            the strong matches into an inbox — with the context to reach out.
          </p>
          <div className="gl-cta-row">
            <Link href="/login" className="gl-cta gl-cta-primary">
              Start scoring <span aria-hidden>→</span>
            </Link>
            <a href="#how" className="gl-cta gl-cta-ghost">
              How it works
            </a>
          </div>
        </div>

        <div className="gl-demo" aria-hidden>
          <div className="gl-demo-bar">
            <span className="gl-live-dot" />
            linkedin.com/search
          </div>
          <div className="gl-feed">
            {FEED.map((r) => (
              <div key={r.initials} className="gl-card" style={{ ["--d" as string]: `${r.delay}s` }}>
                <span className="gl-avatar">{r.initials}</span>
                <div className="gl-card-text">
                  <span className="gl-name">{r.name}</span>
                  <span className="gl-headline">{r.headline}</span>
                </div>
                <span className={`gl-badge gl-mono ${scoreTone(r.score)}`}>
                  {r.score}
                </span>
                <span className="gl-glint" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="gl-section">
        <p className="gl-kicker gl-mono">/ setup</p>
        <h2 className="gl-h2 font-heading">Three steps, then it runs itself.</h2>
        <div className="gl-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="gl-step">
              <span className="gl-step-n gl-mono">{s.n}</span>
              <h3 className="gl-step-title font-heading">{s.title}</h3>
              <p className="gl-step-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="gl-section gl-section-muted">
        <p className="gl-kicker gl-mono">/ safety</p>
        <h2 className="gl-h2 font-heading">Built to keep your account yours.</h2>
        <div className="gl-safety">
          {SAFETY.map((s) => (
            <div key={s.title} className="gl-safe">
              <h3 className="gl-safe-title font-heading">{s.title}</h3>
              <p className="gl-safe-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="gl-final">
        <h2 className="gl-h2 font-heading">
          Turn today&apos;s browsing into tomorrow&apos;s pipeline.
        </h2>
        <Link href="/login" className="gl-cta gl-cta-primary">
          Start scoring <span aria-hidden>→</span>
        </Link>
      </section>

      <footer className="gl-footer">
        <span className="gl-wordmark">
          Glint<span className="gl-dot">.</span>
        </span>
        <span className="gl-foot-note">Score LinkedIn leads against your ICP as you browse.</span>
      </footer>
    </div>
  )
}

const css = `
.gl-root {
  --gl-ink: #0B1512;
  --gl-ink-2: #10201A;
  --gl-line: rgba(255,255,255,0.09);
  --gl-fog: #9DB0A6;
  --gl-snow: #EFF4F0;
  --gl-green: #37D07E;
  --gl-amber: #E3B23C;
  --gl-slate: #7C8A83;
  --gl-max: 1120px;
}
.gl-root :focus-visible {
  outline: 2px solid var(--gl-green);
  outline-offset: 3px;
  border-radius: 4px;
}

/* Nav */
.gl-nav {
  max-width: var(--gl-max);
  margin: 0 auto;
  padding: 24px 24px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gl-wordmark { font-family: var(--font-heading); font-weight: 800; font-size: 20px; letter-spacing: -0.02em; }
.gl-dot { color: var(--color-primary); }
.gl-navlink { font-size: 14px; color: var(--color-muted-foreground); text-decoration: none; }
.gl-navlink:hover { color: var(--color-foreground); }

/* Hero */
.gl-hero {
  max-width: var(--gl-max);
  margin: 0 auto;
  padding: 40px 24px 72px;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 56px;
  align-items: center;
}
.gl-eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--color-primary); margin: 0 0 20px;
}
.gl-h1 {
  font-weight: 800; letter-spacing: -0.035em; line-height: 0.98;
  font-size: clamp(2.5rem, 6vw, 4.1rem); margin: 0 0 22px;
  color: var(--color-foreground);
}
.gl-sub {
  font-size: clamp(1rem, 1.4vw, 1.15rem); line-height: 1.6;
  color: var(--color-muted-foreground); max-width: 34ch; margin: 0 0 32px;
}
.gl-cta-row { display: flex; flex-wrap: wrap; gap: 12px; }
.gl-cta {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600; text-decoration: none;
  padding: 12px 20px; border-radius: 999px; transition: transform .15s ease, background .15s ease;
}
.gl-cta:hover { transform: translateY(-1px); }
.gl-cta-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
.gl-cta-primary:hover { background: color-mix(in oklab, var(--color-primary) 88%, black); }
.gl-cta-ghost { color: var(--color-foreground); border: 1px solid var(--color-border); }
.gl-cta-ghost:hover { background: var(--color-muted); }

/* Demo panel — art-directed dark regardless of theme */
.gl-demo {
  background: var(--gl-ink);
  border: 1px solid var(--gl-line);
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 30px 60px -30px rgba(0,0,0,0.5);
}
.gl-demo-bar {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--font-mono); font-size: 12px; color: var(--gl-fog);
  padding: 4px 8px 14px;
}
.gl-live-dot {
  width: 8px; height: 8px; border-radius: 999px; background: var(--gl-green);
  box-shadow: 0 0 0 0 rgba(55,208,126,0.6); animation: gl-pulse 2.4s infinite;
}
.gl-feed { display: flex; flex-direction: column; gap: 10px; }
.gl-card {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  background: var(--gl-ink-2); border: 1px solid var(--gl-line);
  border-radius: 12px; padding: 14px 16px;
  animation: gl-rise .6s ease both; animation-delay: var(--d);
}
.gl-avatar {
  flex: none; width: 40px; height: 40px; border-radius: 999px;
  display: grid; place-items: center;
  font-family: var(--font-mono); font-size: 13px; color: var(--gl-snow);
  background: linear-gradient(140deg, #1d3b30, #16261f);
  border: 1px solid var(--gl-line);
}
.gl-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gl-name { color: var(--gl-snow); font-size: 14px; font-weight: 600; }
.gl-headline { color: var(--gl-fog); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-badge {
  margin-left: auto; flex: none;
  font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
  animation: gl-pop .4s ease both; animation-delay: calc(var(--d) + .45s);
}
.gl-hi { color: #052e18; background: var(--gl-green); }
.gl-mid { color: #2b1f00; background: var(--gl-amber); }
.gl-lo { color: var(--gl-snow); background: var(--gl-slate); }
.gl-glint {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.16) 48%, transparent 62%);
  transform: translateX(-120%);
  animation: gl-sweep 1s ease both; animation-delay: calc(var(--d) + .15s);
}
.gl-mono { font-family: var(--font-mono); }

/* Content sections */
.gl-section { max-width: var(--gl-max); margin: 0 auto; padding: 88px 24px; }
.gl-section-muted { max-width: none; background: var(--color-muted); }
.gl-section-muted > * { max-width: var(--gl-max); margin-left: auto; margin-right: auto; }
.gl-kicker { font-size: 12px; letter-spacing: 0.1em; color: var(--color-primary); margin: 0 0 14px; }
.gl-h2 {
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.05;
  font-size: clamp(1.8rem, 3.4vw, 2.6rem); margin: 0 0 48px;
  color: var(--color-foreground); max-width: 20ch;
}
.gl-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.gl-step { border-top: 1px solid var(--color-border); padding-top: 20px; }
.gl-step-n { display: block; font-size: 13px; color: var(--color-primary); margin-bottom: 14px; }
.gl-step-title { font-weight: 700; font-size: 1.15rem; letter-spacing: -0.01em; margin: 0 0 8px; color: var(--color-foreground); }
.gl-step-body { font-size: 14.5px; line-height: 1.6; color: var(--color-muted-foreground); margin: 0; }
.gl-safety { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.gl-safe {
  background: var(--color-background); border: 1px solid var(--color-border);
  border-radius: 14px; padding: 24px;
}
.gl-safe-title { font-weight: 700; font-size: 1.02rem; margin: 0 0 8px; color: var(--color-foreground); }
.gl-safe-body { font-size: 14px; line-height: 1.6; color: var(--color-muted-foreground); margin: 0; }

/* Final CTA */
.gl-final {
  max-width: var(--gl-max); margin: 0 auto; padding: 20px 24px 100px;
  display: flex; flex-direction: column; align-items: flex-start; gap: 28px;
}

/* Footer */
.gl-footer {
  border-top: 1px solid var(--color-border);
  max-width: var(--gl-max); margin: 0 auto; padding: 28px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.gl-foot-note { font-size: 13px; color: var(--color-muted-foreground); }

@keyframes gl-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes gl-pop { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: none; } }
@keyframes gl-sweep { to { transform: translateX(120%); } }
@keyframes gl-pulse {
  0% { box-shadow: 0 0 0 0 rgba(55,208,126,0.55); }
  70% { box-shadow: 0 0 0 7px rgba(55,208,126,0); }
  100% { box-shadow: 0 0 0 0 rgba(55,208,126,0); }
}

@media (max-width: 860px) {
  .gl-hero { grid-template-columns: 1fr; gap: 40px; padding-bottom: 48px; }
  .gl-steps, .gl-safety { grid-template-columns: 1fr; }
  .gl-section { padding: 64px 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .gl-card, .gl-badge, .gl-glint, .gl-live-dot { animation: none !important; }
  .gl-glint { display: none; }
}
`
