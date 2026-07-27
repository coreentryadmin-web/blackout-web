import SwiftUI

/// BLACKOUT color tokens.
///
/// This is the single source of truth for every color in the app. Rules:
/// 1. **Never** use `Color(hex:)` or `Color.black`/`.white` inline in a view.
///    If a color isn't in this file, add it here first — then use it — so the
///    tokens stay complete and the design system stays coherent.
/// 2. **Semantic layer over palette layer:** views read semantic names
///    (`BOColor.textPrimary`, `BOColor.walkedFlip`), not raw palette
///    (`.bull`, `.void`). Palette can change; semantic contracts don't.
/// 3. **Red is reserved for RISK.** Never use red for accent, decoration, or
///    "just a warning" — only for invalidation, loss, or actively-negative
///    market state. Amber is the correct "caution / watching" color.
///
/// Cross-referenced against `docs/ios/DESIGN-SYSTEM.md`; ports the web CSS
/// tokens from `src/app/ios-native-tokens.css`, `ios-native-skin.css`, and
/// `globals.css` so web and native stay visually aligned.
public enum BOColor {

    // MARK: - Palette (raw colors; prefer the semantic layer below)

    /// #040407 — the deep void that grounds every surface. Not pure black; a
    /// hint of blue-purple so the phosphor greens read as living, not neon.
    public static let void = Color(red: 0x04/255, green: 0x04/255, blue: 0x07/255)

    /// #0A0B12 — the near-void chrome surface (headers, tab bar background).
    public static let voidChrome = Color(red: 0x0A/255, green: 0x0B/255, blue: 0x12/255)

    /// #14161E — cards / raised surfaces.
    public static let charcoal = Color(red: 0x14/255, green: 0x16/255, blue: 0x1E/255)

    /// #1F222D — the border/rule line between surfaces.
    public static let rule = Color(red: 0x1F/255, green: 0x22/255, blue: 0x2D/255)

    /// #FFFFFF ink — the primary type color on dark grounds.
    public static let ink = Color.white

    /// #A6ADBB — muted secondary type.
    public static let inkMuted = Color(red: 0xA6/255, green: 0xAD/255, blue: 0xBB/255)

    /// #6C7280 — captions, timestamps, chart tick labels.
    public static let inkCaption = Color(red: 0x6C/255, green: 0x72/255, blue: 0x80/255)

    /// #00E676 — controlled BLACKOUT green. Bullish / positive / entry / OK.
    public static let bull = Color(red: 0x00/255, green: 0xE6/255, blue: 0x76/255)

    /// #FF3B47 — used ONLY for risk, invalidation, loss, or negative state.
    /// Not an accent. Not a "look here". Not a decoration.
    public static let risk = Color(red: 0xFF/255, green: 0x3B/255, blue: 0x47/255)

    /// #FFB020 — caution / watching / conditional. Used when we lack conviction
    /// or the setup is confirming, not for anything actionable-negative.
    public static let caution = Color(red: 0xFF/255, green: 0xB0/255, blue: 0x20/255)

    /// #4EC9F5 — cool informational cyan for market-data metadata (timestamps,
    /// data-source, freshness indicators). Distinct from bull/risk so it never
    /// implies direction.
    public static let info = Color(red: 0x4E/255, green: 0xC9/255, blue: 0xF5/255)

    /// Per-desk product accents. Match `IOS_TOOLS` in
    /// `src/lib/ios-tool-routes.ts` exactly so identity travels across
    /// surfaces (a HELIX action reads violet on web, in the WebView shell,
    /// and in this native app).
    public enum Product {
        public static let spxSlayer = bull                                            // #00E676
        public static let helix     = Color(red: 0xBF/255, green: 0x5F/255, blue: 0xFF/255) // #BF5FFF
        public static let thermal   = Color(red: 0xFF/255, green: 0x6B/255, blue: 0x2B/255) // #FF6B2B
        public static let largo     = Color(red: 0x22/255, green: 0xD3/255, blue: 0xEE/255) // #22D3EE
        public static let nightHawk = Color(red: 0xFF/255, green: 0x2D/255, blue: 0x55/255) // #FF2D55
        public static let vector    = bull                                            // Vector shares SPX green
    }

    // MARK: - Semantic layer (VIEWS SHOULD USE THESE)

    // Backgrounds
    public static let backgroundBase       = void
    public static let backgroundElevated   = voidChrome
    public static let backgroundCard       = charcoal

    // Type
    public static let textPrimary          = ink
    public static let textSecondary        = inkMuted
    public static let textCaption          = inkCaption
    public static let textAccent           = bull

    // Divider / border
    public static let border               = rule
    public static let borderStrong         = inkCaption.opacity(0.35)

    // Semantic status (charts, badges, banners)
    public static let statusPositive       = bull
    public static let statusNegative       = risk
    public static let statusCaution        = caution
    public static let statusInformational  = info
}
