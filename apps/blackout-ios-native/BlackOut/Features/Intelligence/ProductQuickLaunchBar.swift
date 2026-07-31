import SwiftUI

/// One-tap access to every live product desk — HELIX, Thermal, and the full suite.
struct ProductQuickLaunchBar: View {
    let modules: [IntelligenceModule]
    var onSelect: (IntelligenceModule) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            BOSectionLabel("Open desk")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BOSpacing.snug) {
                    ForEach(modules) { module in
                        Button {
                            onSelect(module)
                        } label: {
                            QuickLaunchChip(module: module)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .accessibilityLabel("Quick launch all product desks")
    }
}

private struct QuickLaunchChip: View {
    let module: IntelligenceModule

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(module.accent.opacity(0.18))
                    .frame(width: 44, height: 44)
                Image(systemName: module.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(module.accent)
            }
            Text(module.mark)
                .font(BOFont.label)
                .tracking(1.2)
                .foregroundStyle(module.accent)
            Text(shortName)
                .font(BOFont.caption)
                .foregroundStyle(BOColor.textSecondary)
                .lineLimit(1)
                .frame(maxWidth: 72)
        }
        .padding(.vertical, BOSpacing.snug)
        .padding(.horizontal, BOSpacing.unit)
        .background(
            RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                .fill(BOColor.backgroundCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                .stroke(module.accent.opacity(0.35), lineWidth: 1)
        )
        .accessibilityLabel("\(module.name), open desk")
    }

    private var shortName: String {
        switch module.id {
        case "helix": return "HELIX"
        case "thermal": return "Thermal"
        case "night-hawk": return "Hawk"
        default: return module.name.split(separator: " ").first.map(String.init) ?? module.name
        }
    }
}
