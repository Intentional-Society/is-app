"use client";

import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

// English-only with no messages: the macro inlines the source string as the
// runtime fallback, so <T> and t`...` render their literal source. When we
// add a second locale, this is the place that loads compiled catalogs and
// switches active locale based on user preference.
const i18n = setupI18n({ locale: "en", messages: { en: {} } });

export function LinguiClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
