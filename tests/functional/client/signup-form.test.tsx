import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: { api: { invites: { ":code": { check: { $get: vi.fn() } } } } },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { SignupForm } from "@/app/signup/signup-form";

describe("SignupForm — prefilled invite code (#419)", () => {
  it("hides the code field when a complete code is prefilled from the link", () => {
    render(<SignupForm initialCode="ABCDE12345" intro="welcome" />);
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign up!" })).toBeVisible();
  });

  it("shows the code field when no code is supplied", () => {
    render(<SignupForm initialCode="" intro="welcome" />);
    expect(screen.getByLabelText("Invite code")).toBeVisible();
  });

  it("shows the code field when a prefilled code is incomplete", () => {
    render(<SignupForm initialCode="ABC" intro="welcome" />);
    expect(screen.getByLabelText("Invite code")).toBeVisible();
  });
});
