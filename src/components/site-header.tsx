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

export function SiteHeader() {
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
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-4 pb-4">
            <SheetClose
              render={
                <Link href="/" className="rounded px-2 py-2 hover:bg-muted">
                  Home
                </Link>
              }
            />
            <SheetClose
              render={
                <Link
                  href="/welcome"
                  className="rounded px-2 py-2 hover:bg-muted"
                >
                  Welcome
                </Link>
              }
            />
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
