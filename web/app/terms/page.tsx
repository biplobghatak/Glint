import type { Metadata } from "next"

import { MarketingShell, Masthead } from "@/components/marketing/marketing-shell"

export const metadata: Metadata = {
  title: "Terms of Service · Glint",
  description:
    "The agreement between you and Glint — what we provide, what we ask of you, and where the limits sit.",
}

export default function TermsPage() {
  return (
    <MarketingShell>
      <Masthead
        kicker="/ terms"
        title="The deal, stated once and stated clearly."
        sub="These terms govern your use of Glint. They are written to be understood on one read, because terms nobody reads protect nobody."
        meta="Last updated · 10 July 2026"
      />

      <section className="gl-paper">
        <div className="gl-band gl-prose">
          <div className="gl-callout">
            <p>
              By creating a Glint account or installing the extension, you agree
              to these terms. If you do not agree, do not use Glint.
            </p>
          </div>

          <h2>1. What Glint is</h2>
          <p>
            Glint is a browser extension and web application that reads LinkedIn
            profiles and posts rendered in your own browser, scores them against
            an ideal customer profile you define, and saves the strong matches to
            an inbox in your account. Glint acts as a passenger: it reads what
            you are already viewing. It does not navigate, click, scroll, open
            tabs, send messages, or issue connection requests on your behalf.
          </p>

          <h2>2. Not affiliated with LinkedIn</h2>
          <p>
            Glint is an independent product. It is not affiliated with, endorsed
            by, sponsored by, or in any way officially connected to LinkedIn
            Corporation or Microsoft Corporation. LinkedIn is a trademark of
            LinkedIn Corporation, used here only to describe what Glint works
            with.
          </p>
          <p>
            <strong>
              You remain responsible for complying with the terms of service of
              any third-party website you browse while Glint is installed,
              including LinkedIn&apos;s.
            </strong>{" "}
            We have designed Glint to be passive and low-risk, but we cannot and
            do not guarantee that any third-party platform will permit its use,
            and we are not liable for any action a platform takes against your
            account.
          </p>

          <h2>3. Your account</h2>
          <p>
            You must be at least 18 years old and able to enter into a binding
            contract. You are responsible for the security of your credentials
            and for everything done under your account. Tell us promptly at{" "}
            <a href="mailto:biplob@weeziq.com">biplob@weeziq.com</a> if you
            believe your account has been compromised.
          </p>
          <p>
            One account is for one person. Seats on a team plan may not be shared
            between individuals.
          </p>

          <h2>4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>
              Resell, redistribute, or publish the lead data Glint produces, or
              contribute it to any shared or commercial database.
            </li>
            <li>
              Use Glint to harass, stalk, discriminate against, or endanger any
              person, or to contact anyone in violation of applicable
              anti-spam, privacy, or employment law.
            </li>
            <li>
              Attempt to reverse-engineer, decompile, or circumvent any technical
              limit of the service, including usage quotas.
            </li>
            <li>
              Automate, script, or otherwise drive Glint in a way that causes it
              to act on a third-party platform without a real person present.
            </li>
            <li>
              Interfere with the service&apos;s operation, security, or
              availability for other users.
            </li>
          </ul>
          <p>
            We may suspend or terminate an account that breaches this section,
            with notice where practical and without it where the breach is
            serious.
          </p>

          <h2>5. Data about other people</h2>
          <p>
            When you save a lead, you become responsible for the personal data of
            the person you saved. You represent that you have a lawful basis to
            store and use it, and that you will honor any request that person
            makes of you. Glint is a processor acting on your instructions in
            this respect, and our{" "}
            <a href="/privacy">privacy policy</a> describes how we handle it.
          </p>

          <h2>6. Plans, billing, and cancellation</h2>
          <p>
            Glint offers a free tier and paid subscriptions. Paid plans are
            billed in advance on a recurring basis and renew automatically until
            cancelled. Prices are shown on the{" "}
            <a href="/#pricing">pricing section</a> and are exclusive of any tax
            we are required to collect.
          </p>
          <p>
            You may cancel at any time from your account settings. Cancellation
            stops the next renewal; it does not retroactively refund the period
            you are in. If we change the price of a plan you are on, we will give
            you notice before it applies to you, and you may cancel rather than
            accept it.
          </p>
          <p>
            Free-tier limits, including the number of leads scored per month, may
            change as the service evolves.
          </p>

          <h2>7. Your content, and ours</h2>
          <p>
            Your ideal customer profiles, your leads, and everything else you put
            into Glint remain yours. You grant us only the licence necessary to
            store, process, and display that content back to you in order to
            operate the service.
          </p>
          <p>
            Glint&apos;s software, design, and brand remain ours. Nothing in
            these terms transfers ownership of them to you.
          </p>

          <h2>8. Scores are opinions, not facts</h2>
          <p>
            Scores and drafted openers are generated by a large language model.
            They are estimates offered to help you prioritise, and they can be
            wrong. Do not rely on a score as the sole basis for a hiring,
            lending, contracting, or other consequential decision about a person.
            You are responsible for the judgment you exercise and the messages you
            send.
          </p>

          <h2>9. Availability</h2>
          <p>
            We work to keep Glint running, but we do not promise uninterrupted
            service. Glint depends on third-party platforms whose pages change
            without notice, and a change on LinkedIn&apos;s side may degrade or
            break scoring until we adapt. We may modify, suspend, or discontinue
            any part of the service.
          </p>

          <h2>10. Warranties and liability</h2>
          <p>
            Glint is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
            without warranties of any kind, whether express or implied, including
            merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
          <p>
            To the fullest extent permitted by law, we are not liable for any
            indirect, incidental, special, consequential, or punitive damages, or
            for any loss of profits, revenue, data, or goodwill. Our total
            aggregate liability arising out of or relating to Glint will not
            exceed the greater of the amount you paid us in the twelve months
            before the claim arose, or one hundred US dollars.
          </p>
          <p>
            Some jurisdictions do not allow these exclusions. Where that is the
            case, they apply to you only to the extent permitted.
          </p>

          <h2>11. Indemnity</h2>
          <p>
            You agree to indemnify and hold us harmless from any claim arising out
            of your use of Glint, your breach of these terms, your violation of a
            third-party platform&apos;s terms, or your handling of personal data
            belonging to the people you save as leads.
          </p>

          <h2>12. Termination</h2>
          <p>
            You may stop using Glint and delete your account at any time. We may
            terminate or suspend your access if you breach these terms, or if we
            discontinue the service. On termination, your right to use Glint ends
            immediately; the sections that by their nature should survive —
            ownership, disclaimers, liability, indemnity — survive.
          </p>

          <h2>13. Changes to these terms</h2>
          <p>
            We may update these terms. If a change materially affects your rights,
            we will notify you by email or in the app before it takes effect.
            Continuing to use Glint after that means you accept the updated terms.
          </p>

          <h2>14. Governing law</h2>
          <p>
            These terms are governed by the laws of{" "}
            <strong>[JURISDICTION — to be set before launch]</strong>, without
            regard to conflict-of-law rules, and the courts of that jurisdiction
            have exclusive jurisdiction over any dispute arising from them.
          </p>

          <hr />

          <p>
            Anything here unclear or objectionable? Write to{" "}
            <a href="mailto:biplob@weeziq.com">biplob@weeziq.com</a> and we will
            explain or fix it.
          </p>
        </div>
      </section>
    </MarketingShell>
  )
}
