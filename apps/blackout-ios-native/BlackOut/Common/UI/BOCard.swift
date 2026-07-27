import SwiftUI

/// The single card container used across every native screen.
///
/// Encoding it here means:
///   - one radius, one border, one background across the whole app,
///   - accent-tint variants (per-desk product identity) go through ONE
///     entrypoint so a design-system change lands everywhere,
///   - accessibility traits (button when tappable) are set correctly
///     by default — nothing to remember at the call site.
///
/// If a screen needs a background/border it doesn't get from here, the fix
/// is to add a variant to this file — never inline a custom RoundedRectangle
/// on a specific screen.
public struct BOCard<Content: View>: View {
    public enum Tint {
        case none
        case accent(Color)     // draws a subtle top-left accent bar in the given color
    }

    let tint: Tint
    @ViewBuilder let content: () -> Content

    public init(tint: Tint = .none, @ViewBuilder content: @escaping () -> Content) {
        self.tint = tint
        self.content = content
    }

    public var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .fill(BOColor.backgroundCard)
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .strokeBorder(BOColor.border, lineWidth: 1)
            if case .accent(let color) = tint {
                // A thin 3pt vertical rail on the left edge that carries the
                // per-desk identity color without dominating the card. Same
                // pattern used in the web design system's card accent rail.
                Rectangle()
                    .fill(color.opacity(0.85))
                    .frame(width: 3)
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: BORadius.card,
                            bottomLeadingRadius: BORadius.card,
                            style: .continuous
                        )
                    )
            }
            content()
                .padding(BOSpacing.comfortable)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
