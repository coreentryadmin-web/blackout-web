import Link from "next/link";
import { FAQ_SUPPORT_EMAIL } from "@/lib/faq/content";

// Effective date is displayed to users and kept in sync with the last material
// change to this policy. Bump this ONLY when the actual practices change (a
// wording edit does not require a new effective date). Kept as a constant so
// the App Store reviewer can verify the date on the served page matches ASC.
const EFFECTIVE_DATE = "July 26, 2026";

const PRIVACY_EMAIL = "privacy@blackouttrades.com";

export function PrivacyPolicy() {
  return (
    <div className="rl-legal-page">
      <section className="rl-sec" style={{ paddingTop: 96 }}>
        <div className="rl-wrap rl-legal-wrap">
          <header className="rl-legal-head">
            <span className="rl-kicker"><span className="dot" aria-hidden />Legal</span>
            <h1 className="rl-legal-h1">Privacy Policy</h1>
            <p className="rl-legal-lede">
              How BlackOut Trades collects, uses, and safeguards the small amount of information the
              platform actually needs. We keep it short, factual, and matched to what the code does.
            </p>
            <p className="rl-legal-meta">Effective {EFFECTIVE_DATE}</p>
          </header>

          <article className="rl-legal-body">
            <section>
              <h2>Who we are</h2>
              <p>
                BlackOut Trades (&ldquo;BlackOut,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a
                market-intelligence and analytics platform operated by BLACKOUT TRADE LLC. We
                surface options flow, dealer positioning, and market-structure intelligence for
                active options traders. We are <strong>not a broker-dealer</strong>, we hold no
                customer funds, and we execute no trades. Nothing on our platform is investment,
                trading, or legal advice.
              </p>
            </section>

            <section>
              <h2>Scope</h2>
              <p>
                This policy applies to the BlackOut website
                (<code>blackouttrades.com</code> and its subdomains) and the BlackOut iOS
                application. The iOS app is a signed-in native shell that displays the same
                BlackOut experience &mdash; the data practices described here apply identically on
                both surfaces.
              </p>
            </section>

            <section>
              <h2>What we collect</h2>
              <p>
                We keep this list to what the platform actually collects and uses. If a category is
                not listed here, we do not collect it.
              </p>

              <h3>Account information</h3>
              <ul>
                <li>
                  <strong>Email address</strong> &mdash; required to create and sign in to your
                  account. Handled by our identity provider Clerk.
                </li>
                <li>
                  <strong>Phone number</strong> &mdash; required by our identity provider for
                  account security (one-time codes, account recovery).
                </li>
                <li>
                  <strong>Name and profile fields</strong> &mdash; only if you enter them; you can
                  edit or remove them from your account settings.
                </li>
                <li>
                  <strong>User identifier</strong> &mdash; an internal Clerk user ID used to
                  associate your account with your preferences and entitlements.
                </li>
              </ul>

              <h3>Membership &amp; entitlements</h3>
              <ul>
                <li>
                  <strong>Subscription status &amp; tier</strong> &mdash; whether your
                  membership is active, the tier you hold, and renewal state. Payments are
                  processed by our subscription platform Whop; we <strong>do not receive or store
                  your card details</strong>. We read your subscription status so the app can
                  unlock the features included in your plan.
                </li>
                <li>
                  <strong>No in-app purchases in the iOS app.</strong> Membership is created and
                  managed on the web; the iOS app is sign-in only. Apple does not receive purchase
                  information from us because none is transacted in the app.
                </li>
              </ul>

              <h3>Notifications</h3>
              <ul>
                <li>
                  <strong>Push subscription details</strong> &mdash; if you enable browser or
                  iOS push notifications, we store the technical subscription (a push endpoint or
                  device token, plus the associated keys) so we can deliver alerts you opted into.
                  Turning off notifications removes the subscription.
                </li>
              </ul>

              <h3>Diagnostics &amp; security</h3>
              <ul>
                <li>
                  <strong>Crash and error diagnostics</strong> &mdash; when the app or website
                  encounters an unexpected error, we may record the error and technical context
                  (stack trace, application version, route) to fix bugs. These records are not
                  used to identify you or build a profile.
                </li>
                <li>
                  <strong>IP address (limited)</strong> &mdash; retained in security-relevant
                  logs (for example, failed sign-in attempts) for a short period so we can
                  detect abuse and rate-limit malicious traffic. We do not use IP data for
                  advertising or profiling.
                </li>
                <li>
                  <strong>Session cookies</strong> &mdash; a session cookie
                  (<code>__session</code>) and a client-updated timestamp cookie
                  (<code>__client_uat</code>) issued by Clerk keep you signed in between requests.
                  These are essential for authentication.
                </li>
              </ul>

              <h3>Preferences &amp; your saved work</h3>
              <ul>
                <li>
                  Your watchlists, saved filters, and app preferences are stored on our servers
                  associated with your account, and locally in your browser or app so they persist
                  between sessions.
                </li>
              </ul>

              <h3>What we do not collect</h3>
              <ul>
                <li>Financial account information (we are not a broker &mdash; there is no account to fund).</li>
                <li>Payment card details (payments are handled by Whop).</li>
                <li>Precise or coarse device location.</li>
                <li>Contacts, photos, microphone, health, or fitness data.</li>
                <li>Browsing history outside of BlackOut.</li>
                <li>Advertising identifiers.</li>
              </ul>
            </section>

            <section>
              <h2>How we use it</h2>
              <ul>
                <li>Deliver the desks, analytics, alerts, and features included in your membership.</li>
                <li>Authenticate you and keep your session secure.</li>
                <li>Verify and refresh your entitlements against your membership tier.</li>
                <li>Send you the notifications you opted into.</li>
                <li>Diagnose crashes and fix bugs.</li>
                <li>Detect abuse, rate-limit malicious traffic, and protect the service.</li>
                <li>Communicate with you about your account, security, and material service changes.</li>
              </ul>
              <p>
                We do <strong>not</strong> use your data for behavioural advertising, sell it, or
                share it with data brokers.
              </p>
            </section>

            <section>
              <h2>Tracking &amp; analytics</h2>
              <p>
                BlackOut does <strong>not</strong> use third-party ad networks, cross-site
                tracking, or user-behaviour analytics SDKs (no Google Analytics, no Meta pixel,
                no Segment, PostHog, Amplitude, Mixpanel, or similar). We do not display Apple&rsquo;s
                App Tracking Transparency prompt because we do not track you across other apps or
                websites.
              </p>
              <p>
                Internal product analytics on our own market data (e.g., how the SPX Slayer signal
                engine performs) are computed from anonymous market observations, not from your
                behaviour.
              </p>
            </section>

            <section>
              <h2>Third parties we rely on</h2>
              <p>
                We use a small number of trusted service providers to run the platform. Each is
                bound by contract to only process data on our behalf and for the purpose listed.
              </p>
              <dl className="rl-legal-dl">
                <div>
                  <dt>Clerk</dt>
                  <dd>Identity and account management (email, phone, session).</dd>
                </div>
                <div>
                  <dt>Whop</dt>
                  <dd>Membership and payment processing (payment methods handled by Whop, not by us).</dd>
                </div>
                <div>
                  <dt>Amazon Web Services</dt>
                  <dd>Application hosting and databases.</dd>
                </div>
                <div>
                  <dt>Cloudflare</dt>
                  <dd>DNS, edge caching, and network security.</dd>
                </div>
                <div>
                  <dt>Apple Push Notification service</dt>
                  <dd>Delivering iOS push notifications you opt into.</dd>
                </div>
                <div>
                  <dt>Market-data providers</dt>
                  <dd>
                    Institutional-grade market and options-flow data used to power the desks
                    (e.g., real-time equity and options market data). These providers receive no
                    personal information about you.
                  </dd>
                </div>
              </dl>
            </section>

            <section>
              <h2>Retention</h2>
              <p>
                We keep account information for as long as your account is active. If you close
                your account, we delete personal data associated with it, retaining only what we
                are required to keep for tax, legal, or security-log purposes, or in anonymised
                form for aggregate product analytics. Diagnostic logs are retained for a rolling
                short period (typically no more than 90 days). Security event logs (for example,
                failed sign-ins) are retained long enough to investigate patterns of abuse.
              </p>
            </section>

            <section>
              <h2>Security</h2>
              <p>
                We use TLS for all data in transit, industry-standard hashing and encryption for
                sensitive stored credentials, principle-of-least-privilege access controls for our
                team, and short-lived session tokens. No system is perfect, and we cannot
                guarantee absolute security &mdash; if we ever learn of an incident that materially
                affects your account, we will notify you promptly.
              </p>
            </section>

            <section>
              <h2>Your choices &amp; rights</h2>
              <ul>
                <li>
                  <strong>Access, correct, or update</strong> most of your account information
                  from the Account screen inside the app.
                </li>
                <li>
                  <strong>Turn off notifications</strong> at any time in Notification Settings
                  inside the app, or from your device&rsquo;s notification permissions.
                </li>
                <li>
                  <strong>Delete your account.</strong> You can request account deletion from
                  the Account screen or by emailing <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
                  We will delete your personal data within a reasonable period, subject to the
                  retention exceptions above.
                </li>
                <li>
                  <strong>Data subject requests</strong> (access, portability, correction,
                  erasure, restriction, objection) &mdash; residents of jurisdictions that grant
                  these rights (e.g., the EEA, the United Kingdom, California) can submit a
                  request to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We will
                  verify your identity and respond within the timeframe required by the applicable
                  law.
                </li>
                <li>
                  <strong>&ldquo;Do Not Sell or Share.&rdquo;</strong> We do not sell or share
                  personal information as defined by California law. There is nothing to opt
                  out of.
                </li>
              </ul>
            </section>

            <section>
              <h2>International transfers</h2>
              <p>
                We operate our infrastructure primarily in the United States. If you use BlackOut
                from outside the United States, your information will be transferred to and
                processed in the United States. Where required, we rely on appropriate transfer
                safeguards (such as Standard Contractual Clauses) with our providers.
              </p>
            </section>

            <section>
              <h2>Children</h2>
              <p>
                BlackOut is intended for adults and is not directed to children under 13. We do
                not knowingly collect personal information from children. If we learn we have
                collected such information, we will delete it.
              </p>
            </section>

            <section>
              <h2>Changes to this policy</h2>
              <p>
                If we make material changes to this policy, we will update the effective date at
                the top and, where appropriate, notify you inside the app or by email. Continued
                use of BlackOut after a change means you accept the updated policy.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Privacy questions or requests: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
                <br />
                General support: <a href={`mailto:${FAQ_SUPPORT_EMAIL}`}>{FAQ_SUPPORT_EMAIL}</a>
              </p>
            </section>

            <p className="rl-legal-return">
              <Link href="/" prefetch={false} className="rl-btn rl-btn-ghost">&larr; Back to BlackOut</Link>
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
