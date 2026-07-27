import SwiftUI

/// The one empty-state layout used across every native screen.
///
/// Empty states are NOT decorative — the master prompt calls out
/// "empty states" as a first-class required screen state, distinct from
/// loading and error. This one shows an icon, a headline, a plain-English
/// explanation, and (optionally) a single primary action. That's it — no
/// illustration budget, no marketing copy.
public struct BOEmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    let actionTitle: String?
    let action: (() -> Void)?

    public init(
        systemImage: String,
        title: String,
        message: String,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: BOSpacing.snug) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .regular))
                .foregroundStyle(BOColor.textCaption)
            Text(title)
                .font(BOFont.heading3)
                .foregroundStyle(BOColor.textPrimary)
                .multilineTextAlignment(.center)
            Text(message)
                .font(BOFont.caption)
                .foregroundStyle(BOColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(BOFont.label)
                    .tracking(1.4)
                    .textCase(.uppercase)
                    .buttonStyle(.bordered)
                    .tint(BOColor.textAccent)
                    .padding(.top, BOSpacing.hairline)
                    .frame(minHeight: BOTouchTarget.minimum)
            }
        }
        .padding(BOSpacing.loose)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(message)")
    }
}
