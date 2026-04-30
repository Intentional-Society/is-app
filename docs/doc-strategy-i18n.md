# Internationalization Strategy

This doc captures our approach to user-facing strings. We are English-only today and have no concrete plan to localize, but we want every string written from now on to be one config switch away from translatable.

## Goals

1. **Localization-ready.** Adding a second locale should be a build/config change, not a codebase rewrite.
2. **Reviewable copy.** Every user-facing string is discoverable in the source (and, eventually, in a single catalog) for tone and consistency review.
3. **Frictionless authoring.** A developer adding a button label writes the English directly and moves on. No catalog file to open, no key to invent.

## Library: Lingui (source-as-key)

We use [Lingui](https://lingui.dev) with its macro plugin. Source-as-key means the English text *is* the message identifier: developers write English in the JSX, and a build-time macro extracts it.

The alternative — keys with a separate catalog (`t('auth.signIn')` → `"Sign in"` in `en.json`) — was rejected because it makes copy review require cross-referencing two files and forces every string to be named twice. Source-as-key keeps the rendered text and the source code in the same place.

## The two call sites

Lingui needs two call shapes because JSX content and string values have different types. We accept both and keep the rule small:

- **`<T>` for JSX content** — anywhere a string sits between tags, especially with nested elements.
- **`` t`...` `` for plain strings** — attribute values, toast messages, thrown errors, anything passed as a JS string.

```tsx
import { Trans as T } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";

<h1><T>Sign in</T></h1>

<input
  placeholder={t`you@example.com`}
  aria-label={t`Email address`}
/>

<p>
  <T>
    Forgot your password? <Link href="/reset">Reset it</Link>.
  </T>
</p>

toast.success(t`Saved`);
```

Variable interpolation uses native syntax in both:

```tsx
<T>Welcome back, {user.firstName}</T>
t`Welcome back, ${user.firstName}`
```

Plurals get a dedicated helper (`<Plural>` / `plural()`) — reach for it only when count-aware copy is needed.

## Why `T`, not `Trans`

Lingui's macro exports the JSX component as `Trans`. We rename it to `T` at the import site because the symbol appears on every user-facing line of JSX, and one character carries the meaning as well as five.

## Imports

Lingui v6 split the macros across two packages: `@lingui/react/macro` (provides `Trans`, `Plural`) and `@lingui/core/macro` (provides `t`). The legacy v5 single-package `@lingui/macro` is deprecated.

```tsx
import { Trans as T, Plural } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
```

The rename happens at the import line; from there every call site uses `T`.

We initially tried a chokepoint module (`src/lib/i18n.ts` that re-exported `Trans as T`) so components could `import { T } from "@/lib/i18n"`. It does not work: the SWC plugin transforms macro **usages** (JSX elements and template tags), not bare re-exports. A re-export pulls the macro's runtime fallback file into the bundle untransformed, and the build fails resolving its `babel-plugin-macros` dependency. Direct imports at each call site are the only working path.

An ESLint `no-restricted-imports` rule blocks the deprecated `@lingui/macro` (v5) so nobody falls into it accidentally. The `Trans as T` rename is convention-enforced — ESLint can't easily require a specific import alias, so PR review carries that.

## No catalogs yet

We do not generate, commit, or load any translation catalogs today. The Lingui macro inlines the English source as the runtime message fallback, so `<T>Sign in</T>` compiles to roughly `<Trans id="Sign in" message="Sign in" />` and renders "Sign in" with no catalog loaded.

What this means in practice:

- **No `lingui.config.ts`** in the repo.
- **No `messages.po` files.**
- **No `extract` or `compile` npm scripts.**
- **No CI step** for translation maintenance.

The runtime setup is small:

- The SWC plugin (`@lingui/swc-plugin`) runs at build time via `experimental.swcPlugins` in `next.config.ts`.
- A client-side `<LinguiClientProvider>` (`src/components/lingui-client-provider.tsx`) wraps the app's children inside the root layout. It instantiates an `i18n` with `locale: "en"` and no messages — the macro's inlined source is what renders.
- The same i18n instance is registered for RSC `<T>` usage via `setI18n` from `@lingui/react/server`, called once in the root layout module body.

## When we add a second locale

Adding translations is a future, additive change. None of the call sites in components need to change.

1. Add `lingui.config.ts` pointing at `src/**/*.tsx`.
2. Add `"extract": "lingui extract"` and `"compile": "lingui compile"` scripts.
3. Run `lingui extract` once — `locales/en/messages.po` and `locales/<new-locale>/messages.po` appear.
4. Translators fill in the new locale's `.po` file. (We hand them the file; we do not build a CMS for this.)
5. Load compiled catalogs at runtime and call `i18n.activate(locale)` based on user preference.

Every `<T>` and `` t`` `` already in the codebase starts resolving from a real catalog the moment a translation exists.

## What we don't do

- **Co-locate strings as TypeScript constants.** Tempting (`const COPY = { signIn: 'Sign in' }`), but it makes localization a refactor across every file rather than a config change.
- **Hand-author a catalog file before extraction is needed.** Two sources of truth (source and catalog) drift; the macro keeps them in sync automatically once we turn it on.
- **Wrap every literal pre-emptively in a translation helper before we install Lingui.** Until the macro is in place, `<T>` and `` t`` `` don't exist. Plain JSX is fine. The migration step (when we install) is mechanical: search for user-facing literals and wrap them.

## Updating this strategy

Reconsider if any of the following becomes true:

- We adopt a second locale — many of the "future" notes above stop being theoretical and need concrete implementation.
- A translator or copy editor joins the team — we may want a real translation management platform (Crowdin, Lokalise, etc.) instead of raw `.po` files.
- The macro proves problematic with a future Next.js or React change — Lingui is well-maintained but we should not assume permanence.
