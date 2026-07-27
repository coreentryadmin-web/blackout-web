import XCTest
import SwiftUI
@testable import BlackOut

/// Contract tests for the intelligence module registry. If a product's
/// accent color, path, or order changes, this suite forces the PR to
/// acknowledge it — brand identity + deep-link routing depend on stability.
final class IntelligenceRegistryTests: XCTestCase {

    func test_exactlySixModules_inCanonicalOrder() {
        let ids = IntelligenceRegistry.all.map(\.id)
        XCTAssertEqual(ids, ["spx-slayer", "helix", "thermal", "largo", "night-hawk", "vector"])
    }

    func test_everyModule_hasNonEmptyIdentityFields() {
        for m in IntelligenceRegistry.all {
            XCTAssertFalse(m.id.isEmpty, "\(m.name) id")
            XCTAssertFalse(m.name.isEmpty, "\(m.id) name")
            XCTAssertFalse(m.mark.isEmpty, "\(m.id) mark")
            XCTAssertFalse(m.systemImage.isEmpty, "\(m.id) systemImage")
            XCTAssertFalse(m.tagline.isEmpty, "\(m.id) tagline")
            XCTAssertFalse(m.purpose.isEmpty, "\(m.id) purpose")
            XCTAssertTrue(m.webPath.hasPrefix("/"), "\(m.id) webPath must be absolute")
        }
    }

    func test_marks_are2To3Chars_upperCase() {
        for m in IntelligenceRegistry.all {
            XCTAssertTrue((2...3).contains(m.mark.count), "\(m.id) mark must be 2 or 3 chars")
            XCTAssertEqual(m.mark, m.mark.uppercased(), "\(m.id) mark must be uppercase")
        }
    }

    func test_accentColors_matchDesignSystemProductPalette() {
        let expected: [(String, Color)] = [
            ("spx-slayer", BOColor.Product.spxSlayer),
            ("helix", BOColor.Product.helix),
            ("thermal", BOColor.Product.thermal),
            ("largo", BOColor.Product.largo),
            ("night-hawk", BOColor.Product.nightHawk),
            ("vector", BOColor.Product.vector),
        ]
        let byId = Dictionary(uniqueKeysWithValues: IntelligenceRegistry.all.map { ($0.id, $0) })
        for (id, color) in expected {
            XCTAssertEqual(byId[id]?.accent, color, "\(id) must use its BOColor.Product accent")
        }
    }

    func test_webPaths_matchTheTabRouteRegistryOnTheWeb() {
        // These MUST equal the corresponding IOS_TOOLS paths in
        // src/lib/ios-tool-routes.ts so a deep link from a push notification
        // reaches the same page whether it opens in the WebView shell or a
        // future native detail view routes through the shell.
        let expected: [String: String] = [
            "spx-slayer": "/dashboard",
            "helix":      "/flows",
            "thermal":    "/heatmap",
            "largo":      "/terminal",
            "night-hawk": "/nighthawk",
            "vector":     "/vector",
        ]
        let byId = Dictionary(uniqueKeysWithValues: IntelligenceRegistry.all.map { ($0.id, $0) })
        for (id, path) in expected {
            XCTAssertEqual(byId[id]?.webPath, path, "\(id) webPath drift")
        }
    }
}
