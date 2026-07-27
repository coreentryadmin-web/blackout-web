import SwiftUI

/// INTELLIGENCE — coordinated access to the six BLACKOUT intelligence modules.
/// Tab 2 of the IA.
///
/// A grid of module cards, each with the desk's identity (accent color +
/// mark + tagline) and a chevron into the detail view. The premise:
/// products are **coordinated intelligence modules inside one system**,
/// not competing tabs — so this is the ONE surface where they live.
struct IntelligenceView: View {
    private let modules = IntelligenceRegistry.all

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.comfortable) {
                intro
                LazyVStack(spacing: BOSpacing.snug) {
                    ForEach(modules) { m in
                        NavigationLink(value: m) {
                            ModuleRow(module: m)
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
        .accessibilityLabel("\(module.name), \(module.tagline)")
        .accessibilityHint("Opens the \(module.name) desk")
        .accessibilityAddTraits(.isButton)
    }
}
