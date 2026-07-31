import SwiftUI
import WebKit

/// Embeds a live BlackOut desk page (`/dashboard`, `/flows`, …) inside native
/// SwiftUI. Uses the same Clerk session cookies as `APIClient` and appends the
/// `BlackOutiOSApp` + `BlackOutNativeEmbed` user-agent tokens so the web app
/// applies iOS desk CSS without rendering duplicate nav chrome (the native
/// `NavigationStack` owns the title/back affordance).
struct DeskWebView: View {
    let url: URL

    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ZStack {
            DeskWebViewRepresentable(
                url: url,
                isLoading: $isLoading,
                loadError: $loadError
            )
            if isLoading {
                ProgressView()
                    .tint(BOColor.textAccent)
            }
            if let loadError {
                VStack(alignment: .leading, spacing: BOSpacing.snug) {
                    Label("Desk unavailable", systemImage: "exclamationmark.triangle.fill")
                        .font(BOFont.bodyBold)
                        .foregroundStyle(BOColor.statusCaution)
                    Text(loadError)
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(BOSpacing.comfortable)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .background(BOColor.backgroundBase.opacity(0.92))
            }
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
    }
}

// MARK: - UIKit bridge

private struct DeskWebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 4 / 255, green: 4 / 255, blue: 7 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.customUserAgent = AppConfig.deskWebUserAgent
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false

        context.coordinator.webView = webView
        context.coordinator.load(url: url)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Reload when the target URL changes (e.g. user navigates to another module).
        if context.coordinator.lastLoadedURL != url {
            context.coordinator.load(url: url)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: DeskWebViewRepresentable
        weak var webView: WKWebView?
        var lastLoadedURL: URL?

        init(parent: DeskWebViewRepresentable) {
            self.parent = parent
        }

        func load(url: URL) {
            lastLoadedURL = url
            parent.isLoading = true
            parent.loadError = nil
            Task { @MainActor in
                guard let webView else { return }
                await syncSessionCookies(into: webView.configuration.websiteDataStore.httpCookieStore)
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
                request.setValue(AppConfig.deskWebUserAgent, forHTTPHeaderField: "User-Agent")
                webView.load(request)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let ns = error as NSError
            // External link handoff cancels the in-webview load — not a desk failure.
            if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled {
                return
            }
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            // Keep desk navigation inside the webview; bounce checkout/marketing to Safari.
            if navigationAction.navigationType == .linkActivated,
               !Self.isAllowedInWebView(target) {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        private static func isAllowedInWebView(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased() else { return false }
            let allowedSuffixes = [
                "blackouttrades.com",
                "clerk.blackouttrades.com",
                "clerk.accounts.dev",
                "challenges.cloudflare.com",
                "tradingview.com",
            ]
            return allowedSuffixes.contains { host == $0 || host.hasSuffix(".\($0)") }
        }

        @MainActor
        private func syncSessionCookies(into store: WKHTTPCookieStore) async {
            for cookie in HTTPCookieStorage.shared.cookies ?? [] {
                guard cookie.domain.contains("blackouttrades.com") else { continue }
                await store.setCookie(cookie)
            }
        }
    }
}
