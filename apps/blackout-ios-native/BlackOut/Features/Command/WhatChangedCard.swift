import Foundation
import SwiftUI

/// "What Changed" — a prioritized timeline of meaningful regime transitions
/// (master prompt §5). Derived from the last N regime snapshots the server
/// stores. Semantics:
///   - We DON'T list every 5-min snapshot — that's just noise.
///   - We DO list transitions where a regime component actually changed
///     (composite, GEX, vol, trend, flow, aboveVwap).
///   - We show the LAST N transitions (default 5) with the newest first, so
///     the tab always has recent context even on a slow day.
///
/// Diff logic is pure Swift, testable, and lives here so both the view and
/// the test suite share it. The card view is just a shell.
public struct RegimeChange: Identifiable, Equatable {
    public let id: String
    public let capturedAt: Date?
    public let field: Field
    public let from: String?
    public let to: String?

    public enum Field: String, Equatable {
        case composite  = "Regime"
        case gex        = "GEX"
        case vol        = "Vol"
        case trend      = "Trend"
        case flow       = "Flow"
        case vwap       = "VWAP"
    }
}

public enum WhatChangedDiff {
    /// Compute regime transitions across `snapshots` (newest first, matches
    /// the API `?history=N` ordering). Returns changes newest first, capped
    /// at `max`. If a snapshot doesn't have a comparable predecessor (or the
    /// list has fewer than 2 entries), an empty list is returned — the UI
    /// shows an empty state, never a fake change.
    public static func compute(_ snapshots: [MarketRegime], max limit: Int = 5) -> [RegimeChange] {
        guard snapshots.count >= 2 else { return [] }
        var changes: [RegimeChange] = []
        // Walk pairs (newer, older) — snapshots[i] happened AFTER snapshots[i+1].
        for i in 0..<(snapshots.count - 1) {
            let newer = snapshots[i]
            let older = snapshots[i + 1]
            let stamp = newer.capturedAt.map(String.init(describing:)) ?? "n\(i)"

            appendIfChanged(&changes, id: "\(stamp).regime",  at: newer.capturedAt, field: .composite,
                            from: older.regime, to: newer.regime)
            appendIfChanged(&changes, id: "\(stamp).gex",     at: newer.capturedAt, field: .gex,
                            from: older.gexRegime, to: newer.gexRegime)
            appendIfChanged(&changes, id: "\(stamp).vol",     at: newer.capturedAt, field: .vol,
                            from: older.volRegime, to: newer.volRegime)
            appendIfChanged(&changes, id: "\(stamp).trend",   at: newer.capturedAt, field: .trend,
                            from: older.trendRegime, to: newer.trendRegime)
            appendIfChanged(&changes, id: "\(stamp).flow",    at: newer.capturedAt, field: .flow,
                            from: older.flowRegime, to: newer.flowRegime)

            // VWAP is a Bool? — map to strings so the change carries a label
            // the view can render directly ("above VWAP" / "below VWAP").
            let vFrom = older.aboveVwap.map { $0 ? "above VWAP" : "below VWAP" }
            let vTo   = newer.aboveVwap.map { $0 ? "above VWAP" : "below VWAP" }
            appendIfChanged(&changes, id: "\(stamp).vwap", at: newer.capturedAt, field: .vwap,
                            from: vFrom, to: vTo)

            if changes.count >= limit { break }
        }
        return Array(changes.prefix(limit))
    }

    private static func appendIfChanged(
        _ out: inout [RegimeChange],
        id: String,
        at capturedAt: Date?,
        field: RegimeChange.Field,
        from: String?,
        to: String?
    ) {
        // A change requires: both sides comparable, and different. Nil→nil is
        // "no data on either side, no news"; nil→value is a real transition
        // (regime just started reporting) which we DO count.
        if from == to { return }
        // Special case: nil→nil already filtered above. from == to catches
        // literally identical strings.
        out.append(RegimeChange(id: id, capturedAt: capturedAt, field: field, from: from, to: to))
    }
}

/// The visual card. Renders diff-computed changes as a compact stacked list.
public struct WhatChangedCard: View {
    let snapshots: [MarketRegime]

    public init(snapshots: [MarketRegime]) { self.snapshots = snapshots }

    public var body: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("What changed")
            content
        }
    }

    @ViewBuilder private var content: some View {
        let changes = WhatChangedDiff.compute(snapshots)
        if snapshots.isEmpty {
            BOCard {
                skeletonRow.padding(.vertical, BOSpacing.hairline)
                skeletonRow.padding(.vertical, BOSpacing.hairline)
            }
        } else if changes.isEmpty {
            BOCard {
                VStack(alignment: .leading, spacing: BOSpacing.hairline) {
                    Text("Regime has been stable across the last \(snapshots.count) snapshots.")
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            BOCard {
                VStack(spacing: 0) {
                    ForEach(Array(changes.enumerated()), id: \.element.id) { idx, ch in
                        row(ch)
                        if idx < changes.count - 1 {
                            Divider().overlay(BOColor.border)
                        }
                    }
                }
            }
        }
    }

    private func row(_ ch: RegimeChange) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
            Text(ch.field.rawValue)
                .font(BOFont.label)
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
                .frame(width: 68, alignment: .leading)
            Text(pretty(ch.from ?? "—"))
                .font(BOFont.numericCaption)
                .foregroundStyle(BOColor.textCaption)
                .strikethrough(true, color: BOColor.textCaption)
            Image(systemName: "arrow.right")
                .font(BOFont.caption)
                .foregroundStyle(BOColor.textCaption)
                .accessibilityHidden(true)
            Text(pretty(ch.to ?? "—"))
                .font(BOFont.numericCaption)
                .foregroundStyle(BOColor.textPrimary)
            Spacer(minLength: BOSpacing.hairline)
            if let at = ch.capturedAt {
                Text(MarketRegimeFormatter.freshnessLabel(at))
                    .font(BOFont.numericCaption)
                    .foregroundStyle(BOColor.textCaption)
            }
        }
        .padding(.vertical, BOSpacing.unit)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ch.field.rawValue) changed from \(ch.from ?? "unknown") to \(ch.to ?? "unknown")")
    }

    private var skeletonRow: some View {
        HStack(spacing: BOSpacing.snug) {
            RoundedRectangle(cornerRadius: BORadius.chip).fill(BOColor.rule).frame(width: 60, height: 12)
            RoundedRectangle(cornerRadius: BORadius.chip).fill(BOColor.rule).frame(height: 12)
        }
    }

    private func pretty(_ raw: String) -> String {
        raw.replacingOccurrences(of: "_", with: " ")
    }
}
