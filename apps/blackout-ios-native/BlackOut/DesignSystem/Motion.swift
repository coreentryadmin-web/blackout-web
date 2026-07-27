import SwiftUI

/// BLACKOUT motion tokens.
///
/// Motion communicates status change and hierarchy. It must NEVER be decorative.
/// Every animation here has a specific semantic role — pick the token for the
/// intent, not the visual (`.contextSwitch` if the screen swapped, not
/// `"a nice slide"`).
///
/// All tokens honor `@Environment(\.accessibilityReduceMotion)` — callers
/// should wrap non-essential motion in `!reduceMotion ? animation : nil`.
public enum BOMotion {
    /// Instant state toggle (checkbox flip, small selection change) — 120ms.
    public static let instant  = Animation.easeOut(duration: 0.12)
    /// A live-data tick refreshing in place — 220ms interpolating spring.
    public static let dataTick = Animation.interactiveSpring(response: 0.22, dampingFraction: 0.85, blendDuration: 0)
    /// A tab switch or context change — 320ms spring.
    public static let contextSwitch = Animation.spring(response: 0.32, dampingFraction: 0.86, blendDuration: 0)
    /// A sheet or modal presenting — 380ms spring.
    public static let sheet    = Animation.spring(response: 0.38, dampingFraction: 0.82, blendDuration: 0)
    /// A skeleton pulse waiting for data — infinite, 1.2s.
    public static let skeleton = Animation.easeInOut(duration: 1.2).repeatForever(autoreverses: true)
}
