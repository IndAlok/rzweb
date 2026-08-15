import { describe, expect, it } from 'vitest';
import agc from '../__fixtures__/agc-hello.json';
import agf from '../__fixtures__/agf-hello.json';
import aflj from '../__fixtures__/aflj-mini.json';
import { buildCallGraphFromAgc, buildCallGraphFromFunctions, buildCfgElements } from '../graphs';

describe('graph parsers', () => {
  it('builds a CFG from official agf json', () => {
    const graph = buildCfgElements(agf);
    expect(graph.source).toBe('agf');
    expect(graph.nodes.map((n) => n.id)).toEqual(['0', '1', '2']);
    expect(graph.edges).toEqual([
      { source: '0', target: '1', type: 'jump' },
      { source: '0', target: '2', type: 'fail' },
      { source: '2', target: '1', type: 'jump' },
    ]);
    expect(graph.truncated).toBe(false);
  });

  it('truncates oversized CFGs', () => {
    const huge = {
      nodes: Array.from({ length: 250 }, (_, i) => ({ id: i, title: `b${i}`, offset: i * 16, out_nodes: [] })),
    };
    const graph = buildCfgElements(huge, 200);
    expect(graph.nodes).toHaveLength(200);
    expect(graph.truncated).toBe(true);
  });

  it('builds a call graph from official agc json', () => {
    const graph = buildCallGraphFromAgc(agc);
    expect(graph.source).toBe('agc');
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([{ source: '0', target: '1', type: 'call' }]);
  });

  it('builds a neighborhood call graph from aflj without agC', () => {
    const graph = buildCallGraphFromFunctions(aflj, 4198400, { mode: 'neighborhood' });
    expect(graph.source).toBe('aflj');
    expect(graph.nodes.map((n) => n.label).sort()).toEqual(['entry0', 'main', 'sym.imp.puts']);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { source: '4198304', target: '4198400', type: 'call' },
        { source: '4198400', target: '4198600', type: 'call' },
      ])
    );
  });

  it('caps a global call graph instead of dumping every node', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      offset: 0x1000 + i * 0x20,
      name: `fcn_${i}`,
      size: 16,
      callrefs: i < 399 ? [{ addr: 0x1000 + (i + 1) * 0x20, type: 'CALL', at: 0x1000 + i * 0x20 }] : [],
      codexrefs: i > 0 ? [{ addr: 0x1000 + (i - 1) * 0x20, type: 'CALL', at: 0x1000 + (i - 1) * 0x20 }] : [],
    }));
    const graph = buildCallGraphFromFunctions(many, 0x1000, { mode: 'global', nodeCap: 250 });
    expect(graph.nodes.length).toBeLessThanOrEqual(250);
    expect(graph.truncated).toBe(true);
  });
});
