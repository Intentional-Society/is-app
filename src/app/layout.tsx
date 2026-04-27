import type { Metadata } from "next";
import "./globals.css";
import { Gudea, Ovo } from "next/font/google";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";

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
        <AuthProvider initialUser={user}>
          <SiteHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
