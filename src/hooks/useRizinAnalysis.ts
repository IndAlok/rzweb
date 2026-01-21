import { useCallback } from 'react';
import type { RizinInstance } from '@/lib/rizin';

export function useRizinAnalysis(instance: RizinInstance | null) {
  const sendCommand = useCallback(async (command: string): Promise<void> => {
    if (!instance) return;
    await instance.executeCommand(command);
  }, [instance]);

  const analyze = useCallback(async (): Promise<void> => {
    await sendCommand('aa');
  }, [sendCommand]);

  const getFunctions = useCallback(async () => {
    await sendCommand('aflj');
    return [];
  }, [sendCommand]);

  const getDisasm = useCallback(async (offset: string | number, lines = 100) => {
    const addr = typeof offset === 'number' ? `0x${offset.toString(16)}` : offset;
    await sendCommand(`pdj ${lines} @ ${addr}`);
    return [];
  }, [sendCommand]);

  const getStrings = useCallback(async () => {
    await sendCommand('izj');
    return [];
  }, [sendCommand]);

  const getGraph = useCallback(async (offset: string | number) => {
    const addr = typeof offset === 'number' ? `0x${offset.toString(16)}` : offset;
    await sendCommand(`agfj @ ${addr}`);
    return null;
  }, [sendCommand]);

  return {
    sendCommand,
    analyze,
    getFunctions,
    getDisasm,
    getStrings,
    getGraph,
  };
}
