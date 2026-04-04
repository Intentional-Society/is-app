# Intentional Society WWW Site — Architecture Specification reference

**Context:** The public-facing website for Intentional Society (intentionalsociety.org and related properties). Separate from the authenticated community application — this is a static site with no backend dependency.

---

### Netlify — Static Site Hosting

**What it does:** Hosts the existing Gatsby-built static www site (intentionalsociety.org and related properties). Serves pre-built HTML/CSS/JS files from a global CDN.

**Connects to:** Visitors' browsers. No backend dependency — pure static files.

**Why this choice:** The existing Gatsby site is already deployed on Netlify and works. No reason to migrate hosting for a site that will eventually be rewritten. Netlify provides deploy previews per Git branch, automatic SSL, global CDN, and a generous free tier. When a significant content overhaul triggers a rewrite, the www site migrates to Astro for better AI-crawler visibility and zero-JS-by-default static generation. Astro deploys to Netlify just as easily as Gatsby does. Until then, no investment in Gatsby beyond maintenance patches.

**Known downsides:** Gatsby is effectively abandoned (acquired by Netlify 2023, minimal development since). Plugin ecosystem is decaying. Node.js version compatibility will eventually become a friction point. This is a deliberate decision to defer migration cost, not a long-term commitment. Netlify itself is stable and well-suited for static hosting — the risk is Gatsby, not the host.
