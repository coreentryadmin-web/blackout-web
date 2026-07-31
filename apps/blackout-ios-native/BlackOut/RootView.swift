import SwiftUI

/// Four-tab shell: live desks, signals feed, watchlist, and account.
public enum AppTab: String, CaseIterable, Identifiable {
    case desks     = "desks"
    case signals   = "signals"
    case watchlist = "watchlist"
    case account   = "account"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .desks:     return "Desks"
        case .signals:   return "Signals"
        case .watchlist: return "Watchlist"
        case .account:   return "Account"
        }
    }

    public var systemImage: String {
        switch self {
        case .desks:     return "square.grid.2x2"
        case .signals:   return "bolt.fill"
        case .watchlist: return "star"
        case .account:   return "person.crop.circle"
        }
    }
}

public struct RootView: View {
    @EnvironmentObject private var router: TabRouter

    public init() {}

    public var body: some View {
        TabView(selection: $router.selectedTab) {
            DesksView()
                .tabItem { Label(AppTab.desks.title, systemImage: AppTab.desks.systemImage) }
                .tag(AppTab.desks)

            SignalsView()
                .tabItem { Label(AppTab.signals.title, systemImage: AppTab.signals.systemImage) }
                .tag(AppTab.signals)

            WatchlistView()
                .tabItem { Label(AppTab.watchlist.title, systemImage: AppTab.watchlist.systemImage) }
                .tag(AppTab.watchlist)

            NavigationStack {
                AccountView()
            }
            .tabItem { Label(AppTab.account.title, systemImage: AppTab.account.systemImage) }
            .tag(AppTab.account)
        }
    }
}

#Preview("Root") {
    RootView()
        .environmentObject(TabRouter())
        .environmentObject(WatchlistStore())
        .preferredColorScheme(.dark)
        .tint(BOColor.textAccent)
}
