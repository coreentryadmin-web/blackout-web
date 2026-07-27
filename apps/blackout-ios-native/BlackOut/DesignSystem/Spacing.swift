import CoreGraphics

/// BLACKOUT spacing + radius tokens.
///
/// One 4pt-based scale, used everywhere. Never inline a magic number
/// (`.padding(11)`) — either the design says 8 or 12, or a new token needs to
/// be justified and added here. This keeps rhythms consistent across screens.
public enum BOSpacing {
    /// 4 pt — hairline gap (e.g. label above a numeric cell).
    public static let hairline: CGFloat = 4
    /// 8 pt — the base unit. Row internal padding, tight vertical rhythm.
    public static let unit:     CGFloat = 8
    /// 12 pt — snug card padding.
    public static let snug:     CGFloat = 12
    /// 16 pt — the default screen edge inset + comfortable padding.
    public static let comfortable: CGFloat = 16
    /// 20 pt — loose padding, between-section space on dense screens.
    public static let loose:    CGFloat = 20
    /// 24 pt — headline block spacing.
    public static let block:    CGFloat = 24
    /// 32 pt — major section separation.
    public static let section:  CGFloat = 32
    /// 48 pt — hero / launch-screen scale (rare).
    public static let hero:     CGFloat = 48
}

/// Corner radius tokens. Match `docs/ios/DESIGN-SYSTEM.md`.
public enum BORadius {
    /// 4 pt — chip / pill / small tag.
    public static let chip: CGFloat  = 4
    /// 8 pt — button / input.
    public static let control: CGFloat = 8
    /// 12 pt — card / sheet cell.
    public static let card: CGFloat  = 12
    /// 16 pt — modal sheet.
    public static let sheet: CGFloat = 16
}

/// Minimum tap target. Apple HIG: 44 x 44 pt.
public enum BOTouchTarget {
    public static let minimum: CGFloat = 44
}
