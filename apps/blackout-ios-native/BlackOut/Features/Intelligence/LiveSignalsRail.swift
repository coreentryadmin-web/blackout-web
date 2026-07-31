import SwiftUI

/// Actionable live setups from `/api/mobile/signals` — tap opens the owning desk.
struct LiveSignalsRail: View {
    let signals: [Signal]
    var onSelect: (IntelligenceModule) -> Void

    private var actionable: [Signal] {
        let phases: Set<SignalLifecycle> = [.active, .managing, .confirming, .detected]
        return signals.filter { phases.contains($0.phase) }.prefix(4).map { $0 }
    }

    var body: some View {
        if actionable.isEmpty { EmptyView() }
        else {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                BOSectionLabel("Live setups")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: BOSpacing.snug) {
                        ForEach(actionable) { signal in
                            Button {
                                if let module = module(for: signal.source) {
                                    onSelect(module)
                                }
                            } label: {
                                SignalCard(signal: signal)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func module(for source: Signal.Source) -> IntelligenceModule? {
        switch source {
        case .spxSlayer: return IntelligenceRegistry.all.first { $0.id == "spx-slayer" }
        case .nightHawk: return IntelligenceRegistry.all.first { $0.id == "night-hawk" }
        }
    }
}

private struct SignalCard: View {
    let signal: Signal

    var body: some View {
        BOCard(tint: .accent(accent)) {
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                HStack(spacing: BOSpacing.unit) {
                    Text(signal.source.displayLabel.uppercased())
                        .font(BOFont.label)
                        .tracking(1.2)
                        .foregroundStyle(accent)
                    Spacer(minLength: 0)
                    Text(signal.phase.label.uppercased())
                        .font(BOFont.label)
                        .tracking(1.1)
                        .foregroundStyle(signal.phase.tint)
                }
                Text(signal.headline)
                    .font(BOFont.bodyBold)
                    .foregroundStyle(BOColor.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: BOSpacing.unit) {
                    if let grade = signal.grade, !grade.isEmpty {
                        Text("Grade \(grade)")
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                    }
                    if let direction = signal.direction, !direction.isEmpty {
                        Text(direction.uppercased())
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                    }
                }
            }
            .frame(width: 260, alignment: .leading)
        }
    }

    private var accent: Color {
        switch signal.source {
        case .spxSlayer: return BOColor.Product.spxSlayer
        case .nightHawk: return BOColor.Product.nightHawk
        }
    }
}
