import SwiftUI

/// Setup lifecycle stages — mirrors `src/lib/mobile/signals-projection.ts`.
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

    public var tint: Color {
        switch self {
        case .detected, .confirming: return BOColor.statusInformational
        case .active, .managing:     return BOColor.statusPositive
        case .invalidated:           return BOColor.statusNegative
        case .closed, .graded:       return BOColor.textCaption
        }
    }
}
