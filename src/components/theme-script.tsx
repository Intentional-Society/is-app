import { THEME_STORAGE_KEY } from "@/lib/theme";

// Inline, render-blocking script that applies the stored theme before
// first paint, so a dark-mode user never sees a light flash. It must
// stay self-contained vanilla JS — it runs before React (and any
// bundle) loads. Mirrors lib/theme.ts applyThemePreference; the
// matchMedia listener keeps a "system" tab live-tracking OS theme
// changes. CSP allows it via script-src 'unsafe-inline'.
const script = `(() => {
  try {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
      var pref = stored === "light" || stored === "dark" ? stored : "system";
      var dark = pref === "dark" || (pref === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
  } catch (e) {}
})()`;

export function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: static, build-time string — no user input.
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
