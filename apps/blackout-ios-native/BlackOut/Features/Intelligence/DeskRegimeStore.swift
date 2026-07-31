import Foundation

@MainActor
public final class DeskRegimeStore: ObservableObject {
    @Published public private(set) var regime: MarketRegime?
    @Published public private(set) var fetchedAt: Date?
    @Published public private(set) var lastError: String?

    private let repo: MarketRegimeRepository

    public init(repo: MarketRegimeRepository = LiveMarketRegimeRepository()) {
        self.repo = repo
    }

    public func startAutoRefresh(intervalSeconds: UInt64 = 30) async {
        await refresh()
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: intervalSeconds * 1_000_000_000)
            } catch { return }
            await refresh()
        }
    }

    public func refresh() async {
        do {
            regime = try await repo.latest()
            fetchedAt = Date()
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }
}
