"use client";

import { Menu, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { clearNavHistory } from "@/lib/route-labels";

export function SiteHeader({ displayName, isAdmin }: { displayName: string | null; isAdmin: boolean }) {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <header className="fixed top-0 right-0 z-40 p-3">
      <Sheet>
        <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent side="right" className="data-[side=right]:w-[40%] data-[side=right]:sm:max-w-[12.5rem]">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            {displayName ? <p className="font-serif italic text-sm text-muted-foreground">{displayName}</p> : null}
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-4 pb-4">
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  Home
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/programs" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  Programs
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/members" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  Member directory
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/myweb" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  My web
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/profile" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  My profile
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/invites" onClick={clearNavHistory} className="rounded px-2 py-2 hover:bg-muted">
                  Invite a friend
                </Link>
              }
            />
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLScXhdSxbQ3LxjiYhqN2fmuyy66SK292rTYEZV3QaHgzn1eVjA/viewform?usp=dialog"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-2 hover:bg-muted"
            >
              Give Feedback
            </a>
            {isAdmin ? (
              <SheetClose
                nativeButton={false}
                render={
                  <Link href="/admin" onClick={clearNavHistory} className="flex items-center gap-2 rounded px-2 py-2 text-green-700 hover:bg-muted">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    Admin dashboard
                  </Link>
                }
              />
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
    </header>
  );
}
