import SwiftUI

/// Uppercased, tracked section label used above every group of cards.
///
/// Wrapped as its own view so:
///   - the label style is defined once (BOFont.label + tracking + textCase),
///   - a future accessibility bump (larger tracking for Dynamic Type XL etc.)
///     lands in one place.
public struct BOSectionLabel: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text)
            .font(BOFont.label)
            .tracking(1.4)
            .textCase(.uppercase)
            .foregroundStyle(BOColor.textCaption)
            // Announce as a section header to VoiceOver so users navigating by
            // header rotor land on it (matches the visual role).
            .accessibilityAddTraits(.isHeader)
    }
}
