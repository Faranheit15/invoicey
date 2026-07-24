export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parse + clamp pagination params. `limit` is capped at `maxLimit` so a client
 * can't request an unbounded page (anti-DoS for the admin list endpoints).
 */
export const parsePagination = (
  searchParams: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {}
): Pagination => {
  const defaultLimit = opts.defaultLimit ?? 25;
  const maxLimit = opts.maxLimit ?? 100;

  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const rawLimit = Number.parseInt(
    searchParams.get("limit") || String(defaultLimit),
    10
  );

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
};

/** Escape user-supplied text before using it in a Mongo regex (ReDoS/injection guard). */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
