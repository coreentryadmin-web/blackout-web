import SwiftUI
import Combine

@MainActor
public final class TabRouter: ObservableObject {
    /// Push deep-links set this; IosShellView navigates the WebView then clears it.
    @Published public var pendingWebPath: String?

    public init() {}

    public func navigate(to path: String) {
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        pendingWebPath = normalized
    }

    public func consumePendingNavigation() {
        pendingWebPath = nil
    }
}
