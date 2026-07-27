import SwiftUI

/// The setup lifecycle every signal in BLACKOUT walks — same set the SPX
/// Slayer + Night Hawk grading engines use on the backend
/// (docs/ios/INFORMATION-ARCHITECTURE.md, Signals tab).
///
/// Order matters: the filter rail renders in this exact sequence
/// (left-to-right = earliest→latest lifecycle stage). Add cases at the END
/// so existing analytics slugs stay stable.
public enum SignalLifecycle: String, CaseIterable, Identifiable, Codable, Sendable {
    case detected
    case confirming
    case active
    case managing
    case closed
    case invalidated
    case graded

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .detected:    return "Detected"
        case .confirming:  return "Confirming"
        case .active:      return "Active"
        case .managing:    return "Managing"
        case .closed:      return "Closed"
        case .invalidated: return "Invalid"
        case .graded:      return "Graded"
        }
    }

    /// The tint for this stage. Deliberately NOT bull/red — those are for
    /// direction and risk; lifecycle uses the informational (cyan) family
    /// for pre-execution states, accent green for active/managing, caution
    /// for invalidated, muted for closed/graded (history).
    public var tint: Color {
        switch self {
        case .detected, .confirming: return BOColor.statusInformational
        case .active, .managing:     return BOColor.statusPositive
        case .invalidated:           return BOColor.statusNegative
        case .closed, .graded:       return BOColor.textCaption
        }
    }
}
