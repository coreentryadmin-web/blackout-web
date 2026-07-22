import Link from "next/link";

/** Full-desk perks — every module, one membership. */
const DESK_PERKS = [
  "HELIX live options-flow feed",
  "SPX Slayer · 0DTE desk",
  "Largo desk analyst",
  "Dealer gamma / GEX positioning",
  "Dark-pool prints",
  "Night Hawk evening playbook",
  "Strike-level heatmaps",
  "Transparent play log, graded A–F",
];

const COMMUNITY_PERKS = [
  "Private Discord server access",
  "Daily live signals & market reads",
  "Real-time session discussions",
  "Evening recaps & next-day prep",
];

/** Redesigned pricing page — three tiers, real perks, the "lights on" language. */
export function RedesignPricing() {
  return (
    <div className="rl">
      <section className="rl-pricing-page">
        <div className="rl-wrap">
          <div className="rl-pricing-head">
            <span className="rl-kicker" style={{ justifyContent: "center" }}>
              <span className="dot" aria-hidden />Membership
            </span>
            <h1>One desk. <span className="rl-gt">One price.</span></h1>
            <p>Community on Discord, or the full desk — monthly or yearly. Priced for traders who already pay for edge. No broker lock-in, cancel anytime.</p>
          </div>

          <div className="rl-tier-grid">
            {/* Community */}
            <div className="rl-plan">
              <div className="pl">Community</div>
              <div className="amt">$75<span> / mo</span></div>
              <div className="save">Discord · live signals · the room</div>
              <ul className="perks">
                {COMMUNITY_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <Link href="/sign-up" prefetch={false} className="rl-btn rl-btn-ghost">Join community</Link>
            </div>

            {/* Premium Monthly — featured */}
            <div className="rl-plan feat">
              <div className="badge">Full desk</div>
              <div className="pl">Premium · Monthly</div>
              <div className="amt">$199<span> / mo</span></div>
              <div className="save">Every module + Discord · one membership</div>
              <ul className="perks">
                {DESK_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <Link href="/sign-up" prefetch={false} className="rl-btn rl-btn-primary">Start monthly →</Link>
            </div>

            {/* Premium Yearly */}
            <div className="rl-plan">
              <div className="pl">Premium · Yearly</div>
              <div className="amt">$1,999<span> / yr</span></div>
              <div className="save">≈ $167/mo · save $389 vs monthly</div>
              <ul className="perks">
                {DESK_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <Link href="/sign-up" prefetch={false} className="rl-btn rl-btn-ghost">Go yearly</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
