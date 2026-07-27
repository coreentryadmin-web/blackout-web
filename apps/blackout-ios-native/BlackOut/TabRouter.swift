import SwiftUI
import Combine

/// Cross-tab navigation coordinator.
///
/// One published `selectedTab`, owned at the App level and injected via
/// `.environmentObject(...)`. Any screen can jump the app to another tab by
/// mutating this — the Command "Active opportunities" card taps into
/// Signals, deep-link handlers push into Watchlist, etc. Without this, every
/// tap that leaves the current tab has to plumb a closure through view
/// initialisers, which fights SwiftUI's inference and doesn't scale to
/// deep-linked routes.
///
/// Kept intentionally tiny — no navigation history, no destination stacks
/// (each tab already owns its own `NavigationStack`). This class only owns
/// **which tab is on screen**; per-tab navigation stays on the per-tab
/// NavigationPath as SwiftUI intends.
@MainActor
public final class TabRouter: ObservableObject {
    @Published public var selectedTab: AppTab

    public init(initial: AppTab = .command) {
        self.selectedTab = initial
    }

    /// Sugar for call sites — reads at the point of use as an intent
    /// ("route to Signals") rather than a state mutation.
    public func route(to tab: AppTab) {
        selectedTab = tab
    }
}
