import { auth } from "@clerk/nextjs/server";
import { Nav } from "@/components/Nav";
import { IosAppChrome } from "@/components/ios/IosAppChrome";
import { IosNativePageTransition } from "@/components/ios/IosNativePageTransition";
import { IosAppTabBar } from "@/components/IosAppTabBar";
import { MarketSessionProvider } from "@/components/platform/MarketSessionProvider";
import { MarketPulseLayer } from "@/components/platform/MarketPulseLayer";
import { isAdminUser } from "@/lib/admin-access";
import { lockedToolKeys, type ToolKey } from "@/lib/tool-access";
import { AppShellProviders } from "@/components/providers/AppShellProviders";
import { jetbrainsMono } from "@/lib/fonts-mono";
import { inter } from "@/lib/fonts-sans";
import "../globals.css";
import "../desk-app.css";
import "../ios-native.css";
import "../ios-native-pages.css";
import "../ios-native-nav.css";
import "../ios-native-skin.css";
import "../ios-native-motion.css";
import "../ios-native-command.css";
import "../ios-native-iphone16.css";
import "../ios-native-viewport.css";
import "../ios-native-input-lock.css";
import "../ios-native-tokens.css";
import "../ios-native-organize.css";
import "../ios-native-tab-rail.css";
import "../ios-native-cards.css";

/**
 * Transparent route group — does NOT affect URLs. Hoists the shared <Nav />
 * (a position:fixed banner) so the ~dozen in-app pages no longer each import +
 * render it. Pages keep their own wrapper/backdrop chrome; Nav being pinned to
 * the viewport means its position in the tree is layout-neutral.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  let lockedTools: ToolKey[] = [];
  try {
    const { userId } = await auth();
    if (userId && !(await isAdminUser(userId))) lockedTools = lockedToolKeys();
  } catch {
    lockedTools = [];
  }

  return (
    <div className={`${jetbrainsMono.variable} ${inter.variable}`}>
      <AppShellProviders>
        <MarketSessionProvider />
        <MarketPulseLayer />
        <Nav lockedTools={lockedTools} />
        <IosAppChrome lockedTools={lockedTools} />
        <IosAppTabBar lockedTools={lockedTools} />
        <IosNativePageTransition>{children}</IosNativePageTransition>
      </AppShellProviders>
    </div>
  );
}
