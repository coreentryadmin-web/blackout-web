import SwiftUI

/// SIGNALS — setup-lifecycle feed. Tab 3 of the IA.
///
/// v1 ships the shell:
///   - horizontal lifecycle filter chip rail (all 7 stages),
///   - a single "no signals matching your filter" empty state grounded in the
///     honest current data reality (there's no signals API bound yet — see
///     the tracker),
///   - a "How this reads" card explaining what each lifecycle stage means,
///     so the filter rail is discoverable and self-documenting.
///
/// v2 binds to a real `/api/signals` endpoint (currently synthesized from the
/// Night Hawk plays engine on the backend — see docs/ios/API-CONTRACTS.md
/// for the intended shape).
struct SignalsView: View {
    @State private var selected: SignalLifecycle? = .active

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.block) {
                filterRail
                Group {
                    // Signals list will land here in v2 — for now we show the
                    // empty state so the layout is real (no placeholder
                    // padding hiding what the tab is for).
                    BOEmptyState(
                        systemImage: emptyIcon(for: selected),
                        title: emptyTitle(for: selected),
                        message: emptyMessage(for: selected)
                    )
                    .padding(.vertical, BOSpacing.loose)
                }
                lifecycleGlossary
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Signals")
        .navigationBarTitleDisplayMode(.large)
    }

    // MARK: - Filter rail

    private var filterRail: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("Stage")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BOSpacing.unit) {
                    BOChip(
                        title: "All",
                        isSelected: selected == nil,
                        action: { selected = nil }
                    )
                    ForEach(SignalLifecycle.allCases) { stage in
                        BOChip(
                            title: stage.label,
                            isSelected: selected == stage,
                            tint: stage.tint,
                            action: { selected = stage }
                        )
                    }
                }
                .padding(.vertical, 2)
            }
            .accessibilityLabel("Signal stage filter")
        }
    }

    // MARK: - Lifecycle glossary card

    private var lifecycleGlossary: some View {
        BOCard {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                BOSectionLabel("How this reads")
                ForEach(SignalLifecycle.allCases) { stage in
                    HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
                        Circle().fill(stage.tint).frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        Text(stage.label)
                            .font(BOFont.bodyBold)
                            .foregroundStyle(BOColor.textPrimary)
                            .frame(minWidth: 96, alignment: .leading)
                        Text(glossaryDescription(for: stage))
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: - Copy

    private func emptyTitle(for stage: SignalLifecycle?) -> String {
        guard let stage else { return "No signals yet" }
        switch stage {
        case .detected:    return "Nothing detected right now"
        case .confirming:  return "No setups confirming"
        case .active:      return "No active setups"
        case .managing:    return "Nothing to manage"
        case .closed:      return "No closed setups today"
        case .invalidated: return "No invalidations today"
        case .graded:      return "No graded plays yet"
        }
    }

    private func emptyMessage(for stage: SignalLifecycle?) -> String {
        guard let stage else {
            return "Setups appear here the moment the desks detect them. Enable push notifications in Account → Notifications to hear about them immediately."
        }
        switch stage {
        case .detected:    return "The desks scan continuously. When something meaningful forms, it shows up here first."
        case .confirming:  return "Setups that need one more piece of evidence — a level reclaim, a flow confirmation — before promoting to Active."
        case .active:      return "Live setups with entry, invalidation, and targets in play."
        case .managing:    return "Active setups that moved into a target zone or are approaching invalidation."
        case .closed:      return "Setups that reached target, stop, or a time-based exit today."
        case .invalidated: return "Setups where the read failed. Kept visible so the postmortem is honest."
        case .graded:      return "Post-close grades (A+ / A / B / C / F) on the day's plays."
        }
    }

    private func emptyIcon(for stage: SignalLifecycle?) -> String {
        guard let stage else { return "bolt.badge.clock" }
        switch stage {
        case .detected:    return "dot.radiowaves.left.and.right"
        case .confirming:  return "checkmark.seal"
        case .active:      return "bolt.fill"
        case .managing:    return "gauge.medium"
        case .closed:      return "flag.checkered"
        case .invalidated: return "xmark.octagon"
        case .graded:      return "graduationcap"
        }
    }

    private func glossaryDescription(for stage: SignalLifecycle) -> String {
        switch stage {
        case .detected:    return "The desk noticed something worth watching."
        case .confirming:  return "Waiting on one more piece of evidence to promote."
        case .active:      return "Live — entry, invalidation, target are in play."
        case .managing:    return "Approaching a target or invalidation zone."
        case .closed:      return "Reached target, stop, or time-based exit."
        case .invalidated: return "The read failed. Kept for honest postmortem."
        case .graded:      return "Post-close grade A+ / A / B / C / F."
        }
    }
}
