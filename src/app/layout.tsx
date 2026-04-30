import type { Metadata } from "next";
import "./globals.css";
import { Gudea, Ovo } from "next/font/google";
import { setupI18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/components/auth-provider";
import { LinguiClientProvider } from "@/components/lingui-client-provider";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";

// Server-side i18n for RSC <T> usage. Mirrors the client-side setup in
// LinguiClientProvider. With no catalogs loaded, the macro's inlined English
// source is what renders. See docs/doc-strategy-i18n.md.
setI18n(setupI18n({ locale: "en", messages: { en: {} } }));

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className={cn("font-sans", gudea.variable, ovo.variable)}>
      <body className="antialiased">
        <LinguiClientProvider>
          <AuthProvider initialUser={user}>
            <SiteHeader />
            {children}
          </AuthProvider>
        </LinguiClientProvider>
      </body>
    </html>
  );
}
