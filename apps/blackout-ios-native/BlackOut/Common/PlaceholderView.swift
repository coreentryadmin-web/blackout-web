import SwiftUI

/// Explicit, honest placeholder — the design-system-conformant scaffold every
/// tab starts from. The point is not to hide that the module isn't built yet;
/// the point is to make the ROADMAP visible inside the app so anyone opening
/// the tab knows exactly what's coming, and no one mistakes a scaffold for a
/// finished feature. Replace one by one as native modules ship.
public struct PlaceholderView: View {
    let title: String
    let subtitle: String
    let plannedFeatures: [String]

    public init(title: String, subtitle: String, plannedFeatures: [String]) {
        self.title = title
        self.subtitle = subtitle
        self.plannedFeatures = plannedFeatures
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.block) {
                header
                statusChip
                planList
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.large)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: BOSpacing.unit) {
            Text(subtitle)
                .font(BOFont.body)
                .foregroundStyle(BOColor.textSecondary)
        }
    }

    private var statusChip: some View {
        Label {
            Text("Scaffold — native build in progress")
                .font(BOFont.label)
                .textCase(.uppercase)
                .tracking(1.4)
        } icon: {
            Circle().fill(BOColor.statusCaution).frame(width: 6, height: 6)
        }
        .foregroundStyle(BOColor.textSecondary)
        .padding(.horizontal, BOSpacing.snug)
        .padding(.vertical, BOSpacing.hairline + 2)
        .background(
            RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                .strokeBorder(BOColor.border, lineWidth: 1)
        )
    }

    private var planList: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            Text("Planned")
                .font(BOFont.label)
                .textCase(.uppercase)
                .tracking(1.4)
                .foregroundStyle(BOColor.textCaption)
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                ForEach(plannedFeatures, id: \.self) { feature in
                    HStack(alignment: .firstTextBaseline, spacing: BOSpacing.snug) {
                        Text("·")
                            .font(BOFont.body)
                            .foregroundStyle(BOColor.textAccent)
                        Text(feature)
                            .font(BOFont.body)
                            .foregroundStyle(BOColor.textPrimary)
                    }
                }
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                    .fill(BOColor.backgroundCard)
            )
            .overlay(
                RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                    .strokeBorder(BOColor.border, lineWidth: 1)
            )
        }
    }
}

#Preview("Placeholder") {
    NavigationStack {
        PlaceholderView(
            title: "Command",
            subtitle: "The default market command center — what matters right now.",
            plannedFeatures: [
                "Session header with SPX, SPY, QQQ, VIX, breadth",
                "Market regime (gamma / dealer positioning / vol state)",
                "Top intelligence brief",
                "Active opportunities (3–5)",
                "What changed — prioritized timeline",
                "Product pulse from each module",
            ]
        )
    }
    .preferredColorScheme(.dark)
    .tint(BOColor.textAccent)
}
