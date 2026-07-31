import SwiftUI

/// Live index tape — SPX / SPY / QQQ / VIX at the top of Desks.
struct IndexTickerStrip: View {
    private let tickers = ["SPX", "SPY", "QQQ", "VIX"]
    @StateObject private var quotes = WatchlistQuoteStore()

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: BOSpacing.snug) {
                ForEach(tickers, id: \.self) { ticker in
                    IndexTickerCell(ticker: ticker, quote: quotes.quotes[ticker])
                }
            }
        }
        .task { quotes.syncTo(watchlist: tickers) }
        .accessibilityLabel("Index prices")
    }
}

private struct IndexTickerCell: View {
    let ticker: String
    let quote: TickerQuote?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(ticker)
                .font(BOFont.label)
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
            Text(priceLabel)
                .font(BOFont.numericHeading)
                .foregroundStyle(BOColor.textPrimary)
                .monospacedDigit()
            Text(changeLabel)
                .font(BOFont.numericCaption)
                .foregroundStyle(changeTint)
                .monospacedDigit()
        }
        .padding(.horizontal, BOSpacing.snug)
        .padding(.vertical, BOSpacing.snug)
        .frame(minWidth: 96, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                .fill(BOColor.backgroundCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                .strokeBorder(BOColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var priceLabel: String {
        guard let q = quote, q.available, let p = q.price, p.isFinite, p > 0 else { return "—" }
        return format(p)
    }

    private var changeLabel: String {
        guard let q = quote, q.available, let pct = q.changePct, pct.isFinite else { return "—" }
        let rounded = (pct * 100).rounded() / 100
        let sign = rounded > 0 ? "+" : ""
        return "\(sign)\(String(format: "%.2f%%", rounded))"
    }

    private var changeTint: Color {
        guard let q = quote, q.available, let pct = q.changePct, pct.isFinite else { return BOColor.textCaption }
        if pct > 0 { return BOColor.statusPositive }
        if pct < 0 { return BOColor.statusNegative }
        return BOColor.textCaption
    }

    private var accessibilityLabel: String {
        [ticker, priceLabel, changeLabel].joined(separator: ", ")
    }

    private func format(_ value: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? String(value)
    }
}
