import SwiftUI

/// A single Watchlist row. Renders ticker + live price + change_pct
/// coming from `/api/market/quote?ticker=X` (via `WatchlistQuoteStore`).
///
/// Rendering rules the endpoint hands us to enforce:
///  - Never render a $0 price. If `available == false` or price is nil,
///    show "—" so members don't mistake a failure for a real quote.
///  - Change_pct never carries a false-positive plus sign; +0.00% must
///    match the tint of a real zero (neutral, not green).
///  - Freshness caption is muted — it's context, not the headline number.
struct WatchlistRow: View {
    let ticker: String
    let quote: TickerQuote?

    var body: some View {
        HStack(alignment: .center, spacing: BOSpacing.snug) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ticker)
                    .font(BOFont.heading3)
                    .foregroundStyle(BOColor.textPrimary)
                Text(freshnessLabel)
                    .font(BOFont.numericCaption)
                    .foregroundStyle(BOColor.textCaption)
            }
            .frame(minWidth: 76, alignment: .leading)
            Spacer(minLength: BOSpacing.snug)
            VStack(alignment: .trailing, spacing: 2) {
                Text(priceLabel)
                    .font(BOFont.numericHeading)
                    .foregroundStyle(BOColor.textPrimary)
                    .monospacedDigit()
                Text(changeLabel)
                    .font(BOFont.numericCaption)
                    .foregroundStyle(changeTint)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(a11yLabel)
    }

    // MARK: - Formatting

    private var priceLabel: String {
        guard let q = quote, q.available, let price = q.price, price.isFinite, price > 0 else {
            return "—"
        }
        return format(price)
    }

    private var changeLabel: String {
        guard let q = quote, q.available, let pct = q.changePct, pct.isFinite else {
            return "—"
        }
        // Deliberate rounding then sign: -0.00 must format as 0.00 (no
        // phantom minus sign on a rounded-to-zero change).
        let rounded = (pct * 100).rounded() / 100
        let sign: String
        if rounded > 0 { sign = "+" } else { sign = "" }
        return "\(sign)\(String(format: "%.2f%%", rounded))"
    }

    private var changeTint: Color {
        guard let q = quote, q.available, let pct = q.changePct, pct.isFinite else {
            return BOColor.textCaption
        }
        let rounded = (pct * 100).rounded() / 100
        if rounded > 0 { return BOColor.statusPositive }
        if rounded < 0 { return BOColor.statusNegative }
        return BOColor.textCaption
    }

    private var freshnessLabel: String {
        guard let q = quote, q.available, let asof = q.asof else {
            return quote == nil ? "loading" : "no quote"
        }
        return MarketRegimeFormatter.freshnessLabel(asof)
    }

    private var a11yLabel: String {
        var parts: [String] = [ticker]
        if let q = quote, q.available, let p = q.price, p > 0 {
            parts.append("price \(format(p))")
        }
        if let q = quote, q.available, let pct = q.changePct, pct.isFinite {
            parts.append("change \(String(format: "%.2f", pct)) percent")
        }
        return parts.joined(separator: ", ")
    }

    private func format(_ value: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? String(value)
    }
}
