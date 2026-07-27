import Foundation

/// Thin HTTP client for the BlackOut backend.
///
/// One place for:
///   - URL composition off `AppConfig.backendURL`
///   - JSON decode + typed error mapping
///   - Timeout / cache policy discipline
///
/// Not a full-featured networking library — deliberately small. Repositories
/// hold references to a `APIClient` (via a protocol) so tests inject a fake
/// that returns canned responses; production wires the URLSession-backed one.
///
/// Cookies (Clerk `__session`) ride URLSession.shared's cookie store — set by
/// the first authenticated web flow the app performs. Full Sign in with Apple
/// + a native session bridge lands later in TECHNICAL-ARCHITECTURE.md's auth
/// section; until then, un-authed reads still work for public endpoints
/// (market/regime, market/gex-positioning), and authed reads carry the
/// cookie automatically.
public enum APIError: Error, Equatable {
    case invalidURL
    case network(String)
    case notAuthorized      // 401
    case forbidden          // 403 (tier gate)
    case notFound           // 404
    case rateLimited(retryAfter: Int?) // 429
    case serverError(status: Int, body: String?)
    case decodingFailed(String)
    case timeout
    case cancelled
}

public protocol APIClient {
    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T
}

public struct URLSessionAPIClient: APIClient {
    private let session: URLSession
    private let decoder: JSONDecoder
    private let base: URL

    public init(session: URLSession = .shared, base: URL = AppConfig.backendURL) {
        // A dedicated decoder so callers don't have to know about date formats
        // etc. Defaults are conservative — flip these when a specific endpoint
        // needs snake_case or custom dates.
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        self.decoder = d
        self.session = session
        self.base = base
    }

    public func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        guard let url = URL(string: path, relativeTo: base) else { throw APIError.invalidURL }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("BlackOutNative/\(AppConfig.appVersion)", forHTTPHeaderField: "user-agent")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.network("no HTTPURLResponse") }

            switch http.statusCode {
            case 200..<300:
                do { return try decoder.decode(T.self, from: data) }
                catch { throw APIError.decodingFailed(String(describing: error)) }
            case 401: throw APIError.notAuthorized
            case 403: throw APIError.forbidden
            case 404: throw APIError.notFound
            case 429:
                let retryAfter = Int(http.value(forHTTPHeaderField: "retry-after") ?? "")
                throw APIError.rateLimited(retryAfter: retryAfter)
            default:
                let body = String(data: data, encoding: .utf8)?.prefix(300).description
                throw APIError.serverError(status: http.statusCode, body: body)
            }
        } catch let err as APIError { throw err }
        catch let err as URLError where err.code == .timedOut { throw APIError.timeout }
        catch let err as URLError where err.code == .cancelled { throw APIError.cancelled }
        catch { throw APIError.network(error.localizedDescription) }
    }
}
