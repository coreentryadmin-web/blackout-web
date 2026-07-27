import SwiftUI

/// Presented from a Watchlist row tap. Shows the ticker's dealer positioning
/// summary — spot, flip, walls, max pain, and a plain-English regime read.
///
/// Design tuned for a modal sheet:
/// - Big spot price at top so members see the number first.
/// - Levels laid out as a stack of "receipt" rows (label · value · distance)
///   — same monospace-numeric grammar as the WatchlistRow so members learn
///   one visual language for "live number".
/// - Regime interpretation as a plain-English caption; never a raw slug.
/// - Pull-to-refresh; no auto-poll (see TickerDetailViewModel comment).
struct TickerDetailSheet: View {
    let ticker: String
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm: TickerDetailViewModel

    init(ticker: String) {
        self.ticker = ticker
        _vm = StateObject(wrappedValue: TickerDetailViewModel(ticker: ticker))
    }

    var body: some View {
        NavigationStack {
            content
                .background(BOColor.backgroundBase.ignoresSafeArea())
                .navigationTitle(ticker)
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") { dismiss() }
                            .tint(BOColor.textAccent)
                    }
                }
                .task { await vm.refresh() }
                .refreshable { await vm.refresh() }
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.state {
        case .idle, .loading:
            ScrollView { loadingBody.padding(BOSpacing.comfortable) }
        case .error(let msg):
            ScrollView { errorBody(msg).padding(BOSpacing.comfortable) }
        case .loaded(let d, let fetchedAt):
            ScrollView {
                if d.available {
                    availableBody(d, fetchedAt: fetchedAt).padding(BOSpacing.comfortable)
                } else {
                    unavailableBody(d).padding(BOSpacing.comfortable)
                }
            }
        }
    }

    // MARK: - States

    private var loadingBody: some View {
        VStack(spacing: BOSpacing.block) {
            spotCard(spot: nil, changePct: nil)
            levelsCard(levels: nil)
            regimeCard(regime: nil)
        }
        .redacted(reason: .placeholder)
    }

    private func errorBody(_ msg: String) -> some View {
        BOCard(tint: .accent(BOColor.statusCaution)) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                Text("Positioning unavailable")
                    .font(BOFont.heading3)
                    .foregroundStyle(BOColor.textPrimary)
                Text(msg)
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button { Task { await vm.refresh() } } label: {
                    Text("Retry").font(BOFont.bodyBold).foregroundStyle(BOColor.textAccent)
                }
            }
        }
    }

    private func unavailableBody(_ d: TickerDetail) -> some View {
        BOEmptyState(
            systemImage: "chart.line.uptrend.xyaxis",
            title: "No positioning yet",
            message: d.reason ?? "Dealer positioning isn't cached for \(ticker) yet. Try again after the next data pull."
        )
        .padding(.top, BOSpacing.loose)
    }

    private func availableBody(_ d: TickerDetail, fetchedAt: Date) -> some View {
        VStack(spacing: BOSpacing.block) {
            spotCard(spot: d.spot, changePct: d.changePct)
            levelsCard(levels: d.levels)
            regimeCard(regime: d.regime)
            freshnessRow(asOf: d.asOf, fetchedAt: fetchedAt, degraded: d.degraded == true)
        }
    }

    // MARK: - Cards

    private func spotCard(spot: Double?, changePct: Double?) -> some View {
        BOCard(tint: .accent(BOColor.textAccent)) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                BOSectionLabel("Spot")
                HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
                    Text(formatPrice(spot))
                        .font(BOFont.heading1)
                        .foregroundStyle(BOColor.textPrimary)
                        .monospacedDigit()
                    Spacer()
                    Text(formatChange(changePct))
                        .font(BOFont.bodyBold)
                        .foregroundStyle(changeTint(changePct))
                        .monospacedDigit()
                }
            }
        }
    }

    private func levelsCard(levels: TickerDetail.Levels?) -> some View {
        BOCard {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                BOSectionLabel("Dealer levels")
                levelRow("Gamma flip",  levels?.flip,     tint: BOColor.textAccent)
                Divider().overlay(BOColor.border)
                levelRow("Call wall",   levels?.callWall, tint: BOColor.statusPositive)
                Divider().overlay(BOColor.border)
                levelRow("Put wall",    levels?.putWall,  tint: BOColor.statusNegative)
                Divider().overlay(BOColor.border)
                levelRow("Max pain",    levels?.maxPain,  tint: BOColor.textCaption)
                if let nw = levels?.nearestWall {
                    Divider().overlay(BOColor.border)
                    HStack(alignment: .center, spacing: BOSpacing.snug) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Nearest wall")
                                .font(BOFont.label).tracking(1.4).textCase(.uppercase)
                                .foregroundStyle(BOColor.textCaption)
                            Text("\(nw.kind.capitalized) side")
                                .font(BOFont.caption).foregroundStyle(BOColor.textSecondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(formatPrice(nw.strike))
                                .font(BOFont.bodyBold)
                                .foregroundStyle(nw.kind == "call" ? BOColor.statusPositive : BOColor.statusNegative)
                                .monospacedDigit()
                            Text("±\(String(format: "%.1f", abs(nw.distancePts))) pts")
                                .font(BOFont.numericCaption)
                                .foregroundStyle(BOColor.textCaption)
                                .monospacedDigit()
                        }
                    }
                }
            }
        }
    }

    private func levelRow(_ label: String, _ value: Double?, tint: Color) -> some View {
        HStack(alignment: .center, spacing: BOSpacing.snug) {
            Text(label)
                .font(BOFont.label).tracking(1.4).textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
                .frame(width: 110, alignment: .leading)
            Spacer()
            Text(formatPrice(value))
                .font(BOFont.bodyBold)
                .foregroundStyle(value == nil ? BOColor.textCaption : tint)
                .monospacedDigit()
        }
        .padding(.vertical, 4)
    }

    private func regimeCard(regime: TickerDetail.Regime?) -> some View {
        BOCard(tint: regime?.gamma == "positive_gamma"
               ? .accent(BOColor.statusPositive)
               : regime?.gamma == "negative_gamma"
               ? .accent(BOColor.statusNegative)
               : .none) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                BOSectionLabel("Regime")
                Text(regimeLabel(regime?.gamma))
                    .font(BOFont.heading3)
                    .foregroundStyle(regimeTint(regime?.gamma))
                if let interp = regime?.interpretation {
                    Text(interp)
                        .font(BOFont.body)
                        .foregroundStyle(BOColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let posture = regime?.posture {
                    HStack(spacing: BOSpacing.snug) {
                        Text("Posture")
                            .font(BOFont.label).tracking(1.4).textCase(.uppercase)
                            .foregroundStyle(BOColor.textCaption)
                        Text(posture.capitalized)
                            .font(BOFont.bodyBold)
                            .foregroundStyle(posture == "long" ? BOColor.statusPositive : BOColor.statusNegative)
                    }
                    .padding(.top, BOSpacing.hairline)
                }
            }
        }
    }

    private func freshnessRow(asOf: Date?, fetchedAt: Date, degraded: Bool) -> some View {
        HStack {
            if degraded {
                Text("Degraded — single-expiry fallback")
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.statusCaution)
            }
            Spacer()
            Text(freshnessCaption(asOf: asOf, fetchedAt: fetchedAt))
                .font(BOFont.numericCaption)
                .foregroundStyle(BOColor.textCaption)
        }
        .padding(.horizontal, BOSpacing.snug)
    }

    // MARK: - Formatting

    private func formatPrice(_ v: Double?) -> String {
        guard let v = v, v.isFinite, v > 0 else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v)) ?? String(v)
    }
    private func formatChange(_ v: Double?) -> String {
        guard let v = v, v.isFinite else { return "—" }
        let r = (v * 100).rounded() / 100
        let sign = r > 0 ? "+" : ""
        return "\(sign)\(String(format: "%.2f%%", r))"
    }
    private func changeTint(_ v: Double?) -> Color {
        guard let v = v, v.isFinite else { return BOColor.textCaption }
        let r = (v * 100).rounded() / 100
        if r > 0 { return BOColor.statusPositive }
        if r < 0 { return BOColor.statusNegative }
        return BOColor.textCaption
    }
    private func regimeLabel(_ slug: String?) -> String {
        switch slug {
        case "positive_gamma": return "Positive gamma"
        case "negative_gamma": return "Negative gamma"
        case "transition":     return "Transition"
        case nil, "":          return "Unknown"
        default:               return slug ?? "Unknown"
        }
    }
    private func regimeTint(_ slug: String?) -> Color {
        switch slug {
        case "positive_gamma": return BOColor.statusPositive
        case "negative_gamma": return BOColor.statusNegative
        case "transition":     return BOColor.statusCaution
        default:               return BOColor.textCaption
        }
    }
    private func freshnessCaption(asOf: Date?, fetchedAt: Date) -> String {
        // Match the Command header's freshness grammar: "src Xs ago · fetched Ys ago".
        let src = asOf.map { "src " + MarketRegimeFormatter.freshnessLabel($0) } ?? "src —"
        let fetched = "fetched " + MarketRegimeFormatter.freshnessLabel(fetchedAt)
        return "\(src) · \(fetched)"
    }
}
