/** Minimal class-name joiner. Avoids pulling clsx/tailwind-merge in for this. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
