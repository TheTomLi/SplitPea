/**
 * Formats up to eight entered digits as an ISO date while the user types.
 * Separators are derived from the digits so mobile numeric keyboards never
 * need to provide a hyphen.
 */
export function formatIsoDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  return parts.filter(Boolean).join("-");
}
