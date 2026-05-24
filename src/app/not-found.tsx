import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-6xl font-bold">
        404
        <span className="sr-only"> Page not found</span>
      </h1>
      <p className="font-serif italic text-lg text-muted-foreground">This page doesn&apos;t exist — or maybe it wandered off.</p>
      <Button render={<Link href="/" />}>Go home</Button>
    </main>
  );
}
