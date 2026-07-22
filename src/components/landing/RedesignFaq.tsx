import { FAQ_CATEGORIES, FAQ_ITEMS } from "@/lib/faq/content";
import { RetroGrid } from "@/components/ui/motion/RetroGrid";

/**
 * Redesigned FAQ — native <details> accordion (zero client JS), restyled into the
 * "lights on" language. Content is unchanged (FAQ_ITEMS / FAQ_CATEGORIES); only the
 * presentation moves to the .rl system so it matches the homepage + pricing.
 */
export function RedesignFaq() {
  return (
    <div className="rl">
      <section className="rl-faq-page">
        {/* Perspective phosphor floor behind the briefing — matches pricing/CTA. */}
        <RetroGrid lineColor="rgba(191,95,255,0.14)" opacity={0.4} />
        <div className="rl-wrap">
          <div className="rl-faq-inner">
            <span className="rl-kicker"><span className="dot" aria-hidden />The briefing</span>
            <h1>Everything, <span className="rl-gt">explained.</span></h1>
            <p>Platform, instruments, signals, and membership — no sales script.</p>

            <div className="rl-faq-cats">
              {FAQ_CATEGORIES.map((c) => (
                <span key={c.key}>{c.label}</span>
              ))}
            </div>

            <div className="rl-faq-list">
              {FAQ_ITEMS.map((item) => (
                <details key={item.id} id={item.id} className="rl-faq-item">
                  <summary>
                    <span className="cat">{item.cat}</span>
                    <span>{item.q}</span>
                    <span className="ic" aria-hidden>+</span>
                  </summary>
                  <p className="ans">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
