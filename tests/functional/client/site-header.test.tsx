import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

import { SiteHeader } from "@/components/site-header";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

import { AuthProvider } from "@/components/auth-provider";

const user = { id: "u1", email: "a@b.c" } as unknown as User;

describe("SiteHeader", () => {
  it("renders nothing when there is no user", () => {
    const { container } = render(
      <AuthProvider initialUser={null}>
        <SiteHeader />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the menu trigger when a user is present", () => {
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader />
      </AuthProvider>,
    );
    expect(screen.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  it("opening the menu logs no console errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByText("Home")).toBeVisible();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
