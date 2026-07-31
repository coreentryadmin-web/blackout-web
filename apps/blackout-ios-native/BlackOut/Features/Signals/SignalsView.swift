import SwiftUI

/// SIGNALS — setup-lifecycle feed. Tab 2 of the IA.
///
/// Binds to `GET /api/mobile/signals` — SPX Slayer (live 0DTE desk) +
/// Night Hawk (post-close playbook) in one ordered feed. Lifecycle filter
/// rail filters client-side (instant stage switches). Tap a row to open the
/// owning desk in the live WebView bridge.
struct SignalsView: View {
    @StateObject private var vm = SignalsViewModel()
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: BOSpacing.block) {
                    sourcesHeader
                    filterRail
                    feed
                    lifecycleGlossary
                }
                .padding(BOSpacing.comfortable)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(BOColor.backgroundBase.ignoresSafeArea())
            .navigationTitle("Signals")
            .navigationBarTitleDisplayMode(.large)
            .task { await vm.startAutoRefresh() }
            .refreshable { await vm.refresh() }
            .navigationDestination(for: IntelligenceModule.self) { module in
                ProductDetailView(module: module)
            }
        }
    }

    // MARK: - Sources header (SPX Slayer + Night Hawk status)

    @ViewBuilder private var sourcesHeader: some View {
        if let sources = vm.sources {
            BOCard {
                HStack(alignment: .top, spacing: BOSpacing.comfortable) {
                    sourceCell(
                        title: "SPX Slayer",
                        subtitle: sources.spxSlayer.available
                            ? sources.spxSlayer.phase.capitalized
                            : "Offline",
                        tint: sources.spxSlayer.available ? BOColor.statusPositive : BOColor.textCaption
                    )
                    Divider().frame(height: 32).background(BOColor.border)
                    sourceCell(
                        title: "Night Hawk",
                        subtitle: sources.nightHawk.available
                            ? "\(sources.nightHawk.playCount) play\(sources.nightHawk.playCount == 1 ? "" : "s")\(sources.nightHawk.stale ? " · stale" : "")"
                            : "No edition yet",
                        tint: sources.nightHawk.stale
                            ? BOColor.textCaption
                            : (sources.nightHawk.available ? BOColor.statusInformational : BOColor.textCaption)
                    )
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func sourceCell(title: String, subtitle: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(BOFont.label)
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(BOColor.textCaption)
            Text(subtitle)
                .font(BOFont.bodyBold)
                .foregroundStyle(tint)
        }
    }

    // MARK: - Filter rail

    private var filterRail: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("Stage")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BOSpacing.unit) {
                    BOChip(
                        title: "All",
                        isSelected: vm.filter == nil,
                        action: { vm.filter = nil }
                    )
                    ForEach(SignalLifecycle.allCases) { stage in
                        BOChip(
                            title: chipLabel(for: stage),
                            isSelected: vm.filter == stage,
                            tint: stage.tint,
                            action: { vm.filter = stage }
                        )
                    }
                }
                .padding(.vertical, 2)
            }
            .accessibilityLabel("Signal stage filter")
        }
    }

    private func chipLabel(for stage: SignalLifecycle) -> String {
        let n = vm.state.feed?.signals.filter { $0.phase == stage }.count ?? 0
        return n > 0 ? "\(stage.label) \(n)" : stage.label
    }

    // MARK: - Feed body

    @ViewBuilder private var feed: some View {
        switch vm.state {
        case .idle, .loading:
            skeleton
        case .error(let message):
            errorCard(message)
        case .loaded:
            let visible = vm.visibleSignals
            if visible.isEmpty {
                emptyState
            } else {
                LazyVStack(spacing: BOSpacing.snug) {
                    ForEach(visible) { signal in
                        if let module = module(for: signal.source) {
                            Button {
                                path.append(module)
                            } label: {
                                SignalRow(signal: signal)
                            }
                            .buttonStyle(.plain)
                        } else {
                            SignalRow(signal: signal)
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

    private var skeleton: some View {
        VStack(spacing: BOSpacing.snug) {
            ForEach(0..<3, id: \.self) { _ in
                BOCard { VStack(alignment: .leading, spacing: BOSpacing.snug) {
                    RoundedRectangle(cornerRadius: 4).fill(BOColor.border).frame(height: 12).frame(maxWidth: 160)
                    RoundedRectangle(cornerRadius: 4).fill(BOColor.border).frame(height: 16)
                    RoundedRectangle(cornerRadius: 4).fill(BOColor.border).frame(height: 10).frame(maxWidth: 220)
                }}
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private func errorCard(_ message: String) -> some View {
        BOCard {
            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                Text("Signals paused")
                    .font(BOFont.heading3)
                    .foregroundStyle(BOColor.textPrimary)
                Text(message)
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await vm.refresh() }
                } label: {
                    Text("Retry")
                        .font(BOFont.bodyBold)
                        .foregroundStyle(BOColor.textAccent)
                }
            }
        }
    }

    private var emptyState: some View {
        BOEmptyState(
            systemImage: emptyIcon(for: vm.filter),
            title: emptyTitle(for: vm.filter),
            message: emptyMessage(for: vm.filter)
        )
        .padding(.vertical, BOSpacing.loose)
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
        guard let stage else { return "No signals right now" }
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
            return "The desks are scanning. Enable push notifications in Account → Notifications to hear about setups the moment they form."
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
