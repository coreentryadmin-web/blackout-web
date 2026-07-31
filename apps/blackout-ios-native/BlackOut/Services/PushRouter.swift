import Foundation
import Combine

@MainActor
public final class PushRouter: ObservableObject {
    @Published public private(set) var pending: PushDestination?

    public init() {}

    public func handleTap(userInfo: [AnyHashable: Any]) {
        pending = Self.destination(from: userInfo)
    }

    public func consume() {
        pending = nil
    }

    public static func destination(from userInfo: [AnyHashable: Any]) -> PushDestination {
        if let tabRaw = userInfo["tab"] as? String,
           let tab = AppTab(rawValue: tabRaw.lowercased()) {
            let deskId = (userInfo["desk"] as? String) ?? deskModuleId(from: userInfo["url"] as? String)
            return .init(tab: tab, deskModuleId: deskId, source: .explicitTab)
        }

        if let signalId = userInfo["signalId"] as? String, !signalId.isEmpty {
            let module = signalId.lowercased().contains("hawk") ? "night-hawk" : "spx-slayer"
            return .init(tab: .desks, deskModuleId: module, source: .signalId(signalId))
        }

        if let url = userInfo["url"] as? String {
            if url.lowercased().hasPrefix("/account") {
                return .init(tab: .account, deskModuleId: nil, source: .url(url))
            }
            if let moduleId = deskModuleId(from: url) {
                return .init(tab: .desks, deskModuleId: moduleId, source: .url(url))
            }
        }

        return .init(tab: .desks, deskModuleId: "spx-slayer", source: .fallback)
    }

    /// Map a desk path to the IntelligenceRegistry module id.
    public static func deskModuleId(from url: String?) -> String? {
        guard let url else { return nil }
        let path = url.lowercased()
        if path.hasPrefix("/dashboard") { return "spx-slayer" }
        if path.hasPrefix("/flows")     { return "helix" }
        if path.hasPrefix("/heatmap")   { return "thermal" }
        if path.hasPrefix("/terminal")  { return "largo" }
        if path.hasPrefix("/nighthawk")  { return "night-hawk" }
        if path.hasPrefix("/vector")    { return "vector" }
        return nil
    }
}

public struct PushDestination: Equatable, Sendable {
    public let tab: AppTab
    public let deskModuleId: String?
    public let source: Source

    public enum Source: Equatable, Sendable {
        case explicitTab
        case signalId(String)
        case url(String)
        case fallback
    }
}
