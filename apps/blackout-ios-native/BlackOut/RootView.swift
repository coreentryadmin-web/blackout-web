import SwiftUI

/// The 5-tab unified information architecture defined in
/// `docs/ios/INFORMATION-ARCHITECTURE.md`. Order and slugs are load-bearing
/// (analytics, deep-links, and the pinned-tab test all depend on them) —
/// change only through the IA doc, not ad-hoc.
///
/// Note the deliberate departure from the old WebView shell's product-per-tab
/// layout (SPX / Helix / Thermal / Largo / NightHawk): products are now
/// **intelligence modules inside Intelligence**, not competing tabs. The tabs
/// are decisions the user needs to make (Command / Signals / Watchlist),
/// not vendors of features.
public enum AppTab: String, CaseIterable, Identifiable {
    case command      = "command"
    case intelligence = "intelligence"
    case signals      = "signals"
    case watchlist    = "watchlist"
    case account      = "account"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .command:      return "Command"
        case .intelligence: return "Intelligence"
        case .signals:      return "Signals"
        case .watchlist:    return "Watchlist"
        case .account:      return "Account"
        }
    }

    public var systemImage: String {
        switch self {
        case .command:      return "chart.line.uptrend.xyaxis"
        case .intelligence: return "brain.head.profile"
        case .signals:      return "bolt.badge.clock"
        case .watchlist:    return "star"
        case .account:      return "person.crop.circle"
        }
    }
}

/// Root of the app. Owns the tab selection state; each tab is a self-contained
/// screen with its own `NavigationStack` so back-stacks don't cross-pollute.
public struct RootView: View {
    @State private var selectedTab: AppTab = .command

    public init() {}

    public var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack {
                    tabRoot(for: tab)
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
            }
        }
    }

    @ViewBuilder
    private func tabRoot(for tab: AppTab) -> some View {
        switch tab {
        case .command:      CommandView()
        case .intelligence: IntelligenceView()
        case .signals:      SignalsView()
        case .watchlist:    WatchlistView()
        case .account:      AccountView()
        }
    }
}

#Preview("Root") {
    RootView()
        .preferredColorScheme(.dark)
        .tint(BOColor.textAccent)
}
