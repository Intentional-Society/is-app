import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

import { AuthProvider, useAuth } from "@/components/auth-provider";

type AuthChangeHandler = (
  event: string,
  session: { user: User | null } | null,
) => void;

const unsubscribe = vi.fn();
let lastHandler: AuthChangeHandler | null = null;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (handler: AuthChangeHandler) => {
        lastHandler = handler;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  }),
}));

const mockUser = { id: "u1", email: "a@b.c" } as unknown as User;
const otherUser = { id: "u2", email: "x@y.z" } as unknown as User;

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      /must be used within AuthProvider/,
    );
  });

  it("returns the initial user from the provider", () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AuthProvider initialUser={mockUser}>{children}</AuthProvider>
      ),
    });
    expect(result.current.user).toBe(mockUser);
  });
});

describe("AuthProvider", () => {
  it("updates context when onAuthStateChange fires", () => {
    function Probe() {
      const { user } = useAuth();
      return <div data-testid="email">{user?.email ?? "none"}</div>;
    }

    render(
      <AuthProvider initialUser={null}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("email")).toHaveTextContent("none");

    act(() => {
      lastHandler?.("SIGNED_IN", { user: otherUser });
    });

    expect(screen.getByTestId("email")).toHaveTextContent("x@y.z");

    act(() => {
      lastHandler?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("email")).toHaveTextContent("none");
  });

  it("unsubscribes on unmount", () => {
    unsubscribe.mockClear();
    const { unmount } = render(
      <AuthProvider initialUser={null}>
        <span />
      </AuthProvider>,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
