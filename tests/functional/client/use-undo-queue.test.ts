import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNDO_WINDOW_MS, useUndoQueue } from "@/lib/use-undo-queue";

describe("useUndoQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const entry = (overrides: Partial<Parameters<ReturnType<typeof useUndoQueue>["add"]>[0]> = {}) => ({
    id: "m1",
    message: "Archived a message.",
    onUndo: vi.fn(),
    onExpire: vi.fn(),
    ...overrides,
  });

  it("keeps an entry for 30 seconds, then runs onExpire once and removes it", async () => {
    const { result } = renderHook(() => useUndoQueue());
    const e = entry();
    act(() => result.current.add(e));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].expiresAt - Date.now()).toBe(UNDO_WINDOW_MS);

    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1));
    expect(e.onExpire).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(e.onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(0);
  });

  it("undo runs onUndo, removes the entry and cancels the expiry", async () => {
    const { result } = renderHook(() => useUndoQueue());
    const e = entry();
    act(() => result.current.add(e));
    await act(() => result.current.undo("m1"));
    expect(e.onUndo).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(0);

    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2));
    expect(e.onExpire).not.toHaveBeenCalled();
  });

  it("adding the same id again replaces the entry and restarts the window", async () => {
    const { result } = renderHook(() => useUndoQueue());
    const first = entry();
    const second = entry();
    act(() => result.current.add(first));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    act(() => result.current.add(second));
    expect(result.current.entries).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(second.onExpire).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(second.onExpire).toHaveBeenCalledTimes(1);
    expect(first.onExpire).not.toHaveBeenCalled();
  });

  it("tracks several entries independently", async () => {
    const { result } = renderHook(() => useUndoQueue());
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    act(() => {
      result.current.add(a);
      result.current.add(b);
    });
    await act(() => result.current.undo("a"));
    expect(result.current.entries.map((x) => x.id)).toEqual(["b"]);
    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
    expect(b.onExpire).toHaveBeenCalledTimes(1);
    expect(a.onExpire).not.toHaveBeenCalled();
  });

  it("leaving the page (unmount) cancels the timers without finishing the action", async () => {
    const { result, unmount } = renderHook(() => useUndoQueue());
    const e = entry();
    act(() => result.current.add(e));
    unmount();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(e.onExpire).not.toHaveBeenCalled();
  });

  it("exposes the message from a failed undo or expiry, and clears it on the next action", async () => {
    const { result } = renderHook(() => useUndoQueue());
    act(() => result.current.add(entry({ id: "u", onUndo: () => Promise.reject(new Error("undo failed")) })));
    await act(() => result.current.undo("u"));
    expect(result.current.error).toBe("undo failed");

    // A new entry starts clean.
    act(() => result.current.add(entry({ id: "x", onExpire: () => Promise.reject(new Error("expiry failed")) })));
    expect(result.current.error).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
    expect(result.current.error).toBe("expiry failed");

    // Trying an undo clears it too.
    act(() => result.current.add(entry({ id: "y" })));
    expect(result.current.error).toBeNull();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    const { result } = renderHook(() => useUndoQueue());
    act(() => result.current.add(entry({ onUndo: () => Promise.reject("nope") })));
    await act(() => result.current.undo("m1"));
    expect(result.current.error).toBe("Something went wrong.");
  });

  it("ignores an add that arrives after the owner unmounted, so no orphan timer runs", async () => {
    const { result, unmount } = renderHook(() => useUndoQueue());
    const { add } = result.current;
    unmount();
    const e = entry();
    add(e);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(e.onExpire).not.toHaveBeenCalled();
  });

  it("honours a custom window", async () => {
    const { result } = renderHook(() => useUndoQueue({ windowMs: 5_000 }));
    const e = entry();
    act(() => result.current.add(e));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(e.onExpire).toHaveBeenCalledTimes(1);
  });
});
