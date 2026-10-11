/**
 * Shared pagination parsing + helpers so every list uses the same contract:
 * default 10 rows/page, selectable 10/25/50, validated positive integers, and
 * a consistent paginated result shape. Mirrors the validation already used by
 * the approval/audit/notification readers.
 */

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE = 100_000;

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export class PaginationError extends Error {}

/**
 * Parse `page`/`pageSize` from a query string. Invalid values are coerced to
 * safe defaults rather than throwing, so a tampered URL never breaks the page:
 * page clamps to >= 1, pageSize must be one of the allowed options (else the
 * default). This also prevents clients from requesting unbounded page sizes.
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  defaultPageSize: number = DEFAULT_PAGE_SIZE,
): PageParams {
  const rawPage = searchParams.get("page");
  const rawSize = searchParams.get("pageSize");

  let page = 1;
  if (rawPage && /^\d+$/.test(rawPage)) {
    const parsed = Number(rawPage);
    if (Number.isSafeInteger(parsed) && parsed >= 1)
      page = Math.min(parsed, MAX_PAGE);
  }

  let pageSize = defaultPageSize;
  if (rawSize && /^\d+$/.test(rawSize)) {
    const parsed = Number(rawSize);
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed))
      pageSize = parsed;
  }

  return { page, pageSize };
}

/**
 * Snap an already-bounded page size to the platform options (10/25/50). Values
 * outside the whitelist fall back to the default so every list offers the same
 * choices and no caller can request an unbounded size.
 */
export function snapPageSize(
  value: number,
  fallback: number = DEFAULT_PAGE_SIZE,
): number {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
    ? value
    : fallback;
}

/** Build pagination metadata from a total count. */
export function paginationMeta(
  total: number,
  { page, pageSize }: PageParams,
): PaginationMeta {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, pageCount };
}

/** SQL LIMIT/OFFSET values for a page. */
export function limitOffset({ page, pageSize }: PageParams): {
  limit: number;
  offset: number;
} {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}
