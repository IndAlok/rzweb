import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { useFileStore, useRizinStore, useUIStore, useSettingsStore } from '@/stores';
import { loadRizinModule, getCachedVersions, RizinInstance, type RizinNotice } from '@/lib/rizin';
import { RizinTerminal, type RizinTerminalRef } from '@/components/terminal';
import { HexView, FunctionsView, StringsView, GraphView, DisassemblyView, ImportsView, ExportsView, SectionsView, HeaderInfoPanel } from '@/components/views';
import { Button, Progress, Badge, Tabs, TabsList, TabsTrigger, CommandPalette, SettingsDialog, ShortcutsDialog } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Menu, X, Terminal as TerminalIcon, Settings, Code, Layout, Share2, Quote, FileCode, Home, Package, ArrowUpRight, Layers, Info, AlertTriangle } from 'lucide-react';
import type { RzFunction, RzDisasmLine, RzString, RzImport, RzExport, RzSection } from '@/types/rizin';

export default function AnalysisPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const version = searchParams.get('version') || 'latest';
  const shouldCache = searchParams.get('cache') === 'true';

  const { currentFile, clearCurrentFile } = useFileStore();
  const { setModule, isLoading, setLoading, loadProgress, setLoadProgress, loadPhase, setLoadPhase, setLoadMessage, setCachedVersions, setError } = useRizinStore();
  const { sidebarOpen, setSidebarOpen, setSettingsDialogOpen, currentAddress, setCurrentAddress, currentView, setCurrentView, selectedFunction, setSelectedFunction } = useUIStore();
  const { ioCache, analysisDepth, noAnalysis, maxOutputSizeMb } = useSettingsStore();

  const [activeInstance, setActiveInstance] = useState<RizinInstance | null>(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [alerts, setAlerts] = useState<RizinNotice[]>([]);
  const [disasmLines, setDisasmLines] = useState<RzDisasmLine[]>([]);
  const [isLoadingDisasm, setIsLoadingDisasm] = useState(false);
  const [graphNodes, setGraphNodes] = useState<Array<{id: string; label: string; body?: string}>>([]);
  const [graphEdges, setGraphEdges] = useState<Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}>>([]);
  const terminalRef = useRef<RizinTerminalRef>(null);
  const functionDetailRequestRef = useRef(0);

  void analysisRevision;

  const functions = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.functions as RzFunction[];

  const strings = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.strings as RzString[];

  const imports = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.imports as RzImport[];

  const exports = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.exports as RzExport[];

  const sections = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.sections as RzSection[];

  const infoPayload = !activeInstance?.analysis || !analysisReady
    ? null
    : activeInstance.analysis.info;

  useEffect(() => {
    if (!activeInstance) {
      setAlerts([]);
      return;
    }

    setAlerts(activeInstance.allNotices);

    const unsubscribeAnalysis = activeInstance.onAnalysisChanged(() => {
      setAnalysisReady(true);
      setAnalysisRevision(v => v + 1);
    });

    const unsubscribeNotice = activeInstance.onNotice((notice) => {
      setAlerts(prev => {
        if (prev.some(item => item.code === notice.code && item.message === notice.message && item.detail === notice.detail)) {
          return prev;
        }
        return [...prev, notice];
      });
    });

    return () => {
      unsubscribeAnalysis();
      unsubscribeNotice();
    };
  }, [activeInstance]);

  useEffect(() => {
    if (!currentFile) {
      navigate('/');
      return;
    }

    let rz: RizinInstance | null = null;

    const initRizin = async () => {
      setLoading(true);
      setLoadPhase('initializing');
      setLoadProgress(0);
      setAlerts([]);
      setAnalysisRevision(0);
      setAnalysisReady(false);
      setDisasmLines([]);
      setGraphNodes([]);
      setGraphEdges([]);
      setSelectedFunction(null);
      setCurrentAddress(0);

      try {
        const rizinModule = await loadRizinModule({
          onProgress: ({ phase, progress, message }) => {
            setLoadPhase(phase as any);
            setLoadProgress(progress);
            setLoadMessage(message);
          },
        });

        setModule(rizinModule);
        const versions = await getCachedVersions();
        setCachedVersions(versions);

        rz = new RizinInstance(rizinModule);
        setLoadPhase('analyzing');
        setLoadProgress(78);
        setLoadMessage(noAnalysis ? 'Opening binary without auto-analysis...' : 'Running initial analysis and indexing binary data...');
        await rz.open(currentFile, {
          ioCache,
          analysisDepth,
          noAnalysis,
          maxOutputBytes: maxOutputSizeMb * 1024 * 1024,
          extraArgs: ['-e', 'scr.color=0', '-e', 'scr.utf8=false'],
        });

        setActiveInstance(rz);
        const initialSeek = Number.parseInt(rz.getCurrentAddress(), 16);
        if (!Number.isNaN(initialSeek)) {
          setCurrentAddress(initialSeek);
        }
        setAnalysisReady(true);
        setAlerts(rz.allNotices);
        setLoadPhase('ready');
        if (rz.cacheHit) {
          toast.success('Loaded from analysis cache');
        } else {
          toast.success(noAnalysis ? 'Binary opened' : 'Analysis complete');
        }

      } catch (error) {
        console.error('Failed to load Rizin:', error);
        setError(String(error));
        setLoadPhase('error');
        toast.error(`Failed to load Rizin: ${error}`);
      } finally {
        setLoading(false);
      }
    };

    initRizin();

    return () => {
      rz?.close();
    };
  }, [version, shouldCache, currentFile, navigate, setLoading, setLoadPhase, setLoadProgress, setLoadMessage, setModule, setCachedVersions, setError, ioCache, analysisDepth, noAnalysis, maxOutputSizeMb, setCurrentAddress, setSelectedFunction]);

  const buildDisassemblyLines = useCallback((disasm: unknown): RzDisasmLine[] => {
    const parsed = disasm as { ops?: any[]; instructions?: any[] } | any[] | null;
    const ops = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.ops)
        ? parsed.ops
        : Array.isArray(parsed?.instructions)
          ? parsed.instructions
          : [];

    if (!ops.length) {
      return [];
    }

    return ops.map((op: any) => ({
      offset: op.offset || 0,
      size: op.size || 0,
      bytes: op.bytes || '',
      opcode: op.opcode || op.disasm || '',
      disasm: op.disasm || op.opcode || '',
      family: op.family || '',
      type: op.type || '',
      type_num: op.type_num || 0,
      type2_num: op.type2_num || 0,
      comment: op.comment,
      jump: op.jump,
      refs: op.refs,
    }));
  }, []);

  const buildGraphElements = useCallback((graph: unknown) => {
    const parsed = graph as any;

    let graphBlocks: any[] = [];
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((node: any) => typeof node === 'object' && node && ('offset' in node || 'id' in node || 'jump' in node || 'fail' in node || Array.isArray(node.ops)))) {
      graphBlocks = parsed;
    } else if (Array.isArray(parsed) && parsed.length > 0) {
      graphBlocks = parsed[0]?.blocks || parsed[0]?.nodes || [];
    } else if (parsed?.nodes) {
      graphBlocks = parsed.nodes;
    } else if (parsed?.blocks) {
      graphBlocks = parsed.blocks;
    } else if (parsed?.graph?.nodes) {
      graphBlocks = parsed.graph.nodes;
    } else if (parsed?.graph?.blocks) {
      graphBlocks = parsed.graph.blocks;
    }

    if (!graphBlocks.length) {
      return {
        nodes: [] as Array<{id: string; label: string; body?: string}>,
        edges: [] as Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}>,
      };
    }

    const offsetToId = new Map<number, string>();
    const nodes = graphBlocks.map((node: any, idx: number) => {
      const nodeId = String(node.id ?? node.offset ?? idx);
      if (typeof node.offset === 'number') {
        offsetToId.set(node.offset, nodeId);
      }

      return {
        id: nodeId,
        label: node.title || `0x${(node.offset ?? 0).toString(16)}`,
        body: node.body || node.ops?.map((op: any) => op.disasm || op.opcode || '').join('\n') || '',
      };
    });

    const edges: Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}> = [];
    graphBlocks.forEach((node: any) => {
      const sourceId = String(node.id ?? node.offset ?? 0);
      const outNodes = Array.isArray(node.out_nodes) ? node.out_nodes : [];

      if (outNodes.length > 0) {
        outNodes.forEach((targetId: number, idx: number) => {
          const edgeType = outNodes.length === 2
            ? (idx === 0 ? 'jump' as const : 'fail' as const)
            : 'jump' as const;
          edges.push({ source: sourceId, target: String(targetId), type: edgeType });
        });
        return;
      }

      if (typeof node.jump === 'number') {
        edges.push({
          source: sourceId,
          target: offsetToId.get(node.jump) ?? String(node.jump),
          type: 'jump',
        });
      }

      if (typeof node.fail === 'number') {
        edges.push({
          source: sourceId,
          target: offsetToId.get(node.fail) ?? String(node.fail),
          type: 'fail',
        });
      }
    });

    return { nodes, edges };
  }, []);

  const loadFunctionPresentation = useCallback(async (address: number) => {
    if (!activeInstance) return;

    const requestId = ++functionDetailRequestRef.current;
    setIsLoadingDisasm(true);

    try {
      const detail = await activeInstance.getFunctionDetails(address);
      if (requestId !== functionDetailRequestRef.current) return;

      setDisasmLines(buildDisassemblyLines(detail.disasm));

      const nextGraph = buildGraphElements(detail.graph);
      setGraphNodes(nextGraph.nodes);
      setGraphEdges(nextGraph.edges);
    } catch (e) {
      console.error('[AnalysisPage:loadFunctionPresentation] Error:', e);
      if (requestId !== functionDetailRequestRef.current) return;
      setDisasmLines([]);
      setGraphNodes([]);
      setGraphEdges([]);
    } finally {
      if (requestId === functionDetailRequestRef.current) {
        setIsLoadingDisasm(false);
      }
    }
  }, [activeInstance, buildDisassemblyLines, buildGraphElements]);

  const handleFunctionSelect = useCallback((fcn: RzFunction) => {

    setCurrentAddress(fcn.offset);
    setSelectedFunction(fcn.name);
    if (currentView === 'terminal') {
      setCurrentView('disasm');
    }
    void loadFunctionPresentation(fcn.offset);
  }, [setCurrentAddress, setSelectedFunction, setCurrentView, currentView, loadFunctionPresentation]);

  useEffect(() => {
    if (!activeInstance || !selectedFunction || currentAddress <= 0) {
      return;
    }

    if (currentView === 'disasm' && disasmLines.length === 0) {
      void loadFunctionPresentation(currentAddress);
      return;
    }

    if (currentView === 'graph' && graphNodes.length === 0) {
      void loadFunctionPresentation(currentAddress);
    }
  }, [
    activeInstance,
    currentAddress,
    currentView,
    disasmLines.length,
    graphNodes.length,
    loadFunctionPresentation,
    selectedFunction,
  ]);

  const handleGoHome = useCallback(() => {
    activeInstance?.close();
    clearCurrentFile();
    navigate('/');
  }, [activeInstance, clearCurrentFile, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <div className="mb-8 rounded-full bg-primary/10 p-6">
          <TerminalIcon className="h-16 w-16 animate-pulse text-primary" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-foreground">
          {loadPhase === 'downloading' ? 'Downloading Rizin...' : loadPhase === 'analyzing' ? 'Analyzing Binary...' : 'Initializing...'}
        </h2>
        <p className="mb-6 max-w-md text-center text-muted-foreground">
          {loadPhase === 'analyzing'
            ? 'Initial analysis is being completed now so functions, strings, sections, and graphs are ready without manual aa; ... chaining.'
            : 'Please wait'}
        </p>
        <div className="w-80"><Progress value={loadProgress} showValue /></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1 sm:gap-2 border-b border-border bg-card px-2 sm:px-4 overflow-hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleGoHome} title="Back to Home">
            <Home className="h-4 w-4" />
          </Button>
          <div className="hidden sm:flex items-center gap-2">
            <TerminalIcon className="h-5 w-5 text-primary" />
            <span className="font-bold text-sm tracking-tight text-foreground">RzWeb</span>
          </div>
          <TerminalIcon className="sm:hidden h-5 w-5 text-primary" />
        </div>

        <div className="h-6 w-px bg-border mx-1 sm:mx-2 hidden sm:block" />

        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hidden">
          <Tabs value={currentView} onValueChange={(v) => setCurrentView(v as any)}>
            <TabsList className="h-8 bg-muted/50 flex-nowrap">
              <TabsTrigger value="terminal" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <TerminalIcon className="h-3.5 w-3.5" /><span className="hidden sm:inline">Terminal</span>
              </TabsTrigger>
              <TabsTrigger value="disasm" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Code className="h-3.5 w-3.5" /><span className="hidden sm:inline">Disasm</span>
              </TabsTrigger>
              <TabsTrigger value="hex" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Layout className="h-3.5 w-3.5" /><span className="hidden sm:inline">Hex</span>
              </TabsTrigger>
              <TabsTrigger value="strings" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Quote className="h-3.5 w-3.5" /><span className="hidden sm:inline">Strings</span>
              </TabsTrigger>
              <TabsTrigger value="graph" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Share2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Graph</span>
              </TabsTrigger>
              <TabsTrigger value="imports" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Package className="h-3.5 w-3.5" /><span className="hidden sm:inline">Imports</span>
              </TabsTrigger>
              <TabsTrigger value="exports" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <ArrowUpRight className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exports</span>
              </TabsTrigger>
              <TabsTrigger value="sections" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Layers className="h-3.5 w-3.5" /><span className="hidden sm:inline">Sections</span>
              </TabsTrigger>
              <TabsTrigger value="info" className="text-xs gap-1 sm:gap-1.5 px-1.5 sm:px-3">
                <Info className="h-3.5 w-3.5" /><span className="hidden sm:inline">Info</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          {currentFile && (
            <Badge variant="outline" className="hidden md:flex gap-1.5 font-mono text-[10px] py-1 border-primary/20 bg-primary/5">
              <FileCode className="h-3 w-3 text-primary" /> {currentFile.name}
            </Badge>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setSettingsDialogOpen(true)} title="Settings">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleGoHome} title="Exit">
            <X className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </header>

      {alerts.length > 0 && (
        <div className="border-b border-border bg-background px-3 py-2 sm:px-4">
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm',
                  alert.severity === 'error'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : alert.severity === 'warning'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                      : 'border-primary/30 bg-primary/10 text-foreground'
                )}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">{alert.message}</p>
                    {alert.detail && <p className="mt-1 text-xs opacity-80">{alert.detail}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {sidebarOpen && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={40} className="bg-card">
                <FunctionsView functions={functions} onSelect={handleFunctionSelect} />
              </Panel>
              <PanelResizeHandle className="w-1 bg-border/50 hover:bg-primary/30 transition-colors" />
            </>
          )}
          
          <Panel>
            <div className="h-full relative bg-[#0f172a]">
              {currentView === 'terminal' && activeInstance && (
                <RizinTerminal 
                  ref={terminalRef} 
                  rizin={activeInstance} 
                  className="h-full w-full" 
                />
              )}
              {currentView === 'disasm' && (
                <div className="h-full">
                  {isLoadingDisasm ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      Loading disassembly...
                    </div>
                  ) : disasmLines.length > 0 ? (
                    <DisassemblyView lines={disasmLines} onNavigate={setCurrentAddress} />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-4">
                      <Code className="h-12 w-12 opacity-30" />
                      <p>Select a function from the sidebar to view disassembly</p>
                    </div>
                  )}
                </div>
              )}
              {currentView === 'hex' && currentFile && <HexView data={currentFile.data} offset={currentAddress} />}
              {currentView === 'strings' && <StringsView strings={strings} onSelect={(s) => setCurrentAddress(s.vaddr)} />}
              {currentView === 'graph' && <GraphView nodes={graphNodes} edges={graphEdges} />}
              {currentView === 'imports' && <ImportsView imports={imports} onNavigate={setCurrentAddress} />}
              {currentView === 'exports' && <ExportsView exports={exports} onNavigate={setCurrentAddress} />}
              {currentView === 'sections' && <SectionsView sections={sections} onNavigate={setCurrentAddress} />}
              {currentView === 'info' && <HeaderInfoPanel info={infoPayload} fileSize={currentFile?.size} />}
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-card px-2 sm:px-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={cn("h-2 w-2 rounded-full", activeInstance ? "bg-green-500" : "bg-muted")} />
            {activeInstance ? "Ready" : "Loading"}
          </div>
          <div className="tabular-nums">0x{currentAddress.toString(16).padStart(8, '0')}</div>
          {selectedFunction && <div className="text-primary">{selectedFunction}</div>}
        </div>
        <div>RzWeb</div>
      </footer>

      <CommandPalette />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
