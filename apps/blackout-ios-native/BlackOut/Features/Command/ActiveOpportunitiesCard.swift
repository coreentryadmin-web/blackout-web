import SwiftUI

/// Command-tab "Active opportunities" card.
///
/// The Command tab exists to answer *what's worth acting on right now?* — a
/// role the market regime card partially fills (context) but doesn't finish
/// (concrete plays). This card threads the top N active signals from
/// `/api/mobile/signals` into Command so members don't have to leave the
/// default tab to see what's live.
///
/// Design bounds:
///  - **Max 3 rows.** Command is a summary, not a competing feed. Deeper =
///    tap into Signals tab, which the card CTA does verbatim.
///  - **Only active/managing/confirming** — a "detected" or "graded" card
///    on Command would dilute the summary. If members want those they
///    filter Signals directly.
///  - **Never blanks on error.** Same preserve-on-error policy as the rest
///    of Command; a transient timeout keeps the last-known list visible.
struct ActiveOpportunitiesCard: View {
    @EnvironmentObject private var router: TabRouter
    @StateObject private var vm = ActiveOpportunitiesViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            header
            content
        }
        .task { await vm.startAutoRefresh() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            BOSectionLabel("Active opportunities")
            Spacer(minLength: BOSpacing.snug)
            Button {
                router.route(to: .signals)
            } label: {
                Text("See all")
                    .font(BOFont.label)
                    .tracking(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(BOColor.textAccent)
            }
            .accessibilityHint("Opens the Signals tab")
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.state {
        case .idle, .loading:
            skeleton
        case .error(let message):
            errorCard(message)
        case .loaded:
            let top = vm.topOpportunities(limit: 3)
            if top.isEmpty {
                emptyCard
            } else {
                VStack(spacing: BOSpacing.snug) {
                    ForEach(top) { s in
                        Button {
                            router.route(to: .signals)
                        } label: {
                            OpportunityRow(signal: s)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var skeleton: some View {
        VStack(spacing: BOSpacing.snug) {
            ForEach(0..<2, id: \.self) { _ in
                BOCard { RoundedRectangle(cornerRadius: 4).fill(BOColor.border).frame(height: 44) }
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private func errorCard(_ message: String) -> some View {
        BOCard {
            HStack(spacing: BOSpacing.snug) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(BOColor.statusCaution)
                Text(message)
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.textSecondary)
                Spacer()
            }
        }
    }

    private var emptyCard: some View {
        BOCard {
            HStack(alignment: .top, spacing: BOSpacing.snug) {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(BOColor.textCaption)
                VStack(alignment: .leading, spacing: 2) {
                    Text("No live setups right now")
                        .font(BOFont.bodyBold)
                        .foregroundStyle(BOColor.textPrimary)
                    Text("The desks are scanning. New setups land the moment they form.")
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
        }
    }
}

/// Compact one-line row (used inside `ActiveOpportunitiesCard`). Not the
/// same as `SignalRow` in the Signals tab — that's a full card; this is a
/// scan-in-a-second summary row. Both share the source colour language so
/// members learn one visual vocabulary.
struct OpportunityRow: View {
    let signal: Signal

    var body: some View {
        BOCard {
            HStack(alignment: .center, spacing: BOSpacing.snug) {
                sourceDot
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(signal.ticker)
                            .font(BOFont.bodyBold)
                            .foregroundStyle(BOColor.textPrimary)
                        if let dir = signal.direction, !dir.isEmpty {
                            Text(dir.uppercased())
                                .font(BOFont.label)
                                .tracking(1.1)
                                .foregroundStyle(directionTint(dir))
                        }
                        if let g = signal.grade, !g.isEmpty {
                            Text(g)
                                .font(BOFont.label)
                                .foregroundStyle(gradeTint(g))
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(RoundedRectangle(cornerRadius: 4).fill(gradeTint(g).opacity(0.15)))
                        }
                    }
                    if !signal.headline.isEmpty {
                        Text(signal.headline)
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: BOSpacing.snug)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BOColor.textCaption)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private var sourceDot: some View {
        Circle()
            .fill(signal.source == .spxSlayer ? BOColor.textAccent : BOColor.statusInformational)
            .frame(width: 8, height: 8)
            .accessibilityHidden(true)
    }

    private func directionTint(_ dir: String) -> Color {
        switch dir.uppercased() {
        case "LONG", "BUY_CALL", "LONG_CALL": return BOColor.statusPositive
        case "SHORT", "BUY_PUT", "SHORT_PUT": return BOColor.statusNegative
        default: return BOColor.textCaption
        }
    }

    private func gradeTint(_ grade: String) -> Color {
        switch grade {
        case "A+", "A": return BOColor.statusPositive
        case "B":       return BOColor.textAccent
        case "C":       return BOColor.textCaption
        case "D", "F":  return BOColor.statusNegative
        default:        return BOColor.textCaption
        }
    }
}
