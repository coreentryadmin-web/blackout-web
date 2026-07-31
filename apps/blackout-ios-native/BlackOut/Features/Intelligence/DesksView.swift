import SwiftUI

/// Primary tab — live market context + all six product desks.
struct DesksView: View {
    @EnvironmentObject private var tabRouter: TabRouter
    @StateObject private var pulse = IntelligencePulseStore()
    @StateObject private var regimeStore = DeskRegimeStore()
    @State private var path = NavigationPath()

    private let modules = IntelligenceRegistry.all
    private let gridColumns = [
        GridItem(.flexible(), spacing: BOSpacing.snug),
        GridItem(.flexible(), spacing: BOSpacing.snug),
    ]

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: BOSpacing.block) {
                    IndexTickerStrip()
                    DeskSessionHeader(regime: regimeStore.regime, fetchedAt: regimeStore.fetchedAt)
                    if let feed = pulse.feed {
                        LiveSignalsRail(signals: feed.signals) { module in
                            path.append(module)
                        }
                    }
                    ProductQuickLaunchBar(modules: modules) { module in
                        path.append(module)
                    }
                    desksSection
                }
                .padding(BOSpacing.comfortable)
            }
            .background(BOColor.backgroundBase.ignoresSafeArea())
            .navigationTitle("Desks")
            .navigationBarTitleDisplayMode(.large)
            .task {
                async let regimeLoop: Void = regimeStore.startAutoRefresh()
                async let pulseLoop: Void = pulse.startAutoRefresh()
                _ = await (regimeLoop, pulseLoop)
            }
            .refreshable {
                await regimeStore.refresh()
                await pulse.refresh()
            }
            .navigationDestination(for: IntelligenceModule.self) { module in
                ProductDetailView(module: module)
            }
            .onChange(of: tabRouter.pendingDeskModuleId) { _, moduleId in
                guard let moduleId,
                      let module = modules.first(where: { $0.id == moduleId }) else { return }
                path.append(module)
                tabRouter.consumePendingDesk()
            }
        }
    }

    private var desksSection: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("All products")
            Text("SPX Slayer · HELIX · Thermal · Largo · Night Hawk · Vector — each opens the live desk.")
                .font(BOFont.caption)
                .foregroundStyle(BOColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: gridColumns, spacing: BOSpacing.snug) {
                ForEach(modules) { module in
                    NavigationLink(value: module) {
                        DeskTile(module: module, pulse: pulse.pulse(for: module.id))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct DeskTile: View {
    let module: IntelligenceModule
    let pulse: IntelligencePulseStore.Pulse?

    var body: some View {
        BOCard(tint: .accent(module.accent)) {
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                HStack {
                    ZStack {
                        Circle()
                            .fill(module.accent.opacity(0.16))
                            .frame(width: 36, height: 36)
                        Image(systemName: module.systemImage)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(module.accent)
                    }
                    Spacer(minLength: 0)
                    Text(module.mark)
                        .font(BOFont.label)
                        .tracking(1.4)
                        .foregroundStyle(module.accent)
                }
                Text(module.name)
                    .font(BOFont.bodyBold)
                    .foregroundStyle(BOColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                if let pulse {
                    Text(pulse.label)
                        .font(BOFont.caption)
                        .foregroundStyle(pulseTint(pulse.tint))
                        .lineLimit(1)
                } else {
                    Text(module.tagline)
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(module.name). \(pulse?.label ?? module.tagline)")
        .accessibilityHint("Opens live desk")
    }

    private func pulseTint(_ tint: IntelligencePulseStore.Pulse.Tint) -> Color {
        switch tint {
        case .positive: return BOColor.statusPositive
        case .negative: return BOColor.statusNegative
        case .caution: return BOColor.statusCaution
        case .informational: return BOColor.statusInformational
        case .caption: return BOColor.textCaption
        }
    }
}
