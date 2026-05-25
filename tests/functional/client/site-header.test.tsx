import type { User } from "@supabase/supabase-js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
        <SiteHeader displayName={null} isAdmin={false} />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the menu trigger when a user is present", () => {
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader displayName={null} isAdmin={false} />
      </AuthProvider>,
    );
    expect(screen.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  it("opening the menu logs no console errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader displayName={null} isAdmin={false} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByText("Home")).toBeVisible();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("hides the Admin link when isAdmin is false", async () => {
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader displayName={null} isAdmin={false} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    await screen.findByText("Home");
    expect(screen.queryByText("Admin dashboard")).toBeNull();
  });

  it("shows the Admin link when isAdmin is true", async () => {
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader displayName={null} isAdmin={true} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByText("Admin dashboard")).toBeVisible();
  });

  it("shows Give Feedback link that opens in a new tab", async () => {
    render(
      <AuthProvider initialUser={user}>
        <SiteHeader displayName={null} isAdmin={false} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    const link = await screen.findByText("Give Feedback");
    expect(link).toBeVisible();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute(
      "href",
      "https://docs.google.com/forms/d/e/1FAIpQLScXhdSxbQ3LxjiYhqN2fmuyy66SK292rTYEZV3QaHgzn1eVjA/viewform?usp=dialog",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
