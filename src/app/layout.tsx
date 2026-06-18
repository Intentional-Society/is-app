import "./globals.css";

import type { Metadata } from "next";
import { Gudea, Ovo } from "next/font/google";

import { AuthProvider } from "@/components/auth-provider";
import { LegacyBrowserNotice } from "@/components/legacy-browser-notice";
import { NavigationHistory } from "@/components/navigation-history";
import { QueryProvider } from "@/components/query-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeScript } from "@/components/theme-script";
import { UpdateBanner } from "@/components/update-banner";
import { loadMe } from "@/lib/api-server";
import { getServerUser } from "@/lib/supabase/server-user";
import { cn } from "@/lib/utils";

const gudea = Gudea({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-gudea",
});

const ovo = Ovo({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-ovo",
});

// Default metadata for the app. The whole app is noindex by default —
// it's a members-only network. The three public pages (/, /signin,
// /signup) opt back in with their own robots: { index: true } export.
//
// title.template prefixes every page's own title with "IS Web: " so the
// browser history stack and tab strip stay scannable (each page sets a
// distinct title via its own metadata export). The home page and any
// page that sets no title fall back to title.default.
export const metadata: Metadata = {
  title: {
    template: "IS Web: %s",
    default: "Intentional Society Web App",
  },
  description: "The IS Web App — for the member network of Intentional Society",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Intentional Society Web App",
    description: "The IS Web App — for the member network of Intentional Society",
    url: "https://app.intentionalsociety.org",
    siteName: "Intentional Society Web App",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getServerUser();
  const me = user ? await loadMe() : null;

  return (
    // suppressHydrationWarning: ThemeScript adds .dark to <html> before
    // React hydrates, so the class attribute legitimately differs from
    // the server-rendered markup. Scoped to this element only.
    <html lang="en" className={cn("font-sans", gudea.variable, ovo.variable)} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <LegacyBrowserNotice />
        <AuthProvider initialUser={user}>
          <QueryProvider>
            <NavigationHistory />
            <SiteHeader displayName={me?.profile?.displayName ?? null} isAdmin={me?.profile?.isAdmin ?? false} />
            {children}
            <UpdateBanner />
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
