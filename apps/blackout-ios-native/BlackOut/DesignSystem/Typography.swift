import SwiftUI

/// BLACKOUT typography.
///
/// Type discipline (per docs/ios/DESIGN-SYSTEM.md):
/// - **SF Pro Display** for major headings (Apple system default; no bundled font).
/// - **SF Pro Text** for readable interface copy (also the system default at body sizes).
/// - **SF Mono** for prices, strikes, timestamps, percentages, options data —
///   anywhere digit alignment matters. Tabular figures on by default via `.monospacedDigit()`.
/// - The BLACKOUT branded display font is **not** used inside the app on iOS;
///   product identity comes from color + icon + composition, not a decorative
///   face on body text. (The web uses Anton for hero moments; SwiftUI would
///   need to bundle it and it'd fight Dynamic Type accessibility.)
///
/// Every scale supports **Dynamic Type**: pass `.relativeTo:` so text scales
/// with the user's iOS accessibility setting. This is a release requirement,
/// not a nice-to-have.
public enum BOFont {

    // MARK: - Display / headline (SF Pro Display, weight-dialed)

    /// Screen-level page title. Used sparingly (once per screen at most).
    public static let display    = Font.system(.largeTitle, design: .default).weight(.heavy)
    /// Section-level heading.
    public static let heading1   = Font.system(.title,      design: .default).weight(.bold)
    /// Sub-section heading.
    public static let heading2   = Font.system(.title2,     design: .default).weight(.semibold)
    /// Sub-sub-section / card title.
    public static let heading3   = Font.system(.title3,     design: .default).weight(.semibold)

    // MARK: - Body / interface

    /// Prose body copy.
    public static let body       = Font.system(.body,       design: .default)
    public static let bodyBold   = Font.system(.body,       design: .default).weight(.semibold)
    /// Compact secondary copy (metadata, footnotes).
    public static let caption    = Font.system(.footnote,   design: .default)
    /// Uppercase labels — pair with `.tracking(1.5)` and `.textCase(.uppercase)` at the call site.
    public static let label      = Font.system(.caption,    design: .default).weight(.semibold)

    // MARK: - Numeric (SF Mono, tabular)

    /// Big display numbers — SPX print, primary price, hero metric.
    /// Callers should chain `.monospacedDigit()` for column alignment.
    public static let numericHero    = Font.system(.largeTitle, design: .monospaced).weight(.bold)
    public static let numericHeading = Font.system(.title,      design: .monospaced).weight(.semibold)
    /// Standard price / strike / percent / timestamp cell.
    public static let numericBody    = Font.system(.body,       design: .monospaced)
    /// Compact numeric cell for dense tables.
    public static let numericCaption = Font.system(.footnote,   design: .monospaced)
}
