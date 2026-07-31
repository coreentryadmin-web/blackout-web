import SwiftUI

/// Primary tab — six live desks. Tap a module → full-screen authenticated web desk.
/// No marketing scaffolding, no duplicate regime cards, no skeleton placeholders.
struct DesksView: View {
    @EnvironmentObject private var tabRouter: TabRouter
    @StateObject private var pulse = IntelligencePulseStore()
    @State private var path = NavigationPath()

    private let modules = IntelligenceRegistry.all

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(spacing: BOSpacing.snug) {
                    ForEach(modules) { module in
                        NavigationLink(value: module) {
                            DeskRow(module: module, pulse: pulse.pulse(for: module.id))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(BOSpacing.comfortable)
            }
            .background(BOColor.backgroundBase.ignoresSafeArea())
            .navigationTitle("Desks")
            .navigationBarTitleDisplayMode(.large)
            .task { await pulse.startAutoRefresh() }
            .refreshable { await pulse.refresh() }
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
}

private struct DeskRow: View {
    let module: IntelligenceModule
    let pulse: IntelligencePulseStore.Pulse?

    var body: some View {
        BOCard(tint: .accent(module.accent)) {
            HStack(alignment: .center, spacing: BOSpacing.comfortable) {
                ZStack {
                    Circle()
                        .fill(module.accent.opacity(0.14))
                        .frame(width: 44, height: 44)
                    Image(systemName: module.systemImage)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(module.accent)
                }
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: BOSpacing.unit) {
                        Text(module.name)
                            .font(BOFont.heading3)
                            .foregroundStyle(BOColor.textPrimary)
                        Text(module.mark)
                            .font(BOFont.label)
                            .tracking(1.4)
                            .foregroundStyle(module.accent)
                        Spacer(minLength: 0)
                        if let pulse {
                            pulseChip(pulse)
                        }
                    }
                    if pulse == nil {
                        Text(module.tagline)
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                            .lineLimit(1)
                    }
                }
                Image(systemName: "chevron.right")
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.textCaption)
            }
        }
        .frame(minHeight: BOTouchTarget.minimum + 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Opens \(module.name)")
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityLabel: String {
        if let pulse {
            return "\(module.name). Live: \(pulse.label)"
        }
        return "\(module.name). \(module.tagline)"
    }

    private func pulseChip(_ pulse: IntelligencePulseStore.Pulse) -> some View {
        let tint = tintColor(pulse.tint)
        return Text(pulse.label)
            .font(BOFont.label)
            .tracking(1.1)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(tint.opacity(0.4), lineWidth: 1)
            )
    }

    private func tintColor(_ tint: IntelligencePulseStore.Pulse.Tint) -> Color {
        switch tint {
        case .positive:      return BOColor.statusPositive
        case .negative:      return BOColor.statusNegative
        case .caution:       return BOColor.statusCaution
        case .informational: return BOColor.statusInformational
        case .caption:       return BOColor.textCaption
        }
    }
}
