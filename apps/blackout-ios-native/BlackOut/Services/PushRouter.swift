import Foundation
import Combine

/// Routes push-notification taps to app tabs.
///
/// Sits between the UIApplicationDelegate callback (which cannot own SwiftUI
/// state directly — it's a UIKit class) and TabRouter (which owns
/// `@Published var selectedTab`, a SwiftUI environment object).
///
/// The delegate hands us a raw `[AnyHashable: Any]` userInfo dict; we
/// parse it into a structured `PushDestination` and publish. `BlackOutApp`
/// subscribes and forwards to `TabRouter` — that indirection means the
/// delegate never touches SwiftUI state and this class can be unit-tested
/// in isolation without spinning up an app scene.
///
/// The wire contract mirrors what the server sends in the APNs `userInfo`
/// dictionary (see `src/lib/push/send-apns-push.ts`):
///   { "url": "/dashboard" }         → Command tab
///   { "url": "/flows" }             → Intelligence tab (Helix desk)
///   { "url": "/nighthawk" }         → Signals tab (Night Hawk)
///   { "url": "/heatmap" }           → Intelligence tab (Thermal)
///   { "url": "/vector" }            → Intelligence tab (Vector)
///   { "tab": "watchlist" }          → Watchlist tab (explicit tab key wins)
///   { "signalId": "..." }           → Signals tab (any signal-specific push)
///
/// Anything else falls through to Command as the safest default — a tap
/// that lands on a valid tab is better than a tap that dumps you into a
/// blank view or an unrelated screen.
@MainActor
public final class PushRouter: ObservableObject {
    /// The most recent push tap the app hasn't consumed yet. Published so
    /// the App-level observer picks it up automatically. Nil after consume.
    @Published public private(set) var pending: PushDestination?

    public init() {}

    /// Called from the AppDelegate when the OS delivers a push tap.
    public func handleTap(userInfo: [AnyHashable: Any]) {
        pending = Self.destination(from: userInfo)
    }

    /// Called by the App-level observer after routing so we don't re-fire
    /// the same tap on a subsequent view re-render.
    public func consume() {
        pending = nil
    }

    /// Pure-function classifier — takes a userInfo dict, returns the tab
    /// to route to. Kept public + static so unit tests exercise it without
    /// instantiating the class.
    public static func destination(from userInfo: [AnyHashable: Any]) -> PushDestination {
        // Explicit `tab` key wins — the server can bypass URL heuristics
        // when it knows exactly which tab a push should land on.
        if let tabRaw = userInfo["tab"] as? String,
           let tab = AppTab(rawValue: tabRaw.lowercased()) {
            return .init(tab: tab, source: .explicitTab)
        }
        // Signal-specific pushes always land on Signals — the underlying
        // signal is what the user is being pinged about.
        if let signalId = userInfo["signalId"] as? String, !signalId.isEmpty {
            return .init(tab: .signals, source: .signalId(signalId))
        }
        // URL heuristic — map desk paths to the tabs those desks live under
        // in the app's information architecture (all desks live inside
        // Intelligence except SPX which is Command's default, and Night
        // Hawk which is the Signals feed's primary source).
        if let url = userInfo["url"] as? String {
            let path = url.lowercased()
            if path.hasPrefix("/dashboard") { return .init(tab: .command,      source: .url(url)) }
            if path.hasPrefix("/nighthawk") { return .init(tab: .signals,      source: .url(url)) }
            if path.hasPrefix("/flows")     { return .init(tab: .intelligence, source: .url(url)) }
            if path.hasPrefix("/heatmap")   { return .init(tab: .intelligence, source: .url(url)) }
            if path.hasPrefix("/vector")    { return .init(tab: .intelligence, source: .url(url)) }
            if path.hasPrefix("/terminal")  { return .init(tab: .intelligence, source: .url(url)) }
            if path.hasPrefix("/watchlist") { return .init(tab: .watchlist,    source: .url(url)) }
            if path.hasPrefix("/account")   { return .init(tab: .account,      source: .url(url)) }
        }
        // Fallback — a tap that lands on Command (the default tab) is
        // better than a tap that dumps you into a blank state or leaves
        // the app on whatever screen it happened to be on.
        return .init(tab: .command, source: .fallback)
    }
}

/// Where a push tap wants to land + how we decided.
public struct PushDestination: Equatable, Sendable {
    public let tab: AppTab
    public let source: Source

    public enum Source: Equatable, Sendable {
        case explicitTab
        case signalId(String)
        case url(String)
        case fallback
    }
}
