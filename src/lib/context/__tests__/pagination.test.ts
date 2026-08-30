import { describe, expect, it } from 'vitest';
import { paginate, filterByQuery } from '../pagination';

describe('paginate', () => {
  it('slices with total metadata', () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 1, 2)).toEqual({ items: [2, 3], total: 5, offset: 1, limit: 2 });
  });

  it('clamps negative offset and oversize limit', () => {
    const items = ['a', 'b'];
    expect(paginate(items, -4, 5000).offset).toBe(0);
    expect(paginate(items, 0, 5000).limit).toBe(1000);
  });
});

describe('filterByQuery', () => {
  it('matches case-insensitively', () => {
    const items = [{ name: 'sym.imp.puts' }, { name: 'main' }];
    expect(filterByQuery(items, 'PUTS', (item) => item.name).map((item) => item.name)).toEqual(['sym.imp.puts']);
  });
});
