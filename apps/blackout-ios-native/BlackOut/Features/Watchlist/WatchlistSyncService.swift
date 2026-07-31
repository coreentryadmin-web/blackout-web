import Foundation

/// Cross-device watchlist sync — talks to `GET/PUT /api/user/watchlist`.
///
/// Same signed-in user on web + iOS sees the same list. UserDefaults remains
/// the source of truth locally (so the app renders instantly and works offline);
/// this service pulls the server list on load and pushes changes as they
/// happen. Conflict policy: LAST-WRITE-WINS (the client that saved most
/// recently wins). That's the right default for a personal list of tickers —
/// no field can be independently edited across devices, so a merge algorithm
/// would only produce a phantom third state.
///
/// Protocol-injected so `WatchlistStore` doesn't require a live network for
/// its unit tests.
public protocol WatchlistSyncing: Sendable {
    /// Fetch the server list. Returns nil when not signed in / no network /
    /// no DB — caller keeps the local list on nil.
    func fetchRemote() async -> [String]?
    /// Push the local list. Returns the server-normalized echo on success,
    /// nil on any failure. Never throws.
    func pushLocal(_ tickers: [String]) async -> [String]?
}

/// URLSession-backed adapter. Uses the same session as APIClient so the Clerk
/// `__session` cookie rides existing auth.
public struct URLSessionWatchlistSync: WatchlistSyncing {
    private let session: URLSession
    private let base: URL

    public init(session: URLSession = .shared, base: URL = AppConfig.backendURL) {
        self.session = session
        self.base = base
    }

    public func fetchRemote() async -> [String]? {
        guard let url = URL(string: "/api/user/watchlist", relativeTo: base) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("BlackOutNative/\(AppConfig.appVersion)", forHTTPHeaderField: "user-agent")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            let decoded = try JSONDecoder().decode(WatchlistPayload.self, from: data)
            return decoded.tickers
        } catch {
            return nil
        }
    }

    public func pushLocal(_ tickers: [String]) async -> [String]? {
        guard let url = URL(string: "/api/user/watchlist", relativeTo: base) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("BlackOutNative/\(AppConfig.appVersion)", forHTTPHeaderField: "user-agent")
        request.httpBody = try? JSONEncoder().encode(WatchlistPayload(tickers: tickers))
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            let decoded = try JSONDecoder().decode(WatchlistPayload.self, from: data)
            return decoded.tickers
        } catch {
            return nil
        }
    }
}

private struct WatchlistPayload: Codable {
    let tickers: [String]
}
