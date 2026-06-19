import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { titleFor } from "@/lib/page-titles";

export const metadata: Metadata = { title: titleFor("/colors") };

export default function ColorsPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Theme palette</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Tokens defined in <code className="font-mono">src/app/globals.css</code>. Dev-only.
        </p>
      </header>

      <Palette label="Light" />
      <div className="dark">
        <Palette label="Dark" />
      </div>
    </main>
  );
}

function Palette({ label }: { label: string }) {
  return (
    <section className="rounded-lg border border-border bg-background p-6 text-foreground">
      <h2 className="mb-6 text-lg font-semibold">{label}</h2>

      <Group title="Surfaces">
        <Pair name="background" fgName="foreground" />
        <Pair name="card" fgName="card-foreground" />
        <Pair name="popover" fgName="popover-foreground" />
      </Group>

      <Group title="Roles">
        <Pair name="primary" fgName="primary-foreground" />
        <Pair name="secondary" fgName="secondary-foreground" />
        <Pair name="muted" fgName="muted-foreground" />
        <Pair name="accent" fgName="accent-foreground" />
      </Group>

      <Group title="States">
        <Single name="destructive" />
        <Pair name="success" fgName="success-foreground" />
      </Group>

      <BlockGroup title="Form-control chrome">
        <ChromeRow />
      </BlockGroup>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function BlockGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Pair({ name, fgName }: { name: string; fgName: string }) {
  return (
    <div className="flex flex-col">
      <div
        className="flex h-20 items-center justify-center rounded border border-border"
        style={{ backgroundColor: `var(--${name})`, color: `var(--${fgName})` }}
      >
        <span className="text-base">Aa</span>
      </div>
      <div className="mt-2 font-mono text-sm">--{name}</div>
      <div className="font-mono text-[10px] text-muted-foreground">fg: --{fgName}</div>
    </div>
  );
}

function Single({ name }: { name: string }) {
  return (
    <div className="flex flex-col">
      <div className="h-20 rounded border border-border" style={{ backgroundColor: `var(--${name})` }} />
      <div className="mt-2 font-mono text-sm">--{name}</div>
    </div>
  );
}

function ChromeRow() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="flex flex-col">
        <div
          className="flex h-20 items-center justify-center rounded border-2"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm text-muted-foreground">2px border</span>
        </div>
        <div className="mt-2 font-mono text-sm">--border</div>
      </div>
      <div className="flex flex-col">
        <div className="flex h-20 items-center justify-center rounded border-2" style={{ borderColor: "var(--input)" }}>
          <span className="text-sm text-muted-foreground">input border</span>
        </div>
        <div className="mt-2 font-mono text-sm">--input</div>
      </div>
      <div className="flex flex-col">
        <div className="flex h-20 items-center justify-center rounded" style={{ boxShadow: "0 0 0 3px var(--ring)" }}>
          <span className="text-sm text-muted-foreground">focus ring</span>
        </div>
        <div className="mt-2 font-mono text-sm">--ring</div>
      </div>
    </div>
  );
}
