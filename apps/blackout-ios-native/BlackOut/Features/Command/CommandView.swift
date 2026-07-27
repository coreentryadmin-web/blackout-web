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
                WhatChangedCard(snapshots: vm.history)
                productPulse
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Command")
        .navigationBarTitleDisplayMode(.large)
        .task { await vm.startAutoRefresh() }
        .refreshable { await vm.refresh() }
        // Same NavigationStack destination Intelligence uses, so tapping a
        // pulse card on Command routes into ProductDetailView with matching
        // behaviour — no duplicated screen, no double implementations.
        .navigationDestination(for: IntelligenceModule.self) { m in
            ProductDetailView(module: m)
        }
    }

    // MARK: - Product Pulse (per-desk one-liners driven by the shared regime)

    private var productPulse: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("Product pulse")
            LazyVStack(spacing: BOSpacing.snug) {
                ForEach(IntelligenceRegistry.all) { m in
                    ProductPulseCard(module: m, regime: vm.state.regime)
                }
            }
        }
    }

    // MARK: - Session header (SPX + regime headline + freshness)

    @ViewBuilder private var sessionHeader: some View {
        let regime = vm.state.regime
        let fetchedAt = vm.state.fetchedAtOrNil()
        BOCard(tint: .accent(BOColor.textAccent)) {
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
                            .foregroundStyle(regime?.regime == nil ? BOColor.textCaption : regimeTint(regime?.regime))
                    }
                    Spacer()
                    sessionChip
                }
                HStack(alignment: .center, spacing: BOSpacing.snug) {
                    if regime?.stale == true {
                        Label {
                            Text("Stale")
                                .font(BOFont.label)
                                .tracking(1.4)
                                .textCase(.uppercase)
                        } icon: {
                            Circle().fill(BOColor.statusCaution).frame(width: 6, height: 6)
                        }
                        .foregroundStyle(BOColor.statusCaution)
                    }
                    Spacer(minLength: BOSpacing.snug)
                    freshnessChip(fetchedAt: fetchedAt, updatedAt: regime?.capturedAt)
                }
            }
        }
    }

    private var sessionChip: some View {
        let regime = vm.state.regime
        let label: String = {
            guard let regime else { return "—" }
            switch (regime.marketOpen, regime.stale) {
            case (true?, _):          return "MARKET OPEN"
            case (false?, false?):    return "MARKET CLOSED"
            case (false?, true?):     return "MARKET CLOSED · STALE"
            default:                  return "—"
            }
        }()
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
                    // Prefer the SERVER-owned playbook line when present (it's
                    // the text the market-regime-detector cron wrote alongside
                    // the snapshot, so it changes on the server without an app
                    // release). Fall back to our built-in one-liner for the
                    // three canonical regimes when the server didn't ship one.
                    Text(regime.playbook?.isEmpty == false
                         ? regime.playbook!
                         : MarketRegimeFormatter.regimeInterpretation(regime.regime))
                        .font(BOFont.body)
                        .foregroundStyle(BOColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Divider().overlay(BOColor.border)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())],
                              spacing: BOSpacing.snug) {
                        subRegimeCell(label: "GEX", value: regime.gexRegime)
                        subRegimeCell(label: "Vol", value: regime.volRegime)
                        subRegimeCell(label: "Trend", value: regime.trendRegime)
                        subRegimeCell(label: "Flow", value: regime.flowRegime)
                    }
                }
            }
        }
    }

    // MARK: - Small view atoms

    private func subRegimeCell(label: String, value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(BOFont.label).tracking(1.4).textCase(.uppercase).foregroundStyle(BOColor.textCaption)
            Text(value?.replacingOccurrences(of: "_", with: " ").capitalized ?? "—")
                .font(BOFont.body)
                .foregroundStyle(value == nil ? BOColor.textCaption : BOColor.textPrimary)
        }
        .padding(.vertical, BOSpacing.hairline)
        .frame(maxWidth: .infinity, alignment: .leading)
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
