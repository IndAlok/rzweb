import type { Paginated } from './types';

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 1000;

export function paginate<T>(items: T[], offset = 0, limit = DEFAULT_PAGE_LIMIT): Paginated<T> {
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(limit) || DEFAULT_PAGE_LIMIT));
  return {
    items: items.slice(safeOffset, safeOffset + safeLimit),
    total: items.length,
    offset: safeOffset,
    limit: safeLimit,
  };
}

export function filterByQuery<T>(
  items: T[],
  query: string | undefined,
  getText: (item: T) => string
): T[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => getText(item).toLowerCase().includes(needle));
}
