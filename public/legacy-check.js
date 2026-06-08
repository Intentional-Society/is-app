/*
 * Boot-time browser capability check.
 *
 * This file is deliberately hand-written ES5 and is served verbatim from
 * /public (never bundled or transpiled). It has to run on engines that
 * CANNOT parse the main app bundle: Next 16 / React 19 emit ~2020-era syntax
 * (optional chaining, nullish coalescing), so on an older engine — Safari ≤10,
 * IE 11, legacy Edge, a dated Android/Chrome — the bundle throws a SyntaxError,
 * React never hydrates, and interactive controls silently fall back to native
 * behavior (e.g. the signup "Sign up!" button does a bare form submit that
 * wipes the field). We can't catch that from inside the bundle, so we detect it
 * out here and reveal a plain-HTML notice instead.
 *
 * Keep this ES5 (var, no arrow functions, no `?.`/`??`) so the warning can
 * display on the very browsers it is meant to warn. It is excluded from
 * Biome for the same reason — see biome.json.
 */
(function () {
  // Each of these landed in Safari 13.1 / Chrome 85 / Firefox 77 — the same
  // generation that added the syntax the app bundle needs. If any is missing,
  // the bundle cannot run here.
  var ok =
    typeof String.prototype.replaceAll === "function" &&
    typeof window.Promise !== "undefined" &&
    typeof window.Promise.allSettled === "function" &&
    typeof window.fetch === "function";

  if (ok) return;

  var el = document.getElementById("legacy-browser-warning");
  if (el) el.style.display = "block";
  // Lock scrolling so the blocking overlay can't be scrolled past.
  if (document.body) document.body.style.overflow = "hidden";
})();
