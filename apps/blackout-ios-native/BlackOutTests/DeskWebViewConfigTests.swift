import XCTest
@testable import BlackOut

/// Contract tests for desk URL composition used by embedded WebViews.
final class DeskWebViewConfigTests: XCTestCase {

    func test_deskURL_resolvesAgainstProductionBackend() {
        let url = AppConfig.deskURL(path: "/dashboard")
        XCTAssertEqual(url.host, "blackouttrades.com")
        XCTAssertEqual(url.path, "/dashboard")
        XCTAssertEqual(url.scheme, "https")
    }

    func test_deskURL_normalizesPathsWithoutLeadingSlash() {
        let url = AppConfig.deskURL(path: "flows")
        XCTAssertEqual(url.path, "/flows")
    }

    func test_iosShellUserAgent_includesIosAppToken_only() {
        let ua = AppConfig.iosShellWebUserAgent
        XCTAssertTrue(ua.contains("BlackOutiOSApp"), "web ios-app CSS + instrument rail")
        XCTAssertFalse(ua.contains("BlackOutNativeEmbed"), "must not hide web chrome")
    }

    func test_deskWebUserAgent_includesNativeEmbed_forSwiftUIChrome() {
        let ua = AppConfig.deskWebUserAgent
        XCTAssertTrue(ua.contains("BlackOutiOSApp"))
        XCTAssertTrue(ua.contains("BlackOutNativeEmbed"))
    }

    func test_everyIntelligenceModule_deskURLMatchesRegistryPath() {
        for module in IntelligenceRegistry.all {
            let url = AppConfig.deskURL(path: module.webPath)
            XCTAssertEqual(url.path, module.webPath, "\(module.id) desk path")
        }
    }
}
