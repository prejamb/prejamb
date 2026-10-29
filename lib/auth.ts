/**
 * Shared helpers for authentication redirects.
 *
 * `next` values come from the query string, so they are attacker-controlled.
 * Only same-origin, absolute paths are allowed: that blocks open redirects
 * (`https://evil.com`, `//evil.com`) while still supporting paths with a query
 * string such as `/exam/session?subject=ENG`.
 */

const DEFAULT_NEXT = "/";

export function sanitizeNext(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith("/")) {
    return fallback;
  }

  // `//host` is a protocol-relative URL, and `/\host` is normalised to it by
  // some browsers. Neither is a path on this site.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  // Header-injection / control characters.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
