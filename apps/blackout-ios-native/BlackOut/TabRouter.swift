import SwiftUI
import Combine

@MainActor
public final class TabRouter: ObservableObject {
    @Published public var selectedTab: AppTab
    /// Set by push deep-links; DesksView consumes and navigates into the desk.
    @Published public var pendingDeskModuleId: String?

    public init(initial: AppTab = .desks) {
        if let idx = ProcessInfo.processInfo.arguments.firstIndex(of: "-startTab"),
           idx + 1 < ProcessInfo.processInfo.arguments.count,
           let tab = AppTab(rawValue: ProcessInfo.processInfo.arguments[idx + 1]) {
            self.selectedTab = tab
        } else {
            self.selectedTab = initial
        }
    }

    public func route(to tab: AppTab, deskModuleId: String? = nil) {
        selectedTab = tab
        if let deskModuleId {
            pendingDeskModuleId = deskModuleId
        }
    }

    public func consumePendingDesk() {
        pendingDeskModuleId = nil
    }
}
