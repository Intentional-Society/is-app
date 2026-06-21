"use client";

import { House, Menu, Moon, Settings, ShieldCheck, Sun, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLogger } from "next-axiom";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { clearNavHistory } from "@/lib/page-titles";
import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Internal nav links share one shape: a SheetClose (so the menu closes
// on tap) wrapping a Link that clears the breadcrumb history. The
// optional className layers extra styling on top of the shared base.
function MenuLink({
  href,
  className,
  children,
}: {
  href: React.ComponentProps<typeof Link>["href"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <SheetClose
      nativeButton={false}
      render={
        <Link href={href} onClick={clearNavHistory} className={cn("rounded px-2 py-2 hover:bg-muted", className)}>
          {children}
        </Link>
      }
    />
  );
}

// The top-left corner: a home link styled as an icon button. Plain
// anchor + buttonVariants rather than <Button render>: Base UI stamps
// role="button" on rendered anchors, and this one should announce as
// the link it is.
function HomeLink() {
  return (
    <div className="fixed top-0 left-0 z-40 p-3" data-tour="home-icon">
      <Link
        href="/"
        aria-label="Home"
        onClick={clearNavHistory}
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <House />
      </Link>
    </div>
  );
}

// The top-right corner: the hamburger trigger and the nav sheet it opens.
function MenuSheet({ displayName, isAdmin }: { displayName: string | null; isAdmin: boolean }) {
  const { user } = useAuth();
  const log = useLogger();
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const pref = readThemePreference();
    if (pref === "dark") {
      setIsDark(true);
    } else if (pref === "system") {
      const prefersDark =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDark(prefersDark);
    } else {
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const next: ThemePreference = isDark ? "light" : "dark";
    applyThemePreference(next);
    setIsDark(!isDark);
    // Mirror the settings-page selector's log so theme adoption is
    // countable per-person; `source` distinguishes which affordance.
    log.info("theme-selected", { theme: next, userId: user?.id ?? null, source: "nav" });
  };

  return (
    <div className="fixed top-0 right-0 z-40 p-3">
      <Sheet>
        <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="data-[side=right]:w-[45%] data-[side=right]:sm:max-w-[14rem] gap-2"
        >
          <SheetHeader>
            <div className="flex items-center gap-1">
              <SheetTitle className="mr-auto">Menu</SheetTitle>
              <SheetClose
                render={
                  <button
                    type="button"
                    className="cursor-pointer rounded p-1.5 hover:bg-muted"
                    aria-label="Settings"
                    onClick={() => {
                      clearNavHistory();
                      window.location.assign("/me#settings");
                    }}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                }
              />
              {mounted ? (
                <button
                  type="button"
                  className="cursor-pointer rounded p-1.5 hover:bg-muted"
                  aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                  onClick={toggleTheme}
                >
                  {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>
              ) : (
                <span className="p-1.5">
                  <span className="block h-4 w-4" />
                </span>
              )}
              <SheetClose
                render={
                  <button type="button" className="cursor-pointer rounded p-1.5 hover:bg-muted" aria-label="Close">
                    <XIcon className="h-4 w-4" />
                  </button>
                }
              />
            </div>
            {displayName ? (
              <SheetClose
                render={
                  <button
                    type="button"
                    className="cursor-pointer text-left font-serif italic text-sm text-muted-foreground hover:underline"
                    onClick={() => {
                      clearNavHistory();
                      window.location.assign("/me#profile");
                    }}
                  >
                    {displayName}
                  </button>
                }
              />
            ) : null}
          </SheetHeader>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 pb-4">
            <MenuLink href="/">Home</MenuLink>
            <MenuLink href="/programs">Programs</MenuLink>
            <MenuLink href="/members">Member directory</MenuLink>
            <MenuLink href="/intentions">Current intentions</MenuLink>
            <MenuLink href="/myweb">My web</MenuLink>
            <MenuLink href="/invites">Invite a friend</MenuLink>
            <MenuLink href="/about">About</MenuLink>
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLScXhdSxbQ3LxjiYhqN2fmuyy66SK292rTYEZV3QaHgzn1eVjA/viewform?usp=dialog"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-2 hover:bg-muted"
            >
              Give Feedback
            </a>
            {isAdmin ? (
              <MenuLink href="/admin" className="flex items-center gap-2 text-green-700">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Admin dashboard
              </MenuLink>
            ) : null}
            <form action="/signout" method="post">
              <SheetClose
                render={
                  <button type="submit" className="w-full cursor-pointer rounded px-2 py-2 text-left hover:bg-muted">
                    Sign out
                  </button>
                }
              />
            </form>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function SiteHeader({ displayName, isAdmin }: { displayName: string | null; isAdmin: boolean }) {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;
  // The /welcome steps stay free of exits — no home link, no menu — so
  // members finish the sequence (#399).
  if (pathname.startsWith("/welcome")) return null;

  return (
    <header>
      {/* Invisible spotlight target for the /myweb farewell tour: one
       * strip covering the home icon and the menu (joyride steps take a
       * single target), sized to the icons' box (size-8 + p-3). */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-14" data-tour="top-bar" />
      <HomeLink />
      <MenuSheet displayName={displayName} isAdmin={isAdmin} />
    </header>
  );
}
