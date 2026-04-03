import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { useFileStore, useRizinStore, useUIStore, useSettingsStore } from '@/stores';
import { loadRizinModule, getCachedVersions, RizinInstance } from '@/lib/rizin';
import { RizinTerminal, type RizinTerminalRef } from '@/components/terminal';
import { HexView, FunctionsView, StringsView, GraphView, DisassemblyView, ImportsView, ExportsView, SectionsView, HeaderInfoPanel } from '@/components/views';
import { Button, Progress, Badge, Tabs, TabsList, TabsTrigger, CommandPalette, SettingsDialog, ShortcutsDialog } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Menu, X, Terminal as TerminalIcon, Settings, Code, Layout, Share2, Quote, FileCode, Home, Package, ArrowUpRight, Layers, Info } from 'lucide-react';
import type { RzFunction, RzDisasmLine, RzString, RzImport, RzExport, RzSection, RzBinInfo } from '@/types/rizin';

export default function AnalysisPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const version = searchParams.get('version') || 'latest';
  const shouldCache = searchParams.get('cache') === 'true';

  const { currentFile, clearCurrentFile } = useFileStore();
  const { setModule, isLoading, setLoading, loadProgress, setLoadProgress, loadPhase, setLoadPhase, setLoadMessage, setCachedVersions, setError } = useRizinStore();
  const { sidebarOpen, setSidebarOpen, setSettingsDialogOpen, currentAddress, setCurrentAddress, currentView, setCurrentView, selectedFunction, setSelectedFunction } = useUIStore();
  const { ioCache, analysisDepth } = useSettingsStore();

  const [activeInstance, setActiveInstance] = useState<RizinInstance | null>(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [disasmLines, setDisasmLines] = useState<RzDisasmLine[]>([]);
  const [isLoadingDisasm, setIsLoadingDisasm] = useState(false);
  const [graphNodes, setGraphNodes] = useState<Array<{id: string; label: string; body?: string}>>([]);
  const [graphEdges, setGraphEdges] = useState<Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}>>([]);
  const terminalRef = useRef<RizinTerminalRef>(null);

  const functions = useMemo<RzFunction[]>(() => {
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.functions as RzFunction[];
  }, [activeInstance, analysisReady]);

  const strings = useMemo<RzString[]>(() => {
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.strings as RzString[];
  }, [activeInstance, analysisReady]);

  const imports = useMemo<RzImport[]>(() => {
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.imports as RzImport[];
  }, [activeInstance, analysisReady]);

  const exports = useMemo<RzExport[]>(() => {
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.exports as RzExport[];
  }, [activeInstance, analysisReady]);

  const sections = useMemo<RzSection[]>(() => {
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.sections as RzSection[];
  }, [activeInstance, analysisReady]);

  const binInfo = useMemo<RzBinInfo | null>(() => {
    if (!activeInstance?.analysis || !analysisReady) return null;
    const info = activeInstance.analysis.info as any;
    return info?.core?.info || info?.info || info || null;
  }, [activeInstance, analysisReady]);

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
        await rz.open(currentFile, {
          ioCache,
          analysisDepth,
          extraArgs: ['-e', 'scr.color=0', '-e', 'scr.utf8=false'],
        });

        setActiveInstance(rz);
        setAnalysisReady(true);
        setLoadPhase('ready');
        if (rz.cacheHit) {
          toast.success('Loaded from analysis cache');
        } else {
          toast.success(`Analysis complete`);
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
  }, [version, shouldCache, currentFile, navigate, setLoading, setLoadPhase, setLoadProgress, setLoadMessage, setModule, setCachedVersions, setError, ioCache, analysisDepth]);

  const fetchDisassembly = useCallback(async (address: number) => {
    if (!activeInstance) return;
    
    setIsLoadingDisasm(true);
    try {
      const cmd = `s ${address};pdfj`;

      const output = await activeInstance.executeCommand(cmd);

      
      if (output) {
        try {
          const jsonMatch = output.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.ops && Array.isArray(parsed.ops)) {
              const lines: RzDisasmLine[] = parsed.ops.map((op: any) => ({
                offset: op.offset || 0,
                bytes: op.bytes || '',
                opcode: op.opcode || op.disasm || '',
                comment: op.comment,
                jump: op.jump,
                refs: op.refs,
              }));
              setDisasmLines(lines);

            }
          }
        } catch (e) {
          console.error('[AnalysisPage:fetchDisassembly] Parse error:', e);
        }
      }
    } finally {
      setIsLoadingDisasm(false);
    }
  }, [activeInstance]);

  const fetchGraphData = useCallback(async (address: number) => {
    if (!activeInstance) return;
    
    try {
      const cmd = `s ${address};agfj`;
      const output = await activeInstance.executeCommand(cmd);
      
      if (output && output.length > 2) {
        try {
          const jsonMatch = output.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            
            let graphBlocks: any[] = [];
            if (Array.isArray(parsed) && parsed.length > 0) {
              graphBlocks = parsed[0]?.blocks || parsed[0]?.nodes || [];
            } else if (parsed.nodes) {
              graphBlocks = parsed.nodes;
            } else if (parsed.blocks) {
              graphBlocks = parsed.blocks;
            }
            
            if (graphBlocks.length > 0) {
              const nodes = graphBlocks.map((node: any, idx: number) => ({
                id: String(node.offset ?? node.id ?? idx),
                label: node.title || `0x${(node.offset ?? 0).toString(16)}`,
                body: node.body || node.ops?.map((o: any) => o.disasm || o.opcode || '').join('\n') || '',
              }));
              
              const edges: Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}> = [];
              graphBlocks.forEach((node: any) => {
                const nodeId = String(node.offset ?? node.id ?? 0);
                
                if (node.jump != null && node.jump !== -1) {
                  edges.push({ source: nodeId, target: String(node.jump), type: 'jump' });
                }
                if (node.fail != null && node.fail !== -1) {
                  edges.push({ source: nodeId, target: String(node.fail), type: 'fail' });
                }
                
                const outNodes = node.out_nodes || [];
                outNodes.forEach((targetId: number, idx: number) => {
                  const edgeType = outNodes.length === 2 
                    ? (idx === 0 ? 'jump' as const : 'fail' as const)
                    : 'jump' as const;
                  edges.push({ source: nodeId, target: String(targetId), type: edgeType });
                });
              });
              
              setGraphNodes(nodes);
              setGraphEdges(edges);
            }
          }
        } catch (e) {
          console.error('[AnalysisPage:fetchGraphData] Parse error:', e);
        }
      }
    } catch (e) {
      console.error('[AnalysisPage:fetchGraphData] Error:', e);
    }
  }, [activeInstance]);

  const handleFunctionSelect = useCallback((fcn: RzFunction) => {

    setCurrentAddress(fcn.offset);
    setSelectedFunction(fcn.name);
    if (currentView === 'terminal') {
      setCurrentView('disasm');
    }
    fetchDisassembly(fcn.offset);
    fetchGraphData(fcn.offset);
  }, [setCurrentAddress, setSelectedFunction, setCurrentView, currentView, fetchDisassembly, fetchGraphData]);

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
          {loadPhase === 'downloading' ? 'Downloading Rizin...' : 'Initializing...'}
        </h2>
        <p className="mb-6 text-muted-foreground">Please wait</p>
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
              {currentView === 'info' && <HeaderInfoPanel info={binInfo} fileSize={currentFile?.size} />}
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
