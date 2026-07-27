import SwiftUI

/// Filter chip — used by the Signals lifecycle rail, the Watchlist filter
/// rail, and anywhere the user picks one option from a small horizontal set.
///
/// The chip is a real button: 44pt hit target on the height axis, selected
/// state has an accessibility trait, and the label is always announced as
/// its selection state (matches iOS system filter chip semantics).
public struct BOChip: View {
    let title: String
    let count: Int?
    let isSelected: Bool
    let tint: Color
    let action: () -> Void

    public init(
        title: String,
        count: Int? = nil,
        isSelected: Bool,
        tint: Color = BOColor.textAccent,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.count = count
        self.isSelected = isSelected
        self.tint = tint
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(BOFont.label)
                    .tracking(1.2)
                    .textCase(.uppercase)
                if let count {
                    Text(String(count))
                        .font(BOFont.numericCaption)
                        .monospacedDigit()
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            Capsule().fill(
                                (isSelected ? tint : BOColor.textCaption).opacity(0.18)
                            )
                        )
                }
            }
            .foregroundStyle(isSelected ? tint : BOColor.textSecondary)
            .padding(.horizontal, BOSpacing.snug + 2)
            .padding(.vertical, BOSpacing.unit)
            .frame(minHeight: BOTouchTarget.minimum)
            .background(
                RoundedRectangle(cornerRadius: BORadius.control, style: .continuous)
                    .fill(isSelected ? tint.opacity(0.10) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: BORadius.control, style: .continuous)
                    .strokeBorder(isSelected ? tint.opacity(0.55) : BOColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(isSelected ? "selected" : "")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
