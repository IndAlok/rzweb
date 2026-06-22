import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense, type ChangeEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { useFileStore, useRizinStore, useUIStore, useSettingsStore, useTabStore, type ActivePanel } from '@/stores';
import { loadRizinModule, getCachedVersions, RizinInstance, decodeProjectBundle, type RizinNotice } from '@/lib/rizin';
import { useKeyboardShortcuts } from '@/hooks';
import { RizinTerminal } from '@/components/terminal';
import { HexView, FunctionsView, StringsView, GraphView, DisassemblyView, ImportsView, ExportsView, SectionsView, HeaderInfoPanel, XrefsView, DecompilerView, FlagsView, CallGraphView } from '@/components/views';

// Code-split the script editor so CodeMirror only loads when Scripts is opened.
const ScriptsView = lazy(() => import('@/components/views/ScriptsView').then((m) => ({ default: m.ScriptsView })));
import { Button, Progress, Badge, Tabs, TabsList, TabsTrigger, CommandPalette, SettingsDialog, ShortcutsDialog } from '@/components/ui';
import { cn, stripAnsi } from '@/lib/utils';
import { Menu, X, Terminal as TerminalIcon, Settings, Code, Layout, Share2, Quote, FileCode, Home, Package, ArrowUpRight, Layers, Info, AlertTriangle, Save, FolderOpen, Braces, ArrowLeftRight, Pencil, Download, ScrollText, Plus, Flag, Network } from 'lucide-react';
import type { RzFunction, RzDisasmLine, RzString, RzImport, RzExport, RzSection } from '@/types/rizin';

function useResponsiveLayout() {
  const read = () => ({
    narrow: typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
    portrait: typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches,
  });
  const [layout, setLayout] = useState(read);

  useEffect(() => {
    const narrowMedia = window.matchMedia('(max-width: 767px)');
    const portraitMedia = window.matchMedia('(orientation: portrait)');
    const update = () => setLayout({ narrow: narrowMedia.matches, portrait: portraitMedia.matches });
    update();
    narrowMedia.addEventListener('change', update);
    portraitMedia.addEventListener('change', update);
    return () => {
      narrowMedia.removeEventListener('change', update);
      portraitMedia.removeEventListener('change', update);
    };
  }, []);

  return layout;
}

// Maps a virtual addr to its physical file offset via the section table.
function vaddrToOffset(vaddr: number, sections: RzSection[]): number | null {
  for (const s of sections) {
    const size = s.size || s.vsize || 0;
    if (typeof s.vaddr === 'number' && size > 0 && vaddr >= s.vaddr && vaddr < s.vaddr + size) {
      return (s.paddr ?? 0) + (vaddr - s.vaddr);
    }
  }
  return null;
}

interface RawDisasmOp {
  offset?: number;
  size?: number;
  bytes?: string;
  opcode?: string;
  disasm?: string;
  family?: string;
  type?: string;
  type_num?: number;
  type2_num?: number;
  comment?: string;
  jump?: number;
  fail?: number;
  refs?: { addr: number; type: string }[];
}

interface RawDisasm {
  ops?: RawDisasmOp[];
  instructions?: RawDisasmOp[];
}

interface RawGraphBlock {
  id?: number | string;
  offset?: number;
  addr?: number | string;
  vaddr?: number | string;
  title?: string;
  body?: string;
  ops?: RawDisasmOp[];
  jump?: number;
  fail?: number;
  out_nodes?: Array<number | string>;
}

interface RawGraphContainer {
  nodes?: RawGraphBlock[];
  blocks?: RawGraphBlock[];
  graph?: { nodes?: RawGraphBlock[]; blocks?: RawGraphBlock[] };
}

type GraphElements = {
  nodes: Array<{ id: string; label: string; body?: string; offset?: number }>;
  edges: Array<{ source: string; target: string; type?: 'jump' | 'fail' | 'call' }>;
};

function parseAddress(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.match(/0x[0-9a-fA-F]+|[0-9a-fA-F]{6,}/);
  if (!match) return undefined;
  const raw = match[0];
  const parsed = raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function AnalysisPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shouldCache = searchParams.get('cache') === 'true';

  const { clearCurrentFile, currentFile: launchedFile } = useFileStore();
  const { tabs, activeTabId, openTab, closeTab, setActiveTab, parkTab, reset: resetTabs } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const currentFile = activeTab?.file ?? null;
  const { isLoading, setLoading, loadProgress, setLoadProgress, loadPhase, setLoadPhase, setLoadMessage, setCachedVersions, setError } = useRizinStore();
  const { sidebarOpen, setSidebarOpen, splitDirection, setSettingsDialogOpen, currentAddress, setCurrentAddress, currentView, setCurrentView, selectedFunction, setSelectedFunction, setHexTarget } = useUIStore();
  const { ioCache, analysisDepth, noAnalysis, maxOutputSizeMb } = useSettingsStore();
  const { narrow, portrait } = useResponsiveLayout();
  const stacked = narrow || portrait;
  const panelDirection = stacked ? 'vertical' : splitDirection;

  useKeyboardShortcuts();

  const [activeInstance, setActiveInstance] = useState<RizinInstance | null>(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [alerts, setAlerts] = useState<RizinNotice[]>([]);
  const [disasmLines, setDisasmLines] = useState<RzDisasmLine[]>([]);
  const [isLoadingDisasm, setIsLoadingDisasm] = useState(false);
  const [graphNodes, setGraphNodes] = useState<GraphElements['nodes']>([]);
  const [graphEdges, setGraphEdges] = useState<GraphElements['edges']>([]);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [projectAction, setProjectAction] = useState<'save' | 'load' | null>(null);
  const [writeMode, setWriteMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [togglingWriteMode, setTogglingWriteMode] = useState(false);
  const [exportingBinary, setExportingBinary] = useState(false);
  const functionDetailRequestRef = useRef(0);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  // Per-tab Rizin instances persist here so background analysis keeps running
  // while another tab is active. Disposed on tab close and on leaving Analysis.
  const instancesRef = useRef(new Map<string, { instance: RizinInstance; ready: boolean; promise: Promise<void> }>());

  // Seed the first tab from the binary launched on the Home page.
  useEffect(() => {
    if (tabs.length === 0) {
      if (launchedFile) openTab(launchedFile);
      else navigate('/');
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose every tab's worker when leaving the Analysis page.
  useEffect(() => {
    const instances = instancesRef.current;
    return () => {
      for (const entry of instances.values()) void entry.instance.close();
      instances.clear();
    };
  }, []);

  const functions = useMemo<RzFunction[]>(() => {
    void analysisRevision;
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.functions as RzFunction[];
  }, [activeInstance, analysisReady, analysisRevision]);

  const strings = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.strings as RzString[];

  const imports = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.imports as RzImport[];

  const exports = !activeInstance?.analysis || !analysisReady
    ? []
    : activeInstance.analysis.exports as RzExport[];

  const sections = useMemo<RzSection[]>(() => {
    void analysisRevision;
    if (!activeInstance?.analysis || !analysisReady) return [];
    return activeInstance.analysis.sections as RzSection[];
  }, [activeInstance, analysisReady, analysisRevision]);

  const infoPayload = !activeInstance?.analysis || !analysisReady
    ? null
    : activeInstance.analysis.info;

  // The hex view shows the raw file at physical offsets (like a hex editor).
  const hexLayout = useMemo(() => ({ base: 0, size: currentFile?.size ?? 0 }), [currentFile?.size]);

  useEffect(() => {
    // Reset edit flags. The open response reports the real write-mode.
    setWriteMode(false);
    setIsDirty(false);

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

    // Sync write-mode and dirty flags after any edit, including terminal writes.
    const unsubscribeState = activeInstance.onStateChanged(() => {
      setWriteMode(activeInstance.isWriteMode);
      setIsDirty(activeInstance.isDirty);
    });

    return () => {
      unsubscribeAnalysis();
      unsubscribeNotice();
      unsubscribeState();
    };
  }, [activeInstance]);

  useEffect(() => {
    if (!currentFile) return;
    const tabId = currentFile.id;
    const file = currentFile;
    let cancelled = false;

    const attach = async () => {
      setAnalysisReady(false);
      setAlerts([]);
      setAnalysisRevision(0);
      setDisasmLines([]);
      setGraphNodes([]);
      setGraphEdges([]);

      let entry = instancesRef.current.get(tabId);
      const needsLoad = !entry || !entry.ready;
      if (needsLoad && !cancelled) {
        setLoading(true);
        setLoadPhase(entry ? 'analyzing' : 'initializing');
        setLoadProgress(entry ? 78 : 0);
      }

      try {
        if (!entry) {
          const worker = await loadRizinModule({
            onProgress: ({ phase, progress, message }) => {
              if (cancelled) return;
              setLoadPhase(phase);
              setLoadProgress(progress);
              setLoadMessage(message);
            },
          });
          const versions = await getCachedVersions();
          setCachedVersions(versions);
          const rz = new RizinInstance(worker);
          if (!cancelled) {
            setLoadPhase('analyzing');
            setLoadProgress(78);
            setLoadMessage(noAnalysis ? 'Opening binary without auto-analysis...' : 'Running initial analysis and indexing binary data...');
          }
          const promise = rz.open(file, {
            ioCache,
            analysisDepth,
            noAnalysis,
            maxOutputBytes: maxOutputSizeMb * 1024 * 1024,
            enableCache: shouldCache,
            extraArgs: ['-e', 'scr.color=0', '-e', 'scr.utf8=false'],
          }, file.projectData);
          entry = { instance: rz, ready: false, promise };
          instancesRef.current.set(tabId, entry);
          await promise;
          entry.ready = true;
          if (!cancelled) {
            toast.success(rz.cacheHit ? 'Loaded from analysis cache' : noAnalysis ? 'Binary opened' : 'Analysis complete');
          }
        } else if (!entry.ready) {
          await entry.promise;
          entry.ready = true;
        }
      } catch (error) {
        instancesRef.current.delete(tabId);
        console.error('Failed to load Rizin:', error);
        if (!cancelled) {
          setError(String(error));
          setLoadPhase('error');
          setLoading(false);
          toast.error(`Failed to load Rizin: ${error}`);
        }
        return;
      }

      if (cancelled) return;
      const rz = entry.instance;
      setLoading(false);
      setLoadPhase('ready');
      setActiveInstance(rz);
      setAnalysisReady(true);
      setAlerts(rz.allNotices);

      // Restore this tab's parked view, or seek to the binary's entrypoint.
      const parked = useTabStore.getState().tabs.find((t) => t.id === tabId)?.parked;
      if (parked) {
        setCurrentView(parked.view);
        setSelectedFunction(parked.selectedFunction);
        setCurrentAddress(parked.address);
      } else {
        setSelectedFunction(null);
        const initialSeek = Number.parseInt(rz.getCurrentAddress(), 16);
        setCurrentAddress(Number.isNaN(initialSeek) ? 0 : initialSeek);
      }
    };

    void attach();
    return () => {
      cancelled = true;
    };
    // Re-attach only when the active tab changes. Config is read at attach time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.id]);

  const buildDisassemblyLines = useCallback((disasm: unknown): RzDisasmLine[] => {
    const parsed = disasm as RawDisasm | RawDisasmOp[] | null;
    const ops: RawDisasmOp[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.ops)
        ? parsed.ops
        : Array.isArray(parsed?.instructions)
          ? parsed.instructions
          : [];

    return ops.map((op) => ({
      offset: op.offset ?? 0,
      size: op.size ?? 0,
      bytes: op.bytes ?? '',
      // Prefer `disasm` (flags/symbols resolved) over raw `opcode`, and strip
      // ANSI in case scr.color leaked escapes into the JSON.
      opcode: stripAnsi(op.opcode ?? op.disasm ?? ''),
      disasm: stripAnsi(op.disasm ?? op.opcode ?? ''),
      family: op.family ?? '',
      type: op.type ?? '',
      type_num: op.type_num ?? 0,
      type2_num: op.type2_num ?? 0,
      comment: op.comment,
      jump: op.jump,
      fail: op.fail,
      refs: op.refs,
    }));
  }, []);

  const buildGraphElements = useCallback((graph: unknown): GraphElements => {
    let blocks: RawGraphBlock[] = [];
    if (Array.isArray(graph)) {
      const arr = graph as RawGraphBlock[];
      const looksLikeBlocks = arr.length > 0 && arr.every(
        (node) => !!node && typeof node === 'object' &&
          ('offset' in node || 'id' in node || 'jump' in node || 'fail' in node || Array.isArray(node.ops))
      );
      if (looksLikeBlocks) {
        blocks = arr;
      } else if (arr.length > 0) {
        const first = arr[0] as RawGraphContainer;
        blocks = first?.blocks ?? first?.nodes ?? [];
      }
    } else if (graph && typeof graph === 'object') {
      const container = graph as RawGraphContainer;
      blocks = container.nodes ?? container.blocks ?? container.graph?.nodes ?? container.graph?.blocks ?? [];
    }

    if (!blocks.length) {
      return { nodes: [], edges: [] };
    }

    const offsetToId = new Map<number, string>();
    const nodes = blocks.map((node, idx) => {
      const nodeId = String(node.id ?? node.offset ?? idx);
      const nodeOffset = parseAddress(node.offset ?? node.addr ?? node.vaddr ?? node.id ?? node.title ?? node.body);
      if (typeof nodeOffset === 'number') {
        offsetToId.set(nodeOffset, nodeId);
      }
      return {
        id: nodeId,
        label: node.title ?? `0x${(nodeOffset ?? 0).toString(16)}`,
        body: stripAnsi(node.body ?? node.ops?.map((op) => op.disasm ?? op.opcode ?? '').join('\n') ?? ''),
        offset: nodeOffset,
      };
    });

    const edges: GraphElements['edges'] = [];
    blocks.forEach((node) => {
      const sourceId = String(node.id ?? node.offset ?? 0);
      const outNodes = Array.isArray(node.out_nodes) ? node.out_nodes : [];

      if (outNodes.length > 0) {
        outNodes.forEach((targetId, idx) => {
          const edgeType = outNodes.length === 2 ? (idx === 0 ? 'jump' as const : 'fail' as const) : 'jump' as const;
          const targetAddress = parseAddress(targetId);
          edges.push({
            source: sourceId,
            target: targetAddress == null ? String(targetId) : offsetToId.get(targetAddress) ?? String(targetId),
            type: edgeType,
          });
        });
        return;
      }

      if (typeof node.jump === 'number') {
        edges.push({ source: sourceId, target: offsetToId.get(node.jump) ?? String(node.jump), type: 'jump' });
      }
      if (typeof node.fail === 'number') {
        edges.push({ source: sourceId, target: offsetToId.get(node.fail) ?? String(node.fail), type: 'fail' });
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

  const handleSeek = useCallback((address: number, view?: ActivePanel) => {
    setCurrentAddress(address);
    if (view) setCurrentView(view);
  }, [setCurrentAddress, setCurrentView]);

  const handleShowInHex = useCallback((vaddr: number) => {
    const offset = vaddrToOffset(vaddr, sections);
    if (offset == null) {
      toast.error('That address is not in a file-backed section.');
      return;
    }
    setHexTarget(offset);
    setCurrentView('hex');
  }, [sections, setHexTarget, setCurrentView]);

  const handleRenameFunction = useCallback(async (offset: number, name: string) => {
    if (!activeInstance) return;
    const safe = name.trim().replace(/[^A-Za-z0-9_.]/g, '_');
    if (!safe) return;
    await activeInstance.executeCommand(`afn ${safe} @ 0x${offset.toString(16)}`);
    setAnalysisRevision((v) => v + 1);
    if (selectedFunction && currentAddress > 0) void loadFunctionPresentation(currentAddress);
    toast.success('Function renamed');
  }, [activeInstance, selectedFunction, currentAddress, loadFunctionPresentation]);

  const handleSetComment = useCallback(async (addr: number, text: string) => {
    if (!activeInstance) return;
    const comment = text.trim().replace(/[\n\r@]/g, ' ');
    await activeInstance.executeCommand(comment ? `CC ${comment} @ 0x${addr.toString(16)}` : `CC- @ 0x${addr.toString(16)}`);
    if (currentAddress > 0) void loadFunctionPresentation(currentAddress);
    toast.success(comment ? 'Comment set' : 'Comment removed');
  }, [activeInstance, currentAddress, loadFunctionPresentation]);

  // Seek to a function by address (call-graph node click) and show its disasm.
  const handleFunctionSelectByAddress = useCallback((addr: number) => {
    setCurrentAddress(addr);
    const fn = functions.find((f) => f.offset === addr);
    if (fn) setSelectedFunction(fn.name);
    setCurrentView('disasm');
    void loadFunctionPresentation(addr);
  }, [functions, setCurrentAddress, setSelectedFunction, setCurrentView, loadFunctionPresentation]);

  const handleRunCommand = useCallback((command: string) => {
    setPendingCommand(command);
    setCurrentView('terminal');
  }, [setCurrentView]);

  const clearPendingCommand = useCallback(() => setPendingCommand(null), []);

  // Save the active tab's view state so it can be restored when switched back.
  const parkActiveTab = useCallback(() => {
    if (activeTabId) {
      parkTab(activeTabId, { view: currentView, address: currentAddress, selectedFunction });
    }
  }, [activeTabId, parkTab, currentView, currentAddress, selectedFunction]);

  const handleSaveProject = useCallback(async () => {
    if (!activeInstance || !currentFile) return;

    setProjectAction('save');
    try {
      const data = await activeInstance.exportProject();
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = currentFile.name.replace(/[\\/:*?"<>|]+/g, '_') || 'rzweb-project';
      link.href = url;
      link.download = `${baseName}.rzdb`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Project saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save project.');
    } finally {
      setProjectAction(null);
    }
  }, [activeInstance, currentFile]);

  const handleToggleWriteMode = useCallback(async () => {
    if (!activeInstance) return;
    setTogglingWriteMode(true);
    try {
      const next = await activeInstance.setWriteMode(!writeMode);
      setWriteMode(next);
      toast.success(next ? 'Editing unlocked' : 'Editing locked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not toggle editing');
    } finally {
      setTogglingWriteMode(false);
    }
  }, [activeInstance, writeMode]);

  const handleExportBinary = useCallback(async () => {
    if (!activeInstance) return;
    setExportingBinary(true);
    try {
      const { data, name } = await activeInstance.exportBinary();
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (name || 'binary').replace(/[\\/:*?"<>|]+/g, '_');
      // foo.exe becomes foo.patched.exe so the extension stays valid.
      const dot = safeName.lastIndexOf('.');
      const downloadName = dot > 0 ? `${safeName.slice(0, dot)}.patched${safeName.slice(dot)}` : `${safeName}.patched`;
      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setIsDirty(false);
      toast.success('Binary saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save binary');
    } finally {
      setExportingBinary(false);
    }
  }, [activeInstance]);

  const handleLoadProjectClick = useCallback(() => {
    projectInputRef.current?.click();
  }, []);

  const handleProjectFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const projectFile = event.target.files?.[0];
    event.target.value = '';
    if (!projectFile) return;

    setProjectAction('load');
    try {
      const bytes = new Uint8Array(await projectFile.arrayBuffer());

      // Self-contained RzWeb bundle: swap in the embedded binary + project and
      // let the open effect re-run a full cold restore (keeps currentFile in
      // sync, works even when the open binary differs from the project's).
      const bundle = decodeProjectBundle(bytes);
      if (bundle) {
        parkActiveTab();
        openTab({
          id: crypto.randomUUID(),
          name: bundle.name,
          data: bundle.binary,
          size: bundle.binary.byteLength,
          loadedAt: Date.now(),
          projectData: bundle.rzdb,
        });
        toast.success('Project loaded');
        return;
      }

      // Rizin .rzdb: load it into the currently-open matching binary.
      if (!activeInstance) {
        toast.error('Open a binary before loading a raw Rizin project.');
        return;
      }
      await activeInstance.importProject(bytes);
      setAnalysisReady(true);
      setAnalysisRevision(v => v + 1);
      setAlerts(activeInstance.allNotices);
      setDisasmLines([]);
      setGraphNodes([]);
      setGraphEdges([]);
      setSelectedFunction(null);
      const seek = Number.parseInt(activeInstance.getCurrentAddress(), 16);
      if (!Number.isNaN(seek)) {
        setCurrentAddress(seek);
      }
      toast.success('Project loaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load project.');
    } finally {
      setProjectAction(null);
    }
  }, [activeInstance, setCurrentAddress, setSelectedFunction, setAnalysisReady, parkActiveTab, openTab]);

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

  const handleSwitchTab = useCallback((id: string) => {
    if (id === activeTabId) return;
    parkActiveTab();
    setActiveTab(id);
  }, [activeTabId, parkActiveTab, setActiveTab]);

  const handleCloseTab = useCallback((id: string) => {
    const entry = instancesRef.current.get(id);
    if (entry) {
      void entry.instance.close();
      instancesRef.current.delete(id);
    }
    const wasLast = tabs.length <= 1;
    closeTab(id);
    if (wasLast) {
      clearCurrentFile();
      navigate('/');
    }
  }, [tabs.length, closeTab, clearCurrentFile, navigate]);

  // Each tab holds a full WASM worker, so cap the count (tighter on mobile).
  const maxTabs = stacked ? 3 : 8;
  const atTabLimit = tabs.length >= maxTabs;

  const handleAddBinary = useCallback(() => {
    if (tabs.length >= maxTabs) {
      toast.error(`Up to ${maxTabs} binaries can be open at once.`);
      return;
    }
    addInputRef.current?.click();
  }, [tabs.length, maxTabs]);

  const handleAddFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      parkActiveTab();
      openTab({ id: crypto.randomUUID(), name: file.name, data, size: file.size, loadedAt: Date.now() });
    } catch {
      toast.error('Unable to open the selected binary.');
    }
  }, [parkActiveTab, openTab]);

  const handleGoHome = useCallback(() => {
    for (const entry of instancesRef.current.values()) void entry.instance.close();
    instancesRef.current.clear();
    resetTabs();
    clearCurrentFile();
    navigate('/');
  }, [resetTabs, clearCurrentFile, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <div className="mb-8 rounded-full bg-primary/10 p-6">
          <TerminalIcon className="h-16 w-16 animate-pulse text-primary" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-foreground">
          {loadPhase === 'downloading' ? 'Loading Rizin' : loadPhase === 'analyzing' ? 'Analyzing binary' : 'Preparing session'}
        </h2>
        <p className="mb-6 max-w-md text-center text-muted-foreground">
          {loadPhase === 'analyzing'
            ? 'Mapping functions, strings, sections, and control flow.'
            : 'This will only take a moment.'}
        </p>
        <div className="w-80"><Progress value={loadProgress} showValue /></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border/70 bg-muted/30 px-2 scrollbar-hidden">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => handleSwitchTab(tab.id)}
              title={tab.file.name}
              className={cn(
                'group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-t border-b-2 px-2.5 text-xs transition-colors',
                tab.id === activeTabId
                  ? 'border-primary bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent/40'
              )}
            >
              <FileCode className="h-3 w-3 shrink-0 opacity-70" />
              <span className="max-w-[140px] truncate">{tab.file.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                className="ml-0.5 rounded p-0.5 opacity-0 hover:text-destructive group-hover:opacity-100"
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <input ref={addInputRef} type="file" className="hidden" onChange={handleAddFileSelected} />
          <button
            onClick={handleAddBinary}
            disabled={atTabLimit}
            className="ml-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={atTabLimit ? `Limit of ${maxTabs} binaries reached` : 'Open another binary'}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-2 py-2 sm:px-4">
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleGoHome} title="Back to Home">
              <Home className="h-4 w-4" />
            </Button>
            <div className="hidden items-center gap-2 sm:flex">
              <TerminalIcon className="h-5 w-5 text-primary" />
              <span className="text-sm font-bold tracking-tight text-foreground">RzWeb</span>
            </div>
            <TerminalIcon className="h-5 w-5 text-primary sm:hidden" />
          </div>

          {currentFile && (
            <Badge
              variant="outline"
              className="ml-1 hidden max-w-[40vw] truncate border-primary/20 bg-primary/5 py-1 text-[10px] font-mono md:flex"
            >
              <FileCode className="mr-1.5 h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">{currentFile.name}</span>
            </Badge>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <input
              ref={projectInputRef}
              type="file"
              accept=".rzdb,application/octet-stream"
              className="hidden"
              onChange={handleProjectFileSelected}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleWriteMode}
              disabled={!activeInstance || togglingWriteMode}
              title={writeMode ? 'Lock editing' : 'Unlock editing'}
              className={cn(writeMode && 'text-amber-500 bg-amber-500/10')}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleExportBinary}
              disabled={!activeInstance || exportingBinary}
              title="Save binary"
              className="relative"
            >
              <Download className="h-4 w-4" />
              {isDirty && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleSaveProject}
              disabled={!activeInstance || projectAction !== null}
              title={projectAction === 'save' ? 'Saving project' : 'Save project'}
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleLoadProjectClick}
              disabled={!activeInstance || projectAction !== null}
              title={projectAction === 'load' ? 'Loading project' : 'Load .rzdb project'}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setSettingsDialogOpen(true)} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleGoHome} title="Exit">
              <X className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="border-t border-border/70 px-2 py-2 sm:px-4">
          <Tabs value={currentView} onValueChange={(v) => setCurrentView(v as ActivePanel)}>
            <div className="overflow-x-auto scrollbar-hidden">
              <TabsList className="h-9 min-w-max justify-start bg-muted/50">
                <TabsTrigger value="terminal" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <TerminalIcon className="h-3.5 w-3.5" /><span>Terminal</span>
                </TabsTrigger>
                <TabsTrigger value="disasm" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Code className="h-3.5 w-3.5" /><span>Disasm</span>
                </TabsTrigger>
                <TabsTrigger value="decompiler" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Braces className="h-3.5 w-3.5" /><span>Decompiler</span>
                </TabsTrigger>
                <TabsTrigger value="hex" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Layout className="h-3.5 w-3.5" /><span>Hex</span>
                </TabsTrigger>
                <TabsTrigger value="strings" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Quote className="h-3.5 w-3.5" /><span>Strings</span>
                </TabsTrigger>
                <TabsTrigger value="graph" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Share2 className="h-3.5 w-3.5" /><span>Graph</span>
                </TabsTrigger>
                <TabsTrigger value="xrefs" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <ArrowLeftRight className="h-3.5 w-3.5" /><span>Xrefs</span>
                </TabsTrigger>
                <TabsTrigger value="scripts" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <ScrollText className="h-3.5 w-3.5" /><span>Scripts</span>
                </TabsTrigger>
                <TabsTrigger value="flags" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Flag className="h-3.5 w-3.5" /><span>Flags</span>
                </TabsTrigger>
                <TabsTrigger value="callgraph" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Network className="h-3.5 w-3.5" /><span>Call Graph</span>
                </TabsTrigger>
                <TabsTrigger value="imports" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Package className="h-3.5 w-3.5" /><span>Imports</span>
                </TabsTrigger>
                <TabsTrigger value="exports" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <ArrowUpRight className="h-3.5 w-3.5" /><span>Exports</span>
                </TabsTrigger>
                <TabsTrigger value="sections" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Layers className="h-3.5 w-3.5" /><span>Sections</span>
                </TabsTrigger>
                <TabsTrigger value="info" className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3">
                  <Info className="h-3.5 w-3.5" /><span>Info</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
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
        <PanelGroup direction={panelDirection}>
          {sidebarOpen && (
            <>
              <Panel
                defaultSize={stacked ? 34 : 20}
                minSize={stacked ? 22 : 15}
                maxSize={stacked ? 55 : 40}
                className="bg-card"
              >
                <FunctionsView
                  functions={functions}
                  onSelect={handleFunctionSelect}
                  onRename={handleRenameFunction}
                  onShowInHex={handleShowInHex}
                  className={panelDirection === 'vertical' ? 'border-b border-r-0' : undefined}
                />
              </Panel>
              <PanelResizeHandle
                className={cn(
                  'bg-border/50 transition-colors hover:bg-primary/30',
                  panelDirection === 'vertical' ? 'h-1' : 'w-1'
                )}
              />
            </>
          )}
          
          <Panel>
            <div className="h-full relative bg-[#0f172a]">
              {currentView === 'terminal' && activeInstance && (
                <RizinTerminal
                  rizin={activeInstance}
                  className="h-full w-full"
                  pendingCommand={pendingCommand}
                  onPendingCommandConsumed={clearPendingCommand}
                />
              )}
              {currentView === 'disasm' && (
                <div className="h-full">
                  {isLoadingDisasm ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      Loading disassembly...
                    </div>
                  ) : disasmLines.length > 0 ? (
                    <DisassemblyView lines={disasmLines} onNavigate={setCurrentAddress} onComment={handleSetComment} onShowInHex={handleShowInHex} />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-4">
                      <Code className="h-12 w-12 opacity-30" />
                      <p>Select a function from the sidebar to view disassembly</p>
                    </div>
                  )}
                </div>
              )}
              {currentView === 'decompiler' && activeInstance && <DecompilerView rizin={activeInstance} address={currentAddress} functionName={selectedFunction} />}
              {currentView === 'hex' && activeInstance && <HexView rizin={activeInstance} baseAddress={hexLayout.base} totalSize={hexLayout.size} writeMode={writeMode} onAfterWrite={() => setIsDirty(true)} />}
              {currentView === 'strings' && <StringsView strings={strings} onSelect={(s) => setCurrentAddress(s.vaddr)} />}
              {currentView === 'graph' && <GraphView nodes={graphNodes} edges={graphEdges} currentAddress={currentAddress} onSeek={setCurrentAddress} />}
              {currentView === 'xrefs' && activeInstance && <XrefsView rizin={activeInstance} address={currentAddress} onSeek={setCurrentAddress} />}
              {currentView === 'flags' && activeInstance && <FlagsView rizin={activeInstance} onSeek={setCurrentAddress} />}
              {currentView === 'callgraph' && activeInstance && <CallGraphView rizin={activeInstance} onSeek={handleFunctionSelectByAddress} />}
              {currentView === 'scripts' && activeInstance && (
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading editor...</div>}>
                  <ScriptsView rizin={activeInstance} />
                </Suspense>
              )}
              {currentView === 'imports' && <ImportsView imports={imports} onNavigate={setCurrentAddress} />}
              {currentView === 'exports' && <ExportsView exports={exports} onNavigate={setCurrentAddress} />}
              {currentView === 'sections' && <SectionsView sections={sections} onNavigate={setCurrentAddress} />}
              {currentView === 'info' && <HeaderInfoPanel info={infoPayload} fileSize={currentFile?.size} />}
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <footer className="shrink-0 border-t border-border bg-card px-2 py-1.5 text-[10px] text-muted-foreground sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-1.5">
            <div className={cn("h-2 w-2 rounded-full", activeInstance ? "bg-green-500" : "bg-muted")} />
            {activeInstance ? "Ready" : "Loading"}
          </div>
          <div className="tabular-nums">0x{currentAddress.toString(16).padStart(8, '0')}</div>
          {selectedFunction && <div className="text-primary">{selectedFunction}</div>}
          </div>
          <div>RzWeb</div>
        </div>
      </footer>

      <CommandPalette
        functions={functions}
        strings={strings}
        onSeek={handleSeek}
        onSelectFunction={handleFunctionSelect}
        onRunCommand={handleRunCommand}
      />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
