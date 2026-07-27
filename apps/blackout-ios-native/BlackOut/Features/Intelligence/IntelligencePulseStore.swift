import Foundation
import Combine

/// Live per-module pulse strings for the Intelligence tab.
///
/// Fetches `/api/mobile/signals` once per 60s and derives a short status
/// line per module from the aggregate sources — SPX Slayer's live phase
/// ("SCANNING" / "WATCHING" / "OPEN + A"), Night Hawk's live play count
/// with stale/degraded flags. Other modules (Helix, Thermal, Largo,
/// Vector) don't have a mobile aggregator hit yet, so this store returns
/// nil for them; the row falls back to its static tagline.
///
/// Owned once at IntelligenceView level and shared across ModuleRows so
/// six rows don't fan out into six parallel requests.
@MainActor
public final class IntelligencePulseStore: ObservableObject {
    @Published public private(set) var feed: SignalsFeed?
    @Published public private(set) var lastError: String?

    private let repo: SignalsRepository

    public init(repo: SignalsRepository = LiveSignalsRepository()) { self.repo = repo }

    /// Continuous refresh — call from `.task` in the view so cancellation
    /// on disappear stops it for free. 60s is deliberately slower than the
    /// per-tab views (30s) because Intelligence is a summary surface, not
    /// a decision surface — extra freshness there is waste.
    public func startAutoRefresh(intervalSeconds: UInt64 = 60) async {
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
            let f = try await repo.fetch()
            feed = f
            lastError = nil
        } catch {
            // Preserve-on-error — leave the last feed in place. The row
            // falls back to the static tagline if we never had a feed.
            lastError = String(describing: error)
        }
    }

    /// Compact live pulse for a module. Returns nil to fall back to the
    /// module's static tagline — never a "loading" or "n/a" placeholder
    /// that would clutter the summary card.
    public func pulse(for moduleId: String) -> Pulse? {
        guard let feed else { return nil }
        switch moduleId {
        case "spx-slayer":
            return spxPulse(feed: feed)
        case "night-hawk":
            return nightHawkPulse(feed: feed)
        default:
            // Helix / Thermal / Largo / Vector don't have a mobile aggregator
            // read yet — nil so the static tagline shows instead. Wire each
            // in as its own aggregator endpoint lands.
            return nil
        }
    }

    // MARK: - Per-module derivations

    private func spxPulse(feed: SignalsFeed) -> Pulse? {
        let src = feed.sources.spxSlayer
        guard src.available else { return Pulse(label: "Offline", tint: .caption) }
        // Prefer the live projected signal (has grade + direction); fall
        // back to the raw phase from the sources block.
        if let s = feed.signals.first(where: { $0.source == .spxSlayer }) {
            var parts: [String] = [s.phase.label.uppercased()]
            if let g = s.grade, !g.isEmpty { parts.append(g) }
            if let d = s.direction, !d.isEmpty { parts.append(d.uppercased()) }
            return Pulse(label: parts.joined(separator: " · "), tint: tint(for: s.phase))
        }
        return Pulse(label: src.phase.uppercased(), tint: .informational)
    }

    private func nightHawkPulse(feed: SignalsFeed) -> Pulse? {
        let src = feed.sources.nightHawk
        if !src.available { return Pulse(label: "Awaiting close", tint: .caption) }
        let base = "\(src.playCount) play\(src.playCount == 1 ? "" : "s")"
        if src.stale {
            return Pulse(label: "\(base) · stale", tint: .caution)
        }
        if src.degraded {
            return Pulse(label: "\(base) · legacy", tint: .caution)
        }
        return Pulse(label: base, tint: .positive)
    }

    private func tint(for phase: SignalLifecycle) -> Pulse.Tint {
        switch phase {
        case .active, .managing: return .positive
        case .confirming, .detected: return .informational
        case .invalidated: return .negative
        case .closed, .graded: return .caption
        }
    }

    // MARK: - View-facing type

    public struct Pulse: Equatable {
        public let label: String
        public let tint: Tint
        public enum Tint { case positive, negative, caution, informational, caption }
    }
}
