# Browser Support Strategy

How old a browser the IS Web App supports, and what "supports" means at each
age. The membership is globally distributed and reaches the app on whatever
device they have — including machines whose OS caps the browser version
(Windows 7/8.1 ends at Chrome 109; older macOS caps Safari and Chrome
similarly). A member-facing summary of this policy lives on `/about`.

## The three tiers

1. **Full support — Baseline widely available.** Every flow works and
   renders as designed on browsers current with the
   [Web Platform Baseline](https://web.dev/baseline): features supported
   by all four core browsers (Chrome, Edge, Firefox, Safari) for at least
   30 months. Before hand-writing a CSS property, JS API, or syntax
   feature, check its MDN badge: **"Baseline widely available" means
   usable at full fidelity; "newly available" or no badge means it must
   not be relied upon.**
2. **Best effort — older than the Baseline cohort, down to the hard
   floor.** Core flows work (sign-in, signup, forms, navigation) and all
   content is readable. Polish like colors, halos, shadows may simplify.
   A feature whose absence would break function or readability needs a
   fallback that reaches this tier.
3. **Blocked — below the hard floor.** `public/legacy-check.js` detects the
   engine at boot and reveals the plain-HTML `LegacyBrowserNotice` instead
   of a silently broken app (#365).

## The hard floor: Chrome/Edge 85, Safari 13.1, Firefox 77

The engine generation that parses the syntax Next 16 / React 19 emit
(optional chaining, nullish coalescing) and has the APIs the bundle assumes
(`String.prototype.replaceAll`, `Promise.allSettled`, `fetch`). Below it the
bundle throws a `SyntaxError` before React hydrates, so no in-app fallback
can help — hence the boot-time blocker. The floor moves only when the
framework stack raises its emitted-syntax baseline; when it does, update
`legacy-check.js`, this section, and the `/about` summary together.

## Why these tiers

Two shipped regressions came from reaching past the tiers by accident:
Safari ≤10 members hit a silently dead signup form (#365 — bundle syntax
below the hard floor), and a Chrome 109 member saw white-on-white graph
name labels (`paint-order` on HTML text reached Baseline newly available in
March 2024 and is widely available only from ~September 2026 — the badge
check catches exactly this).

Tailwind v4's own requirements (Chrome 111 / Safari 16.4, March 2023) are
inside Baseline widely available as of late 2025, and its sRGB color
fallbacks (v4.1+) carry the best-effort tier the rest of the way down to
the hard floor.
