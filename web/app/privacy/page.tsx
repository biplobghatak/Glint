import type { Metadata } from "next"

import { MarketingShell, Masthead } from "@/components/marketing/marketing-shell"

export const metadata: Metadata = {
  title: "Privacy Policy · Glint",
  description:
    "What Glint collects, what it never touches, and who processes it. Your LinkedIn login is never one of them.",
}

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <Masthead
        kicker="/ privacy"
        title="What we hold, and what we never touch."
        sub="Glint is a tool you point at your own browser. That earns a policy written to be read, not to be skimmed past. Here is everything, in plain language."
        meta="Last updated · 10 July 2026"
      />

      <section className="gl-paper">
        <div className="gl-band gl-prose">
          <div className="gl-callout">
            <p>
              <strong>The short version.</strong> We never see your LinkedIn
              password or session. We never sell your data, and we never share
              it with advertisers, data brokers, or anyone building a lead
              database. The only third parties that touch it are the
              infrastructure providers listed below, who process it solely to
              make Glint work.
            </p>
          </div>

          <h2>Who we are</h2>
          <p>
            Glint (&ldquo;Glint&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a
            browser extension and web application that scores LinkedIn profiles
            and posts against an ideal customer profile you define. This policy
            explains what personal data we handle when you use it. Questions go
            to <a href="mailto:biplob@weeziq.com">biplob@weeziq.com</a>.
          </p>

          <h2>What we never collect</h2>
          <p>
            This is the part most people want first, so it goes first.
          </p>
          <ul>
            <li>
              <strong>Your LinkedIn credentials.</strong> Your LinkedIn session
              lives in your own browser and stays there. Glint never reads your
              password, your session cookie, or your authentication tokens, and
              nothing about your LinkedIn login is ever transmitted to us.
            </li>
            <li>
              <strong>Your browsing history.</strong> Glint activates only on
              LinkedIn pages. It does not record, report, or care about any
              other site you visit.
            </li>
            <li>
              <strong>Your private messages.</strong> Glint does not read your
              LinkedIn inbox, and it never sends a message or connection request
              on your behalf. When it drafts an opener, that draft is placed in
              the input box for you to edit and send yourself.
            </li>
          </ul>

          <h2>What we collect</h2>

          <h3>Your account</h3>
          <p>
            Your email address, and an encrypted password if you do not sign in
            through a third-party provider. We use it to authenticate you and to
            contact you about your account.
          </p>

          <h3>Your ideal customer profile</h3>
          <p>
            The website address you give us during onboarding, the text we read
            from that site to draft your ICP, and the ICP you end up with —
            roles, company types, geography, and the minimum score you want to
            act on.
          </p>

          <h3>The leads you save</h3>
          <p>
            When Glint scores a profile or post that clears your threshold, it
            stores what you would have written down anyway: the person&apos;s
            name, headline, company, role, country, LinkedIn URL, the post
            context that surfaced them, the score, and the reasons behind that
            score. All of it is information already visible on the page you were
            viewing.
          </p>

          <h3>Contact details, only when you ask</h3>
          <p>
            Glint can look for a business email address or phone number that a
            person has chosen to publish on their own LinkedIn profile. This
            never happens in the background. It runs only when you explicitly
            request enrichment for a lead, and it only ever records what that
            person made publicly visible. We do not guess email addresses, buy
            them, or infer them from patterns.
          </p>

          <h2>How scoring works, and what leaves your browser</h2>
          <p>
            Scoring is done by a large language model, and we would rather you
            hear that from us than discover it later.
          </p>
          <p>
            When Glint scores what is on your screen, the extension extracts the
            visible text of those profiles or posts — name, headline, company,
            role, location, post body — and sends it to our servers, which pass
            it to our model provider, <strong>OpenRouter</strong>, together with
            your ICP. The model returns a score from 0 to 100 and its reasons.
            That is the entire round trip.
          </p>
          <p>
            The same path is used to draft your ICP from your website and to
            draft a message opener when you ask for one. We do not use your
            data, your leads, or your ICP to train any model.
          </p>

          <h2>Who processes your data</h2>
          <p>
            We keep this list short on purpose. Each of these providers processes
            data only to deliver a part of Glint, and none of them are permitted
            to use it for their own purposes.
          </p>
          <ul>
            <li>
              <strong>Supabase</strong> — database, authentication, and the
              server functions that scoring runs through.
            </li>
            <li>
              <strong>Railway</strong> — hosting for the Glint web application.
            </li>
            <li>
              <strong>OpenRouter</strong> — the model provider that performs
              scoring, ICP drafting, and opener drafting.
            </li>
          </ul>
          <p>
            Beyond these, we share nothing. We do not sell personal data. We do
            not trade it, rent it, or contribute it to any shared lead pool. If
            we are ever compelled to disclose data by valid legal process, we
            will tell you unless the law forbids it.
          </p>

          <h2>How your data is isolated</h2>
          <p>
            Every lead, folder, ICP, and site is bound to your account and
            protected at the database level by row-level security. A query made
            on behalf of one account cannot return another account&apos;s rows,
            regardless of what the application asks for. There is no shared
            corpus of leads and no cross-account visibility.
          </p>

          <h2>Cookies</h2>
          <p>
            Glint sets cookies for one reason: to keep you signed in. There are
            no advertising cookies, no third-party trackers, and no cross-site
            pixels on this site.
          </p>

          <h2>Retention and deletion</h2>
          <p>
            Leads stay until you delete them, and you can delete any lead at any
            time from your inbox. Your account and everything attached to it are
            retained while your account is open.
          </p>
          <p>
            To delete your account and all associated data, email{" "}
            <a href="mailto:biplob@weeziq.com">biplob@weeziq.com</a> and we will
            erase it. You can also request a copy of the data we hold about you,
            ask us to correct it, or object to how we process it.
          </p>

          <h2>People you save as leads</h2>
          <p>
            Glint stores information about third parties — the people you save.
            You are the one who decides to save them, which means you are
            responsible for having a lawful basis to hold and use their details,
            and for honoring any request they make to you. If someone contacts us
            directly about data held in a Glint account, we will pass their
            request on to the account holder and assist with erasing it.
          </p>

          <h2>Security</h2>
          <p>
            Data is encrypted in transit and at rest. Access to production
            systems is limited to what is necessary to operate the service. No
            system is perfectly secure, and we will not pretend otherwise — but
            if a breach ever affects your data, we will tell you promptly and
            plainly.
          </p>

          <h2>Children</h2>
          <p>
            Glint is a business tool and is not directed at anyone under 18. We
            do not knowingly collect data from children.
          </p>

          <h2>Changes</h2>
          <p>
            If we change this policy in a way that materially affects how we
            handle your data, we will update the date at the top and notify you
            by email before the change takes effect.
          </p>

          <hr />

          <p>
            Questions, deletion requests, or anything that reads wrong to you:{" "}
            <a href="mailto:biplob@weeziq.com">biplob@weeziq.com</a>.
          </p>
        </div>
      </section>
    </MarketingShell>
  )
}
