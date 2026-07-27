import SwiftUI

/// Per-desk detail screen. Today: identity card + purpose + "Open on web"
/// (which the WKWebView shell handles, so `webPath` lands on the same live
/// desk the app already renders). As each native desk lands, this switch
/// swaps its case for the real native view.
public struct ProductDetailView: View {
    let module: IntelligenceModule

    public init(module: IntelligenceModule) { self.module = module }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.block) {
                header
                purposeCard
                comingCard
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle(module.name)
        .navigationBarTitleDisplayMode(.large)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: BOSpacing.comfortable) {
            ZStack {
                Circle()
                    .fill(module.accent.opacity(0.16))
                    .frame(width: 56, height: 56)
                Image(systemName: module.systemImage)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(module.accent)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(module.mark)
                    .font(BOFont.label)
                    .tracking(1.8)
                    .foregroundStyle(module.accent)
                Text(module.tagline)
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
            }
            Spacer(minLength: BOSpacing.snug)
        }
    }

    private var purposeCard: some View {
        BOCard(tint: .accent(module.accent)) {
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                BOSectionLabel("Purpose")
                Text(module.purpose)
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var comingCard: some View {
        BOCard {
            VStack(alignment: .leading, spacing: BOSpacing.unit) {
                BOSectionLabel("Native module")
                Text("This module is rendered by the web app inside the iOS shell today. Native \(module.name) migrates per the plan in TECHNICAL-ARCHITECTURE.md — the API contracts already in place (see API-CONTRACTS.md) will feed the SwiftUI implementation as it lands.")
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
