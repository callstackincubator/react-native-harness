/**
 * Human-readable size for single-line step-log messages, e.g. "12.3 MB".
 * Always megabytes so the unit is stable and the lines stay grep-friendly.
 */
export const formatMegabytes = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
