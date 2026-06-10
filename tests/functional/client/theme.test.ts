import { afterEach, describe, expect, it, vi } from "vitest";

import { applyThemePreference, readThemePreference, THEME_STORAGE_KEY } from "@/lib/theme";

// jsdom doesn't implement matchMedia; stub it with a controllable
// "OS prefers dark?" answer.
const stubSystemDark = (matches: boolean) => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("readThemePreference", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("returns a stored light/dark preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readThemePreference()).toBe("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readThemePreference()).toBe("light");
  });

  it("treats an unrecognized stored value as system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(readThemePreference()).toBe("system");
  });
});

describe("applyThemePreference", () => {
  it("dark adds the .dark class and dark color-scheme", () => {
    stubSystemDark(false);
    applyThemePreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("light removes the .dark class even when the OS prefers dark", () => {
    stubSystemDark(true);
    document.documentElement.classList.add("dark");
    applyThemePreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("system follows the OS preference", () => {
    stubSystemDark(true);
    applyThemePreference("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    stubSystemDark(false);
    applyThemePreference("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
