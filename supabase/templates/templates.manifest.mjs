// Source of truth for Supabase auth email templates.
//
// Keep this in step with the [auth.email.template.*] blocks in
// supabase/config.toml — the manifest drives
// scripts/update-email-templates.mjs (which pushes to the hosted
// project via the Supabase Management API), and config.toml wires the
// same template files into the local Supabase stack so they render in
// Inbucket during dev.
//
// Variables available inside the templates (Go template syntax):
//   {{ .ConfirmationURL }}  full action link (required)
//   {{ .Email }}            recipient address
//   {{ .SiteURL }}          configured site URL
//   {{ .Data.<field> }}     from auth.users.user_metadata — set by
//                           /signup and the CSV import, absent on
//                           admin-created users. Always wrap with
//                           {{ if .Data.<field> }}…{{ end }}.
//
// Adding a template: drop an .html file in this directory, add an
// entry below, mirror the entry in config.toml, and re-run the script.
export const TEMPLATES = {
  magic_link: {
    subject: "Sign in to the IS Web App",
    file: "magic-link.html",
  },
  recovery: {
    subject: "Reset your IS Web App password",
    file: "recovery.html",
  },
};
