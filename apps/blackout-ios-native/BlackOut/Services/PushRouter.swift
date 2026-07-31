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
        if let url = userInfo["url"] as? String, !url.isEmpty {
            return .init(webPath: normalizePath(url), source: .url(url))
        }

        if let tabRaw = userInfo["tab"] as? String {
            if let path = pathForTab(tabRaw, desk: userInfo["desk"] as? String) {
                return .init(webPath: path, source: .explicitTab)
            }
        }

        if let signalId = userInfo["signalId"] as? String, !signalId.isEmpty {
            let path = signalId.lowercased().contains("hawk") ? "/nighthawk" : "/dashboard"
            return .init(webPath: path, source: .signalId(signalId))
        }

        return .init(webPath: "/dashboard", source: .fallback)
    }

    /// Map a desk path to the IntelligenceRegistry module id (tests + helpers).
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

    private static func pathForTab(_ tabRaw: String, desk: String?) -> String? {
        switch tabRaw.lowercased() {
        case "desks", "intelligence", "command":
            if let desk, let module = IntelligenceRegistry.all.first(where: { $0.id == desk.lowercased() }) {
                return module.webPath
            }
            return "/dashboard"
        case "signals":
            return "/nighthawk"
        case "watchlist":
            return "/dashboard"
        case "account":
            return "/account"
        default:
            return nil
        }
    }

    private static func normalizePath(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http") {
            if let url = URL(string: trimmed), let host = url.host?.lowercased(),
               host == "blackouttrades.com" || host.hasSuffix(".blackouttrades.com") {
                return url.path.isEmpty ? "/" : url.path
            }
        }
        return trimmed.hasPrefix("/") ? trimmed : "/\(trimmed)"
    }
}

public struct PushDestination: Equatable, Sendable {
    public let webPath: String
    public let source: Source

    public enum Source: Equatable, Sendable {
        case explicitTab
        case signalId(String)
        case url(String)
        case fallback
    }
}
