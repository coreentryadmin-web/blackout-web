import SwiftUI

/// One signal card — the atom the Signals feed is built from.
///
/// Composition is deliberate:
/// - top row: source badge (SPX Slayer / Night Hawk), ticker + direction,
///   right-aligned grade chip;
/// - headline (the "why" one-liner from the engine);
/// - level chip row (entry / stop / target) — only rendered for levels that
///   actually exist; never fabricate a "—" placeholder chip;
/// - thesis (small caption);
/// - lifecycle chip + freshness at the bottom.
///
/// Pulled Night Hawk plays get an amber tinted border + pulled_reason
/// caption — kept visible at their published rank per PR-N4's rule ("never
/// hidden, never deleted").
struct SignalRow: View {
    let signal: Signal

    var body: some View {
        // Invalidated plays get the negative tint rail. Everything else
        // stays neutral so the row-density on the feed stays readable
        // (a 5-play NH edition with 5 different tints reads as noise).
        BOCard(tint: signal.phase == .invalidated ? .accent(BOColor.statusNegative) : .none) {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                header
                if !signal.headline.isEmpty {
                    Text(signal.headline)
                        .font(BOFont.bodyBold)
                        .foregroundStyle(BOColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if hasAnyLevels {
                    levels
                }
                if !signal.thesis.isEmpty && signal.thesis != signal.headline {
                    Text(signal.thesis)
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let reason = signal.meta.pulledReason, signal.phase == .invalidated {
                    Text("Pulled — \(reason)")
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.statusNegative)
                        .fixedSize(horizontal: false, vertical: true)
                }
                footer
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Composition

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
            sourceBadge
            Text(signal.ticker)
                .font(BOFont.heading3)
                .foregroundStyle(BOColor.textPrimary)
            if let dir = signal.direction, !dir.isEmpty {
                Text(dir.uppercased())
                    .font(BOFont.label)
                    .tracking(1.2)
                    .foregroundStyle(directionTint(dir))
            }
            Spacer(minLength: 0)
            if let grade = signal.grade, !grade.isEmpty {
                Text(grade)
                    .font(BOFont.bodyBold)
                    .foregroundStyle(gradeTint(grade))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(gradeTint(grade).opacity(0.15))
                    )
                    .accessibilityLabel("Grade \(grade)")
            }
        }
    }

    private var sourceBadge: some View {
        Text(signal.source.displayLabel)
            .font(BOFont.label)
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(signal.source == .spxSlayer ? BOColor.textAccent : BOColor.statusInformational)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(
                        (signal.source == .spxSlayer ? BOColor.textAccent : BOColor.statusInformational).opacity(0.4),
                        lineWidth: 1
                    )
            )
    }

    private var hasAnyLevels: Bool {
        signal.entry != nil || signal.stop != nil || signal.target != nil
    }

    private var levels: some View {
        HStack(alignment: .center, spacing: BOSpacing.snug) {
            if let entry = signal.entry {
                levelChip(label: "Entry", value: entry.display, tint: BOColor.textPrimary)
            }
            if let target = signal.target {
                levelChip(label: "Target", value: target.display, tint: BOColor.statusPositive)
            }
            if let stop = signal.stop {
                levelChip(label: "Stop", value: stop.display, tint: BOColor.statusNegative)
            }
            Spacer(minLength: 0)
        }
    }

    private func levelChip(label: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(BOFont.label)
                .tracking(1.1)
                .textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
            Text(value)
                .font(BOFont.bodyBold)
                .foregroundStyle(tint)
                .monospacedDigit()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(BOColor.backgroundBase.opacity(0.5))
        )
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: BOSpacing.snug) {
            BOChip(
                title: signal.phase.label,
                isSelected: false,
                tint: signal.phase.tint,
                action: {}
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            Spacer(minLength: 0)
            Text(freshnessLabel)
                .font(BOFont.caption)
                .foregroundStyle(BOColor.textCaption)
        }
    }

    // MARK: - Tint helpers

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

    private var freshnessLabel: String {
        guard let asOf = signal.asOf else { return "no timestamp" }
        return MarketRegimeFormatter.freshnessLabel(asOf)
    }

    private var accessibilityLabel: Text {
        var parts: [String] = [signal.source.displayLabel, signal.ticker]
        if let d = signal.direction { parts.append(d) }
        if let g = signal.grade { parts.append("grade \(g)") }
        parts.append("stage \(signal.phase.label)")
        if !signal.headline.isEmpty { parts.append(signal.headline) }
        return Text(parts.joined(separator: ", "))
    }
}
