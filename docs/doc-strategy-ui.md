# UI Strategy

## Theme tokens

The app's color palette lives in `src/app/globals.css` as CSS custom properties, organized using shadcn/ui's standard token names (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--success`, `--border`, `--input`, `--ring`, plus paired `-foreground` tokens). Following the shadcn convention is deliberate: it means `npx shadcn add some-component` works without remapping.

Values use the [`oklch()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) color function — perceptually uniform (equal numeric L steps look like equal brightness steps to the human eye), unlike `hsl()` where 50%-lightness yellow looks much brighter than 50%-lightness blue. That perceptual uniformity is what lets the grayscale steps in our palette sit on a clean lightness scale.

The palette draws from `www.intentionalsociety.org`:
- **Background**: a faint mint off-white, halfway between near-white and the site's `#E7EFEB` bg.
- **Primary**: a muted version of the IS brand teal (`#24818e` family).
- **Destructive**: terracotta rather than pure red, to sit in the same earthy palette.
- **Success**: sage rather than pure green, same reason.
- **Border / input / ring**: low-chroma teal in the primary family, so chrome reads as "interactive UI" rather than flat gray.

Dark mode (`.dark { … }` block in the same file) mirrors the palette with values inverted in lightness — same hues, same roles. Activate by adding `class="dark"` to any wrapper.

`--card`, `--chart-1..5`, and `--sidebar-*` are defined but currently unused. They're kept because they're part of the shadcn token surface — future component installs will rely on them.

A small naming-inversion note: `--primary` (the CSS token, dusty teal brand color) is the *fill* of the `secondary` Button variant — not the `primary` variant. The Button variant naming was deliberately flipped from shadcn's convention so the everyday workhorse button is called "primary"; the CSS token names follow shadcn unchanged. Keep the two name systems separate in your head.

## The `/colors` page

`src/app/colors/page.tsx` is a dev-only palette visualization. It calls `notFound()` when `process.env.NODE_ENV === "production"`, so it's not exposed in preview or production builds. Locally it lists every token role as a labeled swatch, side-by-side for light and dark.

Use it when:
- Tweaking palette values to see contrast and hierarchy at a glance.
- Verifying that a new role behaves as intended in both light and dark.
- Onboarding — it's the fastest way to see what the design system actually looks like.

## Button variants — mental model

| Variant | Looks like | When to use |
|---|---|---|
| `primary` *(default)* | Light bordered surface, mint bg, teal hover | Everyday button — most things in the app |
| `secondary` | Dark teal fill, light text | Emphasized CTA — main action of a form/page |
| `destructive` | Translucent red bg, red text | Destructive actions (Revoke, etc.) |
| `ghost` | No bg, hover shows muted bg | Toolbar/icon button blending into surroundings |
| `link` | Inline text-link styling | Inline text links that need button behavior |

Most buttons in the app are `primary`. Use `secondary` sparingly — it's louder, and stops being emphasis when everything's emphasized.

## Buttons vs anchors

Anything that changes the URL is a real `<a>` (rendered via `next/link`), not a `<button onClick={() => router.push(…)}>`. Three reasons:

1. **Browser UX** — right-click "open in new tab," cmd-click, middle-click, copy link address — all only work on `<a>`.
2. **Accessibility** — screen readers announce links and buttons distinctly. Buttons-that-navigate trip up users who Tab through expecting link semantics.
3. **No-JS fallback** — anchors navigate without JavaScript; click handlers don't.

Action-y interactions (form submits, onClick handlers, things that don't change the URL) stay as real `<button>` elements.

Pattern for a navigation button — Base UI's `render` prop layers Button styling on top of `next/link`'s anchor:

```tsx
<Button variant="primary" render={<Link href="/profile" />}>
  My profile
</Button>
```

The rendered DOM is `<a class="…button-classes…" href="/profile">My profile</a>`. It gets the `<a>` semantics, `next/link`'s prefetching, and Button's focus-visible ring all at once.

`button.tsx` also exports `buttonVariants` (the cva object), which lets you write `<Link className={buttonVariants()}>…</Link>` for a more direct alternative. Both produce a real `<a>`; the `render` form is preferred here for consistency and because Button layers in Base UI's focus behavior.
