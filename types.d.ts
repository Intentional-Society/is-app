// TypeScript 6 requires explicit declarations for side-effect imports of
// non-TS files. Next.js imports global CSS with `import "./globals.css"`.
declare module "*.css";
