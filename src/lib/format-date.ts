const DATE_OPTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const DATETIME_OPTS: Intl.DateTimeFormatOptions = { ...DATE_OPTS, hour: "numeric", minute: "2-digit" };

export const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, DATE_OPTS);
  } catch {
    return iso;
  }
};

export const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, DATETIME_OPTS);
  } catch {
    return iso;
  }
};
