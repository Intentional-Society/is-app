import "./globals.css";

import type { Metadata } from "next";
import { Gudea, Ovo } from "next/font/google";

import { AuthProvider } from "@/components/auth-provider";
import { NavigationHistory } from "@/components/navigation-history";
import { QueryProvider } from "@/components/query-provider";
import { SiteHeader } from "@/components/site-header";
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
export const metadata: Metadata = {
  title: "Intentional Society Web App",
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
    <html lang="en" className={cn("font-sans", gudea.variable, ovo.variable)}>
      <body className="antialiased">
        <AuthProvider initialUser={user}>
          <QueryProvider>
            <NavigationHistory />
            <SiteHeader displayName={me?.profile?.displayName ?? null} isAdmin={me?.profile?.isAdmin ?? false} />
            {children}
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
