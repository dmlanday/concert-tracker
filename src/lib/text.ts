/**
 * Normalizes a name into a dedupe key. Manually entered artists and venues
 * have no external id, so this key is what stops "Wednesday" and " wednesday "
 * from becoming two rows.
 */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
