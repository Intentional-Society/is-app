// Light/dark/system theme preference, persisted per-browser in
// localStorage. Two consumers keep the stored value and the <html>
// class in sync: ThemeScript (components/theme-script.tsx) applies it
// before first paint, and the ThemeSelector on /me applies changes
// live. See docs/strategy-ui.md → "Dark mode".
export const THEME_STORAGE_KEY = "isweb-theme";

export type ThemePreference = "light" | "dark" | "system";

export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // localStorage may be blocked; behave as if nothing is stored.
    return "system";
  }
};

// Persists the preference and applies it to the document. colorScheme
// is set alongside the .dark class so native UI (form controls,
// scrollbars) follows the app theme.
export const applyThemePreference = (pref: ThemePreference): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Not persisted, but still applied for this page view.
  }
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};
