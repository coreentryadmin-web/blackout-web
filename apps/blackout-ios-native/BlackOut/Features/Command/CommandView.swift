import SwiftUI

/// COMMAND — the default market command center (tab 1 of the 5-tab IA).
///
/// Per docs/ios/INFORMATION-ARCHITECTURE.md, this must answer:
///   what matters right now / what changed / regime / strongest setup / risk /
///   next key level / which product has the most relevant insight.
///
/// This first cut ships the SESSION HEADER + MARKET REGIME cards (real live
/// data from `/api/market/regime`, per docs/ios/API-CONTRACTS.md). Top brief,
/// opportunities, timeline, and product pulse are progressively added.
struct CommandView: View {
    @StateObject private var vm = CommandViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.block) {
                sessionHeader
                regimeCard
                comingSoonList
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Command")
        .navigationBarTitleDisplayMode(.large)
        .task { await vm.startAutoRefresh() }
        .refreshable { await vm.refresh() }
    }

    // MARK: - Session header (SPX + regime headline + freshness)

    @ViewBuilder private var sessionHeader: some View {
        let regime = vm.state.regime
        let fetchedAt = vm.state.fetchedAtOrNil()
        BOCard(tint: .accent(BOColor.textAccent)) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                HStack(alignment: .firstTextBaseline, spacing: BOSpacing.comfortable) {
                    metricBlock(
                        label: "SPX",
                        value: MarketRegimeFormatter.price(regime?.spot),
                        tint: BOColor.textAccent
                    )
                    Spacer()
                    sessionChip
                }
                HStack(alignment: .center, spacing: BOSpacing.snug) {
                    Text(MarketRegimeFormatter.regimeLabel(regime?.regime))
                        .font(BOFont.label)
                        .tracking(1.4)
                        .textCase(.uppercase)
                        .foregroundStyle(regime?.regime == nil ? BOColor.textCaption : regimeTint(regime?.regime))
                    Spacer(minLength: BOSpacing.snug)
                    freshnessChip(fetchedAt: fetchedAt, updatedAt: regime?.updated_at)
                }
            }
        }
    }

    private var sessionChip: some View {
        let regime = vm.state.regime
        let label = (regime?.session?.uppercased()) ?? "—"
        return Text(label)
            .font(BOFont.label)
            .tracking(1.4)
            .padding(.horizontal, BOSpacing.snug)
            .padding(.vertical, BOSpacing.hairline)
            .foregroundStyle(BOColor.textSecondary)
            .background(
                RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                    .strokeBorder(BOColor.borderStrong, lineWidth: 1)
            )
    }

    // MARK: - Regime interpretation + walls

    @ViewBuilder private var regimeCard: some View {
        switch vm.state {
        case .idle, .loading:
            skeletonCard
        case .error(let message):
            errorCard(message: message)
        case .loaded(let regime, _):
            BOCard {
                VStack(alignment: .leading, spacing: BOSpacing.snug) {
                    BOSectionLabel("Regime")
                    Text(MarketRegimeFormatter.regimeInterpretation(regime.regime))
                        .font(BOFont.body)
                        .foregroundStyle(BOColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Divider().overlay(BOColor.border)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())],
                              spacing: BOSpacing.snug) {
                        dataCell(label: "Flip", value: MarketRegimeFormatter.price(regime.flip_level))
                        dataCell(label: "Spot", value: MarketRegimeFormatter.price(regime.spot))
                        dataCell(label: "Call wall", value: MarketRegimeFormatter.price(regime.call_wall))
                        dataCell(label: "Put wall", value: MarketRegimeFormatter.price(regime.put_wall))
                    }
                }
            }
        }
    }

    // MARK: - Coming-soon list (honest scaffold for the remaining cards)

    private var comingSoonList: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("Building next")
            BOCard {
                VStack(alignment: .leading, spacing: BOSpacing.unit) {
                    comingRow("Top intelligence brief — what happened, why it matters, evidence")
                    comingRow("Active opportunities — top 3–5 setups with entry / invalidation / targets")
                    comingRow("What changed — prioritized timeline of meaningful events (not raw alerts)")
                    comingRow("Product pulse — compact SPX Slayer / Helix / Thermal / Largo / Night Hawk / Vector")
                }
            }
        }
    }

    // MARK: - Small view atoms

    private func metricBlock(label: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(BOFont.label).tracking(1.6).textCase(.uppercase).foregroundStyle(BOColor.textCaption)
            Text(value).font(BOFont.numericHero).monospacedDigit().foregroundStyle(tint)
        }
    }

    private func dataCell(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(BOFont.label).tracking(1.4).textCase(.uppercase).foregroundStyle(BOColor.textCaption)
            Text(value).font(BOFont.numericBody).monospacedDigit().foregroundStyle(BOColor.textPrimary)
        }
        .padding(.vertical, BOSpacing.hairline)
    }

    private func comingRow(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
            Text("·").font(BOFont.body).foregroundStyle(BOColor.textAccent)
            Text(text).font(BOFont.body).foregroundStyle(BOColor.textSecondary)
        }
    }

    private func freshnessChip(fetchedAt: Date?, updatedAt: Date?) -> some View {
        // Show BOTH server-updated-at and client-fetched-at — the master
        // prompt requires distinguishing timestamps so users can spot lag
        // in either the source or our client.
        let updatedLabel = updatedAt.map { "src " + MarketRegimeFormatter.freshnessLabel($0) }
        let fetchedLabel = fetchedAt.map { "· fetched " + MarketRegimeFormatter.freshnessLabel($0) }
        let combined = [updatedLabel, fetchedLabel].compactMap { $0 }.joined(separator: " ")
        return Text(combined.isEmpty ? "waiting…" : combined)
            .font(BOFont.numericCaption)
            .monospacedDigit()
            .foregroundStyle(BOColor.statusInformational)
    }

    private var skeletonCard: some View {
        BOCard {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                RoundedRectangle(cornerRadius: BORadius.chip).fill(BOColor.rule).frame(height: 14).frame(maxWidth: 120)
                RoundedRectangle(cornerRadius: BORadius.chip).fill(BOColor.rule).frame(height: 14)
                RoundedRectangle(cornerRadius: BORadius.chip).fill(BOColor.rule).frame(height: 14).frame(maxWidth: 220)
            }
        }
        .accessibilityLabel("Loading regime")
    }

    private func errorCard(message: String) -> some View {
        BOCard(tint: .accent(BOColor.statusCaution)) {
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                HStack(spacing: BOSpacing.unit) {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(BOColor.statusCaution)
                    Text("Regime unavailable").font(BOFont.bodyBold).foregroundStyle(BOColor.textPrimary)
                }
                Text(message).font(BOFont.caption).foregroundStyle(BOColor.textSecondary)
                Button {
                    Task { await vm.refresh() }
                } label: {
                    Text("Retry")
                        .font(BOFont.label).tracking(1.6).textCase(.uppercase)
                        .padding(.horizontal, BOSpacing.snug)
                        .padding(.vertical, BOSpacing.hairline + 2)
                }
                .buttonStyle(.bordered)
                .tint(BOColor.textAccent)
                .padding(.top, BOSpacing.hairline)
            }
        }
    }

    private func regimeTint(_ regime: String?) -> Color {
        switch regime?.lowercased() {
        case "positive_gamma": return BOColor.statusPositive
        case "negative_gamma": return BOColor.statusNegative
        case "transition":     return BOColor.statusCaution
        default:               return BOColor.textCaption
        }
    }
}
