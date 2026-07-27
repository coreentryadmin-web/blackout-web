import SwiftUI

/// Compact per-desk pulse card on the Command tab.
///
/// Master prompt §5: "Product pulse. Each summary must communicate real
/// intelligence, not merely provide an 'Open' button." v1 derives the pulse
/// from the shared `MarketRegime` snapshot the Command view already fetched.
/// v2 (per-desk endpoints) hooks the real desk feeds; each card's `pulseText`
/// swaps to a live per-desk read as those endpoints wire up.
///
/// Design rule: NEVER show a fake number. If we don't have live data for a
/// given desk, the pulse states what the desk DOES in a specific way — not
/// a filler line and not a fabricated stat.
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

    /// One-line pulse for this desk from what the shared regime actually
    /// carries. Only says something concrete when the data exists — otherwise
    /// states what the desk DOES so the card is never empty and never lies.
    private var pulseText: String {
        switch module.id {
        case "spx-slayer": return spxPulse
        case "thermal":    return thermalPulse
        case "vector":     return vectorPulse
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
        guard let regime, regime.available else {
            return "SPX regime + 0DTE decision desk. Waiting on today's snapshot."
        }
        let label = MarketRegimeFormatter.regimeLabel(regime.regime).lowercased()
        var parts: [String] = ["Regime: \(label)"]
        if let trend = regime.trendRegime {
            parts.append("trend \(trend.replacingOccurrences(of: "_", with: " "))")
        }
        if regime.aboveVwap == true { parts.append("above VWAP") }
        else if regime.aboveVwap == false { parts.append("below VWAP") }
        return parts.joined(separator: " · ") + "."
    }

    private var thermalPulse: String {
        guard let regime, regime.available else {
            return "Dealer gamma + vanna map. Waiting on positioning snapshot."
        }
        if let gex = regime.gexRegime {
            let hedging = gex.contains("positive") ? "dealer hedging suppresses moves" :
                          gex.contains("negative") ? "dealer hedging amplifies moves" :
                          "regime in transition"
            return "GEX regime: \(gex.replacingOccurrences(of: "_", with: " ")) — \(hedging)."
        }
        return "Dealer positioning across strikes and expiries."
    }

    private var vectorPulse: String {
        guard let regime, regime.available else {
            return "Cross-ticker gamma-wall radar. Waiting on snapshot."
        }
        if let gex = regime.gexRegime {
            return "SPX \(gex.replacingOccurrences(of: "_", with: " ")). Vector shows the same structure across every optionable ticker."
        }
        return "Cross-ticker gamma-wall radar."
    }
}
