import SwiftUI

/// Two-tab shell: live desks + account. Everything else was scaffold noise.
public enum AppTab: String, CaseIterable, Identifiable {
    case desks   = "desks"
    case account = "account"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .desks:   return "Desks"
        case .account: return "Account"
        }
    }

    public var systemImage: String {
        switch self {
        case .desks:   return "square.grid.2x2"
        case .account: return "person.crop.circle"
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
        .preferredColorScheme(.dark)
        .tint(BOColor.textAccent)
}
