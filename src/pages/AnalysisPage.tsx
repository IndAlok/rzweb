import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { useFileStore, useRizinStore, useUIStore, useSettingsStore } from '@/stores';
import { loadRizinModule, getCachedVersions, RizinInstance } from '@/lib/rizin';
import { RizinTerminal, type RizinTerminalRef } from '@/components/terminal';
import { HexView, FunctionsView, StringsView, GraphView, DisassemblyView } from '@/components/views';
import { Button, Progress, Badge, Tabs, TabsList, TabsTrigger, CommandPalette, SettingsDialog, ShortcutsDialog } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Menu, X, Terminal as TerminalIcon, Settings, Code, Layout, Share2, Quote, FileCode, Home } from 'lucide-react';
import type { RzFunction, RzDisasmLine, RzString } from '@/types/rizin';

export default function AnalysisPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const version = searchParams.get('version') || '0.8.1';
  const shouldCache = searchParams.get('cache') === 'true';

  const { currentFile, clearCurrentFile } = useFileStore();
  const { setModule, isLoading, setLoading, loadProgress, setLoadProgress, loadPhase, setLoadPhase, setLoadMessage, setCachedVersions, setError } = useRizinStore();
  const { sidebarOpen, setSidebarOpen, setSettingsDialogOpen, currentAddress, setCurrentAddress, currentView, setCurrentView, selectedFunction, setSelectedFunction } = useUIStore();
  const { ioCache, analysisDepth } = useSettingsStore();

  const [activeInstance, setActiveInstance] = useState<RizinInstance | null>(null);
  const [disasmLines, setDisasmLines] = useState<RzDisasmLine[]>([]);
  const [isLoadingDisasm, setIsLoadingDisasm] = useState(false);
  const [graphNodes, setGraphNodes] = useState<Array<{id: string; label: string; body?: string}>>([]);
  const [graphEdges, setGraphEdges] = useState<Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}>>([]);
  const terminalRef = useRef<RizinTerminalRef>(null);

  const functions = useMemo<RzFunction[]>(() => {
    if (!activeInstance?.analysis) return [];
    return activeInstance.analysis.functions as RzFunction[];
  }, [activeInstance]);

  const strings = useMemo<RzString[]>(() => {
    if (!activeInstance?.analysis) return [];
    return activeInstance.analysis.strings as RzString[];
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
        setLoadPhase('ready');
        toast.success(`Rizin ${version} loaded`);

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
      const cmd = `aaa;s ${address};pdfj`;
      console.log('[AnalysisPage:fetchDisassembly] Running:', cmd);
      const output = await activeInstance.executeCommand(cmd);
      console.log('[AnalysisPage:fetchDisassembly] Output length:', output.length);
      
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
              console.log('[AnalysisPage:fetchDisassembly] Parsed', lines.length, 'instructions');
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
      const cmd = `aaa;s ${address};agf json`;
      const output = await activeInstance.executeCommand(cmd);
      console.log('[AnalysisPage:fetchGraphData] Output:', output.substring(0, 500));
      
      if (output && output.length > 2) {
        try {
          // agf json returns: {"nodes":[{id, title, body, offset, out_nodes}]}
          const jsonMatch = output.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            const graphNodes = parsed.nodes || [];
            
            if (graphNodes.length > 0) {
              // Map nodes: id is numeric, title is address label, body is disasm
              const nodes = graphNodes.map((node: any) => ({
                id: String(node.id),
                label: node.title || `0x${node.offset?.toString(16) || '0'}`,
                body: node.body || '',
              }));
              
              // Build edges from out_nodes array
              const edges: Array<{source: string; target: string; type?: 'jump' | 'fail' | 'call'}> = [];
              graphNodes.forEach((node: any) => {
                const outNodes = node.out_nodes || [];
                outNodes.forEach((targetId: number, idx: number) => {
                  // First out_node is usually true branch (jump), second is false (fail)
                  const edgeType = outNodes.length === 2 
                    ? (idx === 0 ? 'jump' as const : 'fail' as const)
                    : 'jump' as const;
                  edges.push({ 
                    source: String(node.id), 
                    target: String(targetId), 
                    type: edgeType 
                  });
                });
              });
              
              console.log('[AnalysisPage:fetchGraphData] Parsed nodes:', nodes.length, 'edges:', edges.length);
              setGraphNodes(nodes);
              setGraphEdges(edges);
            } else {
              console.log('[AnalysisPage:fetchGraphData] No nodes in graph');
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
    console.log('[AnalysisPage:handleFunctionSelect]', fcn.name, fcn.offset);
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleGoHome} title="Back to Home">
            <Home className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5 text-primary" />
            <span className="font-bold text-sm tracking-tight text-foreground">RzWeb</span>
          </div>
        </div>

        <div className="h-6 w-px bg-border mx-2" />

        <Tabs value={currentView} onValueChange={(v) => setCurrentView(v as any)}>
          <TabsList className="h-8 bg-muted/50">
            <TabsTrigger value="terminal" className="text-xs gap-1.5 px-3">
              <TerminalIcon className="h-3.5 w-3.5" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="disasm" className="text-xs gap-1.5 px-3">
              <Code className="h-3.5 w-3.5" /> Disassembly
            </TabsTrigger>
            <TabsTrigger value="hex" className="text-xs gap-1.5 px-3">
              <Layout className="h-3.5 w-3.5" /> Hex
            </TabsTrigger>
            <TabsTrigger value="strings" className="text-xs gap-1.5 px-3">
              <Quote className="h-3.5 w-3.5" /> Strings
            </TabsTrigger>
            <TabsTrigger value="graph" className="text-xs gap-1.5 px-3">
              <Share2 className="h-3.5 w-3.5" /> Graph
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-2">
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
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-card px-4 text-[10px] text-muted-foreground">
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
