function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Retries on PostgreSQL unique violations surfaced by Prisma as P2002.
 *
 * Two users logging the same show simultaneously will both fail to find an
 * existing row and both try to insert. The loser retries and finds the row
 * the winner created. Any other error is a real failure and is rethrown.
 */
export async function retryOnUniqueViolation<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}
