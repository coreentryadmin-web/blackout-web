import SwiftUI

/// Signed-in root — full web iOS product shell (instrument rail + desk chrome).
public struct RootView: View {
    public init() {}

    public var body: some View {
        IosShellView()
    }
}

#Preview("Root") {
    RootView()
        .environmentObject(TabRouter())
        .preferredColorScheme(.dark)
        .tint(BOColor.textAccent)
}
