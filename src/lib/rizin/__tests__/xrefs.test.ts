import { describe, expect, it } from 'vitest';
import axtj from '../__fixtures__/axtj-helloworld.json';
import axfj from '../__fixtures__/axfj-main.json';
import afxj from '../__fixtures__/afxj-main.json';
import aflj from '../__fixtures__/aflj-mini.json';
import {
  assembleFunctionXrefs,
  assembleInstructionXrefs,
  enrichXrefNames,
  parseXrefList,
  xrefsFromFunctionRecord,
} from '../xrefs';
import { findFunctionAt } from '../analysisModel';

const MAIN = 4198400;

describe('xref parsers', () => {
  it('parses official axtj {from,to,type} items', () => {
    const items = parseXrefList(axtj);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ from: 134513350, to: 134518428, type: 'CODE' });
  });

  it('treats axtj as incoming and axfj as outgoing at an instruction', () => {
    const result = assembleInstructionXrefs(axtj, axfj, MAIN);
    expect(result.source).toBe('instruction');
    expect(result.to[0]?.addr).toBe(134513350);
    expect(result.from.map((entry) => entry.addr)).toEqual([4198600, 4210688]);
    expect(result.from[0]?.opcode).toBe('call sym.imp.puts');
  });

  it('splits afxj by whether from/to sits inside the function', () => {
    const fn = findFunctionAt(MAIN, aflj);
    const result = assembleFunctionXrefs(afxj, MAIN, fn);
    expect(result.source).toBe('afx');
    expect(result.to.map((entry) => entry.addr)).toEqual([4198304]);
    expect(result.from.map((entry) => entry.addr)).toEqual([4198600]);
  });

  it('builds function xrefs from aflj callrefs/codexrefs', () => {
    const fn = findFunctionAt(MAIN, aflj);
    expect(fn?.name).toBe('main');
    const result = xrefsFromFunctionRecord(fn!, MAIN);
    expect(result?.source).toBe('aflj');
    expect(result?.to.map((entry) => entry.addr)).toEqual([4198304]);
    expect(result?.from.map((entry) => entry.addr)).toEqual([4198600, 4210688]);
  });

  it('enriches missing names from the function list', () => {
    const result = enrichXrefNames(
      { to: [{ addr: 4198304, type: 'CALL' }], from: [{ addr: 4198600, type: 'CALL' }], source: 'aflj' },
      aflj
    );
    expect(result.to[0]?.name).toBe('entry0');
    expect(result.from[0]?.name).toBe('sym.imp.puts');
  });

  it('finds a function by an interior instruction address', () => {
    expect(findFunctionAt(4198416, aflj)?.name).toBe('main');
  });
});
