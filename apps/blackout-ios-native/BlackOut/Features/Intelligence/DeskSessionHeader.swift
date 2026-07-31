import SwiftUI

/// Session command strip — live regime read + playbook line from `/api/market/regime`.
struct DeskSessionHeader: View {
    let regime: MarketRegime?
    let fetchedAt: Date?

    var body: some View {
        BOCard(tint: .accent(regimeTint)) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                HStack(alignment: .center, spacing: BOSpacing.comfortable) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Market regime")
                            .font(BOFont.label)
                            .tracking(1.4)
                            .textCase(.uppercase)
                            .foregroundStyle(BOColor.textCaption)
                        Text(MarketRegimeFormatter.regimeLabel(regime?.regime))
                            .font(BOFont.heading2)
                            .foregroundStyle(regime?.available == true ? regimeTint : BOColor.textCaption)
                    }
                    Spacer(minLength: BOSpacing.snug)
                    sessionChip
                }

                Text(playbookLine)
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let regime, regime.available {
                    LazyVGrid(
                        columns: [GridItem(.flexible()), GridItem(.flexible())],
                        spacing: BOSpacing.snug
                    ) {
                        subCell("GEX", regime.gexRegime)
                        subCell("Vol", regime.volRegime)
                        subCell("Trend", regime.trendRegime)
                        subCell("Flow", regime.flowRegime)
                    }
                }

                HStack(spacing: BOSpacing.snug) {
                    if regime?.stale == true {
                        statusChip("Stale snapshot", BOColor.statusCaution)
                    }
                    if let captured = regime?.capturedAt {
                        Text("src \(MarketRegimeFormatter.freshnessLabel(captured))")
                            .font(BOFont.numericCaption)
                            .foregroundStyle(BOColor.statusInformational)
                    }
                    if let fetchedAt {
                        Text("· fetched \(MarketRegimeFormatter.freshnessLabel(fetchedAt))")
                            .font(BOFont.numericCaption)
                            .foregroundStyle(BOColor.textCaption)
                    }
                }
            }
        }
    }

    private var playbookLine: String {
        if let playbook = regime?.playbook, !playbook.isEmpty { return playbook }
        return MarketRegimeFormatter.regimeInterpretation(regime?.regime)
    }

    private var sessionChip: some View {
        let label: String = {
            guard let regime, regime.available else { return "—" }
            switch (regime.marketOpen, regime.stale) {
            case (true?, _):       return "MARKET OPEN"
            case (false?, false?): return "MARKET CLOSED"
            case (false?, true?):  return "CLOSED · STALE"
            default:               return "—"
            }
        }()
        return Text(label)
            .font(BOFont.label)
            .tracking(1.2)
            .padding(.horizontal, BOSpacing.snug)
            .padding(.vertical, BOSpacing.hairline)
            .foregroundStyle(BOColor.textSecondary)
            .background(
                RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                    .strokeBorder(BOColor.borderStrong, lineWidth: 1)
            )
    }

    private func subCell(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(BOFont.label)
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
            Text(value?.replacingOccurrences(of: "_", with: " ").capitalized ?? "—")
                .font(BOFont.body)
                .foregroundStyle(value == nil ? BOColor.textCaption : BOColor.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statusChip(_ text: String, _ tint: Color) -> some View {
        Text(text)
            .font(BOFont.label)
            .tracking(1.1)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(tint.opacity(0.4), lineWidth: 1)
            )
    }

    private var regimeTint: Color {
        switch regime?.regime?.lowercased() {
        case "positive_gamma": return BOColor.statusPositive
        case "negative_gamma", "amplification", "amplify_mixed": return BOColor.statusNegative
        case "transition": return BOColor.statusCaution
        default: return BOColor.textCaption
        }
    }
}
