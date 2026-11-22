import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useIdSet } from "@/lib/use-id-set";

describe("useIdSet", () => {
  it("adds and removes ids independently", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => result.current[1]("a", true));
    act(() => result.current[1]("b", true));
    expect([...result.current[0]].sort()).toEqual(["a", "b"]);
    act(() => result.current[1]("a", false));
    expect([...result.current[0]]).toEqual(["b"]);
  });

  it("applies overlapping updates without losing either", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => {
      result.current[1]("a", true);
      result.current[1]("b", true);
    });
    expect([...result.current[0]].sort()).toEqual(["a", "b"]);
  });

  it("keeps the same set when nothing changes", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => result.current[1]("a", true));
    const before = result.current[0];
    act(() => result.current[1]("a", true));
    act(() => result.current[1]("zzz", false));
    expect(result.current[0]).toBe(before);
  });
});
