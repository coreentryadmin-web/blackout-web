import SwiftUI

/// Compact per-desk pulse card on the Command tab.
///
/// Master prompt §5: "Product pulse. Each summary must communicate real
/// intelligence, not merely provide an 'Open' button." v1 derives the pulse
/// from the shared `MarketRegime` snapshot the Command view already fetched
/// — SPX Slayer, Thermal, and Vector are all direct expressions of the
/// current regime + walls, so we can give real one-line intelligence today
/// without wiring per-desk endpoints. Helix / Largo / Night Hawk state their
/// scope honestly ("live-tape driven"; "ask a question"; "post-close") until
/// per-desk feeds land.
public struct ProductPulseCard: View {
    let module: IntelligenceModule
    let regime: MarketRegime?

    public init(module: IntelligenceModule, regime: MarketRegime?) {
        self.module = module
        self.regime = regime
    }

    public var body: some View {
        NavigationLink(value: module) {
            BOCard(tint: .accent(module.accent)) {
                HStack(alignment: .top, spacing: BOSpacing.snug) {
                    ZStack {
                        Circle().fill(module.accent.opacity(0.14))
                            .frame(width: 36, height: 36)
                        Image(systemName: module.systemImage)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(module.accent)
                    }
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: BOSpacing.unit) {
                            Text(module.name)
                                .font(BOFont.bodyBold)
                                .foregroundStyle(BOColor.textPrimary)
                            Text(module.mark)
                                .font(BOFont.label)
                                .tracking(1.4)
                                .foregroundStyle(module.accent)
                        }
                        Text(pulseText)
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: BOSpacing.hairline)
                    Image(systemName: "chevron.right")
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textCaption)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(module.name), \(pulseText)")
        .accessibilityHint("Opens the \(module.name) desk")
    }

    /// One-line current intelligence for this desk, given the shared regime
    /// snapshot. Keep every string short — this is a Command-tab tile, not
    /// a paragraph. The premise (master prompt): each summary communicates
    /// something concrete, not a marketing tagline.
    private var pulseText: String {
        switch module.id {
        case "spx-slayer":
            return spxPulse
        case "thermal":
            return thermalPulse
        case "vector":
            return vectorPulse
        case "helix":
            return "Live options-flow tape — sweeps, blocks, and repeated-strike aggression scored in real time."
        case "largo":
            return "Ask about flow, gamma, or regime. Structure-first answers grounded in the same live data."
        case "night-hawk":
            return "Evening swing scanner + graded playbook. Full thesis, entry / invalidation / target, A–F post-close."
        default:
            return module.tagline
        }
    }

    private var spxPulse: String {
        guard let regime else { return "Waiting on regime snapshot." }
        let label = MarketRegimeFormatter.regimeLabel(regime.regime).lowercased()
        if let spot = regime.spot, let flip = regime.flip_level {
            let distance = spot - flip
            let sign = distance >= 0 ? "above" : "below"
            let pts = String(format: "%.0f", abs(distance))
            return "Spot is \(pts)pt \(sign) the dealer flip (\(label))."
        }
        return "Regime: \(label)."
    }

    private var thermalPulse: String {
        guard let regime else { return "Waiting on gamma structure." }
        let cw = regime.call_wall.map { MarketRegimeFormatter.price($0) } ?? "—"
        let pw = regime.put_wall.map { MarketRegimeFormatter.price($0) } ?? "—"
        return "Call wall \(cw) · Put wall \(pw). Dealer positioning at these strikes drives hedging."
    }

    private var vectorPulse: String {
        guard let regime else { return "Cross-ticker gamma-wall radar. Waiting on snapshot." }
        if let flip = regime.flip_level {
            return "SPX flip at \(MarketRegimeFormatter.price(flip)). Vector shows the same structure across every optionable ticker."
        }
        return "Cross-ticker gamma-wall radar."
    }
}
