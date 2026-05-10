// App-wide settings, admin-managed. Mocked for now — when the first
// real setting lands it'll come from an `app_settings` table (single
// row, or keyed by name) and this function will read from it. The
// shape stays `Record<string, unknown>` until the schema is concrete,
// so callers (the /admin page, future setters) don't grow a brittle
// interface against a placeholder. User-scoped settings will live
// alongside in their own module.

export type AppSettings = Record<string, unknown>;

export const getAppSettings = async (): Promise<AppSettings> => {
  return {};
};
