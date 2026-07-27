import SwiftUI

/// INTELLIGENCE — coordinated access to the six BLACKOUT intelligence modules.
/// Tab 2 of the IA.
///
/// A grid of module cards, each with the desk's identity (accent color +
/// mark + tagline) and a chevron into the detail view. The premise:
/// products are **coordinated intelligence modules inside one system**,
/// not competing tabs — so this is the ONE surface where they live.
///
/// v2 adds a **live pulse strip** under each module — for the two desks
/// that have a mobile aggregator hit today (SPX Slayer, Night Hawk) the
/// row shows the current phase / grade / play-count coming off
/// `/api/mobile/signals`. Other modules fall back to their static tagline;
/// they'll wire in as their own aggregator endpoints land.
struct IntelligenceView: View {
    private let modules = IntelligenceRegistry.all
    @StateObject private var pulse = IntelligencePulseStore()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.comfortable) {
                intro
                LazyVStack(spacing: BOSpacing.snug) {
                    ForEach(modules) { m in
                        NavigationLink(value: m) {
                            ModuleRow(module: m, pulse: pulse.pulse(for: m.id))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Intelligence")
        .navigationBarTitleDisplayMode(.large)
        .task { await pulse.startAutoRefresh() }
        .refreshable { await pulse.refresh() }
        .navigationDestination(for: IntelligenceModule.self) { m in
            ProductDetailView(module: m)
        }
    }

    private var intro: some View {
        Text("Six modules, one system. Each surfaces a different lens on the same live tape.")
            .font(BOFont.body)
            .foregroundStyle(BOColor.textSecondary)
            .padding(.top, BOSpacing.hairline)
    }
}

private struct ModuleRow: View {
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
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: BOSpacing.unit) {
                        Text(module.name)
                            .font(BOFont.heading3)
                            .foregroundStyle(BOColor.textPrimary)
                        Text(module.mark)
                            .font(BOFont.label)
                            .tracking(1.4)
                            .foregroundStyle(module.accent)
                        Spacer(minLength: 0)
                        if let p = pulse {
                            pulseChip(p)
                        }
                    }
                    Text(module.tagline)
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: BOSpacing.snug)
                Image(systemName: "chevron.right")
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.textCaption)
            }
        }
        .frame(minHeight: BOTouchTarget.minimum + 20)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(a11yLabel)
        .accessibilityHint("Opens the \(module.name) desk")
        .accessibilityAddTraits(.isButton)
    }

    private func pulseChip(_ p: IntelligencePulseStore.Pulse) -> some View {
        let tint = tintColor(p.tint)
        return Text(p.label)
            .font(BOFont.label)
            .tracking(1.1)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(tint.opacity(0.4), lineWidth: 1)
            )
            .accessibilityLabel("Live: \(p.label)")
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

    private var a11yLabel: String {
        if let p = pulse {
            return "\(module.name), \(module.tagline). Live: \(p.label)"
        }
        return "\(module.name), \(module.tagline)"
    }
}
