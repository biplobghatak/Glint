/**
 * The marketing surface runs on an art-directed, fixed palette that is
 * deliberately independent of the app theme, so the screen/paper duotone always
 * reads the same way. Every marketing page mounts this once, inside `.gl-root`.
 *
 * Band rule: `gl-screen` and `gl-paper` sections alternate, never two of the
 * same in a row. Adding a section means finding it a slot that keeps the
 * alternation intact.
 */
export const marketingCss = `
.gl-root {
  --ink: #0B1512;
  --ink-2: #10201A;
  --paper: #F4F7F4;
  --paper-2: #EAF0EB;
  --snow: #EFF4F0;
  --fog: #9DB0A6;
  --ink-mute: #5A6B62;
  --green: #37D07E;
  --amber: #E3B23C;
  --slate: #7C8A83;
  --line-dark: rgba(255,255,255,0.09);
  --line-lite: rgba(11,21,18,0.10);
  --max: 1140px;

  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}
.gl-root *,
.gl-root *::before,
.gl-root *::after { box-sizing: border-box; }
.gl-root :focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 3px;
  border-radius: 4px;
}
.gl-mono { font-family: var(--font-mono); font-feature-settings: "tnum" 1; }
.gl-display { font-family: var(--font-heading); }

/* ── Band shells ─────────────────────────────── */
.gl-screen { background: var(--ink); color: var(--snow); }
.gl-paper { background: var(--paper); color: var(--ink); }
.gl-band { max-width: var(--max); margin: 0 auto; padding: 0 24px; }
.gl-section { padding: 96px 0; }

/* ── Nav ─────────────────────────────────────── */
.gl-nav {
  max-width: var(--max);
  margin: 0 auto;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gl-wordmark {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 21px; letter-spacing: -0.03em;
  color: var(--ink); text-decoration: none;
}
.gl-dot { color: var(--green); }
.gl-nav-links { display: flex; align-items: center; gap: 26px; }
.gl-navlink { font-size: 14px; color: var(--ink-mute); text-decoration: none; transition: color .15s ease; }
.gl-navlink:hover { color: var(--ink); }

/* ── Hero ────────────────────────────────────── */
.gl-hero { padding-top: 8px; padding-bottom: 92px; position: relative; }
.gl-hero::before {
  /* faint green glow behind the stream */
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(60% 55% at 78% 42%, rgba(55,208,126,0.14), transparent 70%);
}
.gl-hero-inner {
  position: relative;
  max-width: var(--max); margin: 0 auto; padding: 48px 24px 0;
  display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr); gap: 60px; align-items: center;
}
.gl-hero-copy { min-width: 0; }
.gl-eyebrow {
  font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--green); margin: 0 0 22px;
}
.gl-h1 {
  font-weight: 800; letter-spacing: -0.035em; line-height: 0.98;
  font-size: clamp(2.6rem, 5.4vw, 4.3rem); margin: 0 0 24px;
  color: var(--snow);
}
.gl-sub {
  font-size: clamp(1rem, 1.35vw, 1.16rem); line-height: 1.62;
  color: var(--fog); max-width: 40ch; margin: 0 0 34px;
}
.gl-cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 30px; }

.gl-trust { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0; padding: 0; }
.gl-trust-item { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fog); }
.gl-check {
  width: 15px; height: 15px; border-radius: 999px; flex: none;
  background: rgba(55,208,126,0.14);
  border: 1px solid rgba(55,208,126,0.5);
  position: relative;
}
.gl-check::after {
  content: ""; position: absolute; left: 4px; top: 3.5px;
  width: 4px; height: 7px; border: solid var(--green);
  border-width: 0 1.6px 1.6px 0; transform: rotate(42deg);
}

/* ── Demo panel (the signature) ──────────────── */
.gl-demo {
  min-width: 0;
  background: linear-gradient(180deg, #0d1a15, var(--ink));
  border: 1px solid var(--line-dark);
  border-radius: 20px; padding: 14px;
  box-shadow: 0 40px 80px -40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04);
}
.gl-demo-bar {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: var(--fog); padding: 6px 8px 16px;
}
.gl-demo-url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gl-inbox-pill {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--green);
  background: rgba(55,208,126,0.1); border: 1px solid rgba(55,208,126,0.35);
  padding: 4px 10px; border-radius: 999px;
  opacity: 0; animation: gl-pop .5s ease both; animation-delay: 2.4s;
}
.gl-inbox-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--green); }
.gl-live-dot {
  width: 8px; height: 8px; border-radius: 999px; background: var(--green); flex: none;
  box-shadow: 0 0 0 0 rgba(55,208,126,0.6); animation: gl-pulse 2.4s infinite;
}
.gl-feed { display: flex; flex-direction: column; gap: 10px; }
.gl-card {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  background: var(--ink-2); border: 1px solid var(--line-dark);
  border-radius: 13px; padding: 14px 16px;
  opacity: 0; animation: gl-rise .55s ease both; animation-delay: calc(var(--s) * 0.28s);
}
.gl-avatar {
  flex: none; width: 40px; height: 40px; border-radius: 999px;
  display: grid; place-items: center;
  font-size: 13px; color: var(--snow);
  background: linear-gradient(140deg, #1d3b30, #16261f);
  border: 1px solid var(--line-dark);
}
.gl-avatar-lg { width: 46px; height: 46px; font-size: 14px; }
.gl-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gl-name { color: var(--snow); font-size: 14px; font-weight: 600; }
.gl-name-lg { font-size: 15.5px; }
.gl-headline { color: var(--fog); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-badge {
  margin-left: auto; flex: none;
  font-size: 13px; font-weight: 700; padding: 4px 11px; border-radius: 999px;
  opacity: 0; animation: gl-pop .4s ease both; animation-delay: calc(var(--s) * 0.28s + 0.5s);
}
.gl-hi { color: #052e18; background: var(--green); }
.gl-mid { color: #2b1f00; background: var(--amber); }
.gl-lo { color: var(--snow); background: rgba(124,138,131,0.35); border: 1px solid var(--line-dark); }
.gl-glint {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 32%, rgba(255,255,255,0.18) 48%, transparent 62%);
  transform: translateX(-130%);
  animation: gl-sweep .9s ease both; animation-delay: calc(var(--s) * 0.28s + 0.2s);
}

/* ── Section headings ────────────────────────── */
.gl-kicker { font-size: 12px; letter-spacing: 0.12em; color: var(--green); margin: 0 0 14px; }
.gl-h2 {
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.04;
  font-size: clamp(1.9rem, 3.6vw, 2.7rem); margin: 0; color: var(--ink); max-width: 18ch;
}
.gl-h2-light { color: var(--snow); }

/* ── Problem → Solution ──────────────────────── */
/* Paper is the semantic home for this one: the light band is the world of
   exported lists and spreadsheets. The old-way column carries no green at all,
   which argues the point before a word is read. */
.gl-ps-lede { font-size: 1.06rem; line-height: 1.6; color: var(--ink-mute); margin: 22px 0 44px; max-width: 48ch; }
.gl-ps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.gl-ps-col { min-width: 0; border-radius: 16px; padding: 28px 26px; }
.gl-ps-old { background: var(--paper-2); border: 1px solid var(--line-lite); }
.gl-ps-new {
  background: #fff; border: 1px solid rgba(55,208,126,0.42);
  box-shadow: 0 24px 56px -40px rgba(11,21,18,0.45);
}
.gl-ps-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 22px; }
.gl-ps-old .gl-ps-label { color: var(--slate); }
.gl-ps-new .gl-ps-label { color: var(--green); }
.gl-ps-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 17px; }
.gl-ps-item { display: flex; align-items: flex-start; gap: 12px; font-size: 14.5px; line-height: 1.56; }
.gl-ps-old .gl-ps-item { color: var(--slate); }
.gl-ps-new .gl-ps-item { color: var(--ink); }
.gl-dash { margin-top: 10px; width: 12px; height: 1.5px; flex: none; background: var(--slate); opacity: 0.6; }

/* ── Anatomy of a score ──────────────────────── */
.gl-anatomy {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center;
}
.gl-anatomy-copy { min-width: 0; }
.gl-anatomy-sub { font-size: 1.05rem; line-height: 1.62; color: var(--fog); margin: 22px 0 26px; max-width: 42ch; }
.gl-legend { display: flex; flex-direction: column; gap: 10px; }
.gl-legend-item { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--fog); }
.gl-swatch { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.gl-sw-hi { background: var(--green); }
.gl-sw-mid { background: var(--amber); }
.gl-sw-lo { background: var(--slate); }

.gl-anatomy-card {
  min-width: 0;
  margin: 0; background: linear-gradient(180deg, #0e1c16, var(--ink-2));
  border: 1px solid var(--line-dark); border-radius: 18px; padding: 22px;
  box-shadow: 0 40px 80px -44px rgba(0,0,0,0.7);
}
.gl-ac-head { display: flex; align-items: center; gap: 14px; padding-bottom: 20px; border-bottom: 1px solid var(--line-dark); }
.gl-source {
  margin-left: auto; flex: none; font-size: 11px; color: var(--fog);
  border: 1px solid var(--line-dark); border-radius: 6px; padding: 3px 9px; letter-spacing: 0.04em;
}
.gl-meter { padding: 22px 0; }
.gl-meter-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.gl-meter-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fog); }
.gl-meter-num { font-size: 40px; font-weight: 700; color: var(--green); letter-spacing: -0.02em; line-height: 1; }
.gl-track {
  position: relative; height: 12px; border-radius: 999px; overflow: hidden;
  display: flex; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
}
.gl-track-zone { height: 100%; }
.gl-tz-lo { flex: 50; background: rgba(124,138,131,0.28); }
.gl-tz-mid { flex: 30; background: rgba(227,178,60,0.34); }
.gl-tz-hi { flex: 20; background: rgba(55,208,126,0.45); }
.gl-track-marker {
  position: absolute; top: 50%; left: var(--v);
  width: 4px; height: 22px; border-radius: 2px; background: var(--snow);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px rgba(11,21,18,0.7), 0 0 12px 1px rgba(55,208,126,0.8);
  animation: gl-slide 1s cubic-bezier(.2,.8,.2,1) both;
}
.gl-reasons { list-style: none; margin: 0; padding: 20px 0 0; border-top: 1px solid var(--line-dark); display: flex; flex-direction: column; gap: 12px; }
.gl-reason { display: flex; align-items: flex-start; gap: 11px; font-size: 13.5px; color: var(--snow); line-height: 1.4; }
.gl-reason-tick {
  margin-top: 2px; width: 16px; height: 16px; border-radius: 999px; flex: none;
  background: rgba(55,208,126,0.14); border: 1px solid rgba(55,208,126,0.5); position: relative;
}
.gl-reason-tick::after {
  content: ""; position: absolute; left: 4.5px; top: 3.5px;
  width: 4px; height: 7px; border: solid var(--green);
  border-width: 0 1.6px 1.6px 0; transform: rotate(42deg);
}

/* ── How it works ────────────────────────────── */
.gl-steps {
  list-style: none; margin: 48px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
}
.gl-step { border-top: 2px solid var(--ink); padding-top: 18px; }
.gl-step-n { display: block; font-size: 13px; font-weight: 600; color: var(--green); margin-bottom: 16px; letter-spacing: 0.04em; }
.gl-step-title { font-weight: 700; font-size: 1.16rem; letter-spacing: -0.01em; margin: 0 0 9px; color: var(--ink); }
.gl-step-body { font-size: 14.5px; line-height: 1.6; color: var(--ink-mute); margin: 0; }

/* ── Use cases ───────────────────────────────── */
/* Each card carries the ICP that persona would really write. That does double
   duty: it answers "is this for me" and teaches what an ICP looks like, which
   nothing else on the page demonstrates. */
.gl-uc-sub { font-size: 1.05rem; line-height: 1.62; color: var(--fog); margin: 22px 0 0; max-width: 46ch; }
.gl-uc { margin-top: 48px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
.gl-uc-card {
  min-width: 0; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #0e1c16, var(--ink-2));
  border: 1px solid var(--line-dark); border-radius: 16px; padding: 24px 22px;
}
.gl-uc-role { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--green); margin: 0 0 18px; }
.gl-uc-icp {
  margin: 0 0 18px; padding: 14px;
  border: 1px solid var(--line-dark); border-left: 2px solid var(--green);
  border-radius: 10px; background: rgba(255,255,255,0.03);
}
.gl-uc-icp-label { display: block; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fog); margin-bottom: 8px; }
.gl-uc-icp-text { font-size: 12.5px; line-height: 1.5; color: var(--snow); }
.gl-uc-body { font-size: 14px; line-height: 1.6; color: var(--fog); margin: auto 0 0; }

/* ── Safety ──────────────────────────────────── */
.gl-safety-lede { font-size: 1.06rem; line-height: 1.6; color: var(--ink-mute); margin: 22px 0 44px; max-width: 46ch; }
.gl-safety-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.gl-safe {
  background: #fff; border: 1px solid var(--line-lite);
  border-radius: 16px; padding: 26px 24px;
  box-shadow: 0 1px 0 rgba(11,21,18,0.03);
}
.gl-safe-title { font-weight: 700; font-size: 1.04rem; letter-spacing: -0.01em; margin: 0 0 10px; color: var(--ink); line-height: 1.25; }
.gl-safe-body { font-size: 14px; line-height: 1.62; color: var(--ink-mute); margin: 0; }

/* ── Pricing ─────────────────────────────────── */
.gl-tiers {
  margin-top: 48px;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;
  align-items: start;
}
.gl-tier {
  position: relative; min-width: 0;
  background: linear-gradient(180deg, #0e1c16, var(--ink-2));
  border: 1px solid var(--line-dark); border-radius: 18px; padding: 28px 24px;
  display: flex; flex-direction: column;
}
.gl-tier-on {
  border-color: rgba(55,208,126,0.55);
  box-shadow: 0 0 0 1px rgba(55,208,126,0.25), 0 30px 60px -34px rgba(55,208,126,0.4);
}
.gl-tier-flag {
  position: absolute; top: -11px; left: 24px;
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: #052e18; background: var(--green); padding: 4px 10px; border-radius: 999px;
}
.gl-tier-name { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fog); }
.gl-tier-price {
  font-family: var(--font-heading); font-weight: 800; letter-spacing: -0.03em;
  font-size: 2.7rem; color: var(--snow); margin: 12px 0 2px; line-height: 1;
}
.gl-tier-unit { font-family: var(--font-sans); font-weight: 500; font-size: 1rem; color: var(--fog); margin-left: 4px; }
.gl-tier-note { font-size: 13.5px; color: var(--fog); margin: 0 0 22px; }
.gl-tier-features { list-style: none; margin: 0 0 26px; padding: 22px 0 0; border-top: 1px solid var(--line-dark); display: flex; flex-direction: column; gap: 13px; flex: 1; }
.gl-tier-feat { display: flex; align-items: flex-start; gap: 11px; font-size: 13.5px; color: var(--snow); line-height: 1.4; }

/* ── FAQ ─────────────────────────────────────── */
.gl-faq-band { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 48px; align-items: start; }
.gl-faq-head { position: sticky; top: 32px; }
.gl-faq { border-top: 1px solid var(--line-lite); }
.gl-faq-item { border-bottom: 1px solid var(--line-lite); }
.gl-faq-q {
  list-style: none; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 20px 0; font-weight: 600; font-size: 1.05rem; color: var(--ink); letter-spacing: -0.01em;
}
.gl-faq-q::-webkit-details-marker { display: none; }
.gl-faq-mark {
  position: relative; flex: none; width: 16px; height: 16px;
}
.gl-faq-mark::before, .gl-faq-mark::after {
  content: ""; position: absolute; background: var(--green);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
}
.gl-faq-mark::before { width: 14px; height: 2px; }
.gl-faq-mark::after { width: 2px; height: 14px; transition: transform .2s ease; }
.gl-faq-item[open] .gl-faq-mark::after { transform: translate(-50%, -50%) scaleY(0); }
.gl-faq-a { margin: 0; padding: 0 40px 22px 0; font-size: 14.5px; line-height: 1.62; color: var(--ink-mute); }

/* ── Final CTA ───────────────────────────────── */
.gl-final { padding: 104px 0; position: relative; overflow: hidden; }
.gl-final::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(50% 80% at 50% 120%, rgba(55,208,126,0.18), transparent 70%);
}
.gl-final-inner { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
.gl-final-h {
  font-weight: 800; letter-spacing: -0.035em; line-height: 1.0;
  font-size: clamp(2rem, 4.6vw, 3.4rem); color: var(--snow);
  margin: 4px 0 32px; max-width: 16ch;
}
.gl-final-note { font-size: 12.5px; color: var(--fog); margin: 22px 0 0; letter-spacing: 0.02em; }

/* ── Masthead (sub-pages) ────────────────────── */
.gl-masthead { padding: 68px 0 76px; position: relative; overflow: hidden; }
.gl-masthead::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(52% 70% at 76% 30%, rgba(55,208,126,0.1), transparent 70%);
}
.gl-mast-inner { position: relative; }
.gl-mast-h {
  font-weight: 800; letter-spacing: -0.035em; line-height: 1.02;
  font-size: clamp(2.2rem, 4.4vw, 3.2rem); color: var(--snow);
  margin: 0 0 20px; max-width: 20ch;
}
.gl-mast-sub { font-size: 1.06rem; line-height: 1.62; color: var(--fog); max-width: 54ch; margin: 0; }
.gl-mast-meta { font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fog); margin: 30px 0 0; }

/* ── Prose (legal + about body copy) ─────────── */
.gl-prose { max-width: 72ch; padding: 76px 0 96px; }
.gl-prose > *:first-child { margin-top: 0; }
.gl-prose h2 {
  font-family: var(--font-heading); font-weight: 800; letter-spacing: -0.02em;
  font-size: 1.5rem; line-height: 1.2; color: var(--ink); margin: 54px 0 14px;
}
.gl-prose h3 { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; color: var(--ink); margin: 30px 0 8px; }
.gl-prose p { font-size: 15.5px; line-height: 1.72; color: var(--ink-mute); margin: 0 0 16px; }
.gl-prose ul { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 11px; }
.gl-prose li { position: relative; padding-left: 22px; font-size: 15px; line-height: 1.66; color: var(--ink-mute); }
.gl-prose li::before {
  content: ""; position: absolute; left: 2px; top: 10px;
  width: 7px; height: 7px; border-radius: 2px; background: var(--green); opacity: 0.55;
}
.gl-prose a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(55,208,126,0.65); }
.gl-prose strong { color: var(--ink); font-weight: 650; }
.gl-prose hr { border: 0; border-top: 1px solid var(--line-lite); margin: 54px 0; }

.gl-callout {
  background: #fff; border: 1px solid var(--line-lite); border-left: 2px solid var(--green);
  border-radius: 12px; padding: 20px 22px; margin: 0 0 26px;
}
.gl-callout > *:last-child { margin-bottom: 0; }

/* ── About ───────────────────────────────────── */
.gl-about-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 44px; }

/* ── Footer ──────────────────────────────────── */
.gl-footer { background: var(--paper); border-top: 1px solid var(--line-lite); }
.gl-foot-band { max-width: var(--max); margin: 0 auto; padding: 56px 24px 30px; }
.gl-foot-top { display: grid; grid-template-columns: 1.5fr 0.75fr 0.75fr; gap: 40px; }
.gl-foot-brand { min-width: 0; max-width: 36ch; }
.gl-foot-note { font-size: 13.5px; line-height: 1.6; color: var(--ink-mute); margin: 14px 0 0; }
.gl-foot-col-title { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--slate); margin: 0 0 18px; }
.gl-foot-links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.gl-foot-link { font-size: 14px; color: var(--ink-mute); text-decoration: none; transition: color .15s ease; }
.gl-foot-link:hover { color: var(--ink); }
.gl-foot-bottom {
  margin-top: 48px; padding-top: 22px; border-top: 1px solid var(--line-lite);
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.gl-foot-fine { font-size: 12.5px; color: var(--slate); margin: 0; }

/* ── Motion ──────────────────────────────────── */
@keyframes gl-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes gl-pop { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: none; } }
@keyframes gl-sweep { to { transform: translateX(130%); } }
@keyframes gl-slide { from { left: 0; } }
@keyframes gl-pulse {
  0% { box-shadow: 0 0 0 0 rgba(55,208,126,0.55); }
  70% { box-shadow: 0 0 0 7px rgba(55,208,126,0); }
  100% { box-shadow: 0 0 0 0 rgba(55,208,126,0); }
}

/* ── Responsive ──────────────────────────────── */
@media (max-width: 1040px) {
  .gl-uc { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .gl-hero-inner { grid-template-columns: minmax(0, 1fr); gap: 44px; }
  .gl-anatomy { grid-template-columns: minmax(0, 1fr); gap: 40px; }
  .gl-steps, .gl-safety-grid, .gl-about-grid { grid-template-columns: 1fr; }
  .gl-ps { grid-template-columns: minmax(0, 1fr); }
  .gl-tiers { grid-template-columns: minmax(0, 1fr); gap: 26px; }
  .gl-tier-features { flex: none; }
  .gl-faq-band { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .gl-faq-head { position: static; }
  .gl-section { padding: 72px 0; }
  .gl-nav-links { gap: 16px; }
  .gl-foot-top { grid-template-columns: minmax(0, 1fr); gap: 34px; }
  .gl-prose { padding: 56px 0 76px; }
}
@media (max-width: 640px) {
  .gl-uc { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .gl-nav-links .gl-navlink { display: none; }
  .gl-hero-inner { padding-top: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .gl-card, .gl-badge, .gl-glint, .gl-live-dot,
  .gl-inbox-pill, .gl-track-marker { animation: none !important; }
  .gl-card, .gl-badge, .gl-inbox-pill { opacity: 1 !important; }
  .gl-glint { display: none; }
}
`
