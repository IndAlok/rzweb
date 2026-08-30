import { describe, expect, it } from 'vitest';
import aflj from '../../rizin/__fixtures__/aflj-mini.json';
import { assembleFunctionBriefing, mapFunctionSummary, stringsInFunctionBounds } from '../briefing';
import { findFunctionAt } from '../../rizin/analysisModel';

const MAIN = 4198400;

describe('function briefing mapper', () => {
  it('maps aflj records to summaries', () => {
    const fn = findFunctionAt(MAIN, aflj);
    expect(fn).toBeTruthy();
    const summary = mapFunctionSummary(fn!);
    expect(summary).toMatchObject({ addr: MAIN, name: 'main', size: 128 });
  });

  it('keeps strings that fall inside function bounds', () => {
    const fn = findFunctionAt(MAIN, aflj);
    const strings = stringsInFunctionBounds(fn!, [
      { vaddr: MAIN + 8, string: 'hello' },
      { vaddr: 1, string: 'outside' },
    ]);
    expect(strings).toEqual([{ addr: MAIN + 8, string: 'hello' }]);
  });

  it('assembles a compact briefing', () => {
    const fn = findFunctionAt(MAIN, aflj);
    const briefing = assembleFunctionBriefing({
      fn: fn!,
      xrefs: { to: [{ addr: 4198304, type: 'CODE' }], from: [] },
      decompile: { code: 'int main() {}', engine: 'pseudo' },
    });
    expect(briefing.summary.name).toBe('main');
    expect(briefing.decompile?.engine).toBe('pseudo');
    expect(briefing.xrefs.to).toHaveLength(1);
  });
});
