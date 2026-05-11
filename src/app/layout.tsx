import "./globals.css";

import type { Metadata } from "next";
import { Gudea, Ovo } from "next/font/google";

import { AuthProvider } from "@/components/auth-provider";
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

export const metadata: Metadata = {
  title: "Intentional Society",
  description: "Community application for Intentional Society",
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
            <SiteHeader displayName={me?.profile?.displayName ?? null} isAdmin={me?.profile?.isAdmin ?? false} />
            {children}
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
