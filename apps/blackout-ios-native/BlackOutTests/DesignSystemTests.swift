import XCTest
import SwiftUI
@testable import BlackOut

/// Contract tests for the design system. If a token's value changes, this
/// suite forces the PR to explicitly bless the change (a design decision) —
/// not a bug where a hex slipped in a merge.
final class DesignSystemTests: XCTestCase {

    // MARK: - Colors

    func test_semanticColors_useIntendedPaletteEntries() {
        // The semantic layer is the contract views rely on. If someone
        // repoints textPrimary at inkMuted "for a cleaner look", this
        // catches it in review.
        XCTAssertEqual(BOColor.backgroundBase, BOColor.void)
        XCTAssertEqual(BOColor.backgroundElevated, BOColor.voidChrome)
        XCTAssertEqual(BOColor.backgroundCard, BOColor.charcoal)
        XCTAssertEqual(BOColor.textPrimary, BOColor.ink)
        XCTAssertEqual(BOColor.textSecondary, BOColor.inkMuted)
        XCTAssertEqual(BOColor.textCaption, BOColor.inkCaption)
        XCTAssertEqual(BOColor.textAccent, BOColor.bull)
        XCTAssertEqual(BOColor.statusPositive, BOColor.bull)
        XCTAssertEqual(BOColor.statusNegative, BOColor.risk)
        XCTAssertEqual(BOColor.statusCaution, BOColor.caution)
        XCTAssertEqual(BOColor.statusInformational, BOColor.info)
    }

    func test_productAccents_matchWebRegistry() {
        // These MUST match `IOS_TOOLS` in src/lib/ios-tool-routes.ts so
        // brand identity travels 1:1 across web, WebView shell, and native.
        // (Web hex values, per src/lib/ios-tool-routes.ts.)
        XCTAssertEqual(BOColor.Product.spxSlayer, BOColor.bull)                 // #00E676
        XCTAssertEqual(BOColor.Product.helix,     rgb(0xBF, 0x5F, 0xFF))         // #BF5FFF
        XCTAssertEqual(BOColor.Product.thermal,   rgb(0xFF, 0x6B, 0x2B))         // #FF6B2B
        XCTAssertEqual(BOColor.Product.largo,     rgb(0x22, 0xD3, 0xEE))         // #22D3EE
        XCTAssertEqual(BOColor.Product.nightHawk, rgb(0xFF, 0x2D, 0x55))         // #FF2D55
        XCTAssertEqual(BOColor.Product.vector,    BOColor.bull)                  // shares SPX green
    }

    // MARK: - Spacing / radius / touch

    func test_spacingScale_isMonotonic() {
        // The scale must be strictly ascending — an out-of-order token means
        // someone renamed a value without updating the intent, which produces
        // subtle rhythm bugs in dense screens.
        let scale: [CGFloat] = [
            BOSpacing.hairline, BOSpacing.unit, BOSpacing.snug,
            BOSpacing.comfortable, BOSpacing.loose, BOSpacing.block,
            BOSpacing.section, BOSpacing.hero,
        ]
        XCTAssertEqual(scale, scale.sorted())
    }

    func test_touchTarget_meetsAppleMinimum() {
        // Apple HIG: 44x44 pt. This is a release requirement, not a preference.
        XCTAssertGreaterThanOrEqual(BOTouchTarget.minimum, 44)
    }

    func test_radiusScale_isMonotonic() {
        let scale: [CGFloat] = [BORadius.chip, BORadius.control, BORadius.card, BORadius.sheet]
        XCTAssertEqual(scale, scale.sorted())
    }

    // MARK: - helpers

    private func rgb(_ r: Int, _ g: Int, _ b: Int) -> Color {
        Color(red: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255)
    }
}
