"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function SiteHeader({ displayName }: { displayName: string | null }) {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <header className="fixed top-0 right-0 z-40 p-3">
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open menu" />
          }
        >
          <Menu />
        </SheetTrigger>
        <SheetContent
          side="right"
          className="data-[side=right]:w-[40%] data-[side=right]:sm:max-w-[12.5rem]"
        >
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            {displayName ? (
              <p className="font-serif italic text-sm text-muted-foreground">
                {displayName}
              </p>
            ) : null}
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-4 pb-4">
            <SheetClose
              nativeButton={false}
              render={
                <Link href="/" className="rounded px-2 py-2 hover:bg-muted">
                  Home
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link
                  href="/invites"
                  className="rounded px-2 py-2 hover:bg-muted"
                >
                  Invite a friend
                </Link>
              }
            />
            <SheetClose
              nativeButton={false}
              render={
                <Link
                  href="/profile"
                  className="rounded px-2 py-2 hover:bg-muted"
                >
                  My profile
                </Link>
              }
            />
            <form action="/logout" method="post">
              <SheetClose
                render={
                  <button
                    type="submit"
                    className="w-full cursor-pointer rounded px-2 py-2 text-left hover:bg-muted"
                  >
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
