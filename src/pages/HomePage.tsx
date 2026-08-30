import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useFileStore, useSettingsStore } from '@/stores';
import { Button } from '@/components/ui';
import { FileDropZone } from '@/components/file';
import { formatSize } from '@/lib/utils/format';
import { getRizinVersion } from '@/lib/utils/version';
import {
  computeFileHash,
  createContext,
  decodeProjectBundle,
  deleteContext,
  getArtifact,
  getCurrentRzdb,
  listContexts,
  listContextsForHash,
  type RzwebContext,
} from '@/lib/rizin';
import { Github, Moon, Sun, Terminal, Cpu, Lock, Code2, FolderOpen, Trash2 } from 'lucide-react';
import { useTheme } from '@/providers';

interface PendingLaunch {
  name: string;
  data: Uint8Array;
  size: number;
  hash: string;
  existing: RzwebContext[];
}

export default function HomePage() {
  const navigate = useNavigate();
  const { setCurrentFile, recentFiles } = useFileStore();
  const { cacheVersions, setCacheVersions, analysisDepth } = useSettingsStore();
  const { setTheme, resolvedTheme } = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [openingContextId, setOpeningContextId] = useState<string | null>(null);
  const [rizinVersion, setRizinVersion] = useState('...');
  const [contexts, setContexts] = useState<RzwebContext[]>([]);
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const refreshLibrary = useCallback(() => {
    void listContexts().then(setContexts);
  }, []);

  useEffect(() => {
    getRizinVersion().then(setRizinVersion);
    refreshLibrary();
  }, [refreshLibrary]);

  const handleFileSelect = useCallback((nextFile: File) => {
    setFile(nextFile);
    setPendingLaunch(null);
  }, []);

  const launchContext = useCallback((params: {
    id: string;
    name: string;
    data: Uint8Array;
    size: number;
    projectData?: Uint8Array;
    artifactHash?: string;
  }) => {
    setCurrentFile({
      id: params.id,
      name: params.name,
      data: params.data,
      size: params.size,
      loadedAt: Date.now(),
      projectData: params.projectData,
      artifactHash: params.artifactHash,
    });
    navigate(`/analyze?cache=${cacheVersions}`);
  }, [navigate, setCurrentFile, cacheVersions]);

  const resumeContext = useCallback(async (ctx: RzwebContext, data?: Uint8Array) => {
    setOpeningContextId(ctx.id);
    try {
      const artifact = data ? { data, fileSize: data.byteLength } : await getArtifact(ctx.artifactHash);
      if (!artifact) {
        toast.error('The binary for this context is no longer stored.');
        refreshLibrary();
        return;
      }
      const rzdb = await getCurrentRzdb(ctx.id);
      launchContext({
        id: ctx.id,
        name: ctx.name,
        data: artifact.data,
        size: artifact.fileSize,
        projectData: rzdb,
        artifactHash: ctx.artifactHash,
      });
    } catch {
      toast.error('Unable to reopen that context.');
    } finally {
      setOpeningContextId(null);
    }
  }, [launchContext, refreshLibrary]);

  const handleOpenProjectClick = useCallback(() => {
    projectInputRef.current?.click();
  }, []);

  const handleProjectFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const projectFile = event.target.files?.[0];
    event.target.value = '';
    if (!projectFile) return;

    try {
      const bytes = new Uint8Array(await projectFile.arrayBuffer());
      const bundle = decodeProjectBundle(bytes);
      if (!bundle) {
        toast.error('A raw Rizin project needs its binary. Open the binary first, then load the project from the workspace.');
        return;
      }
      const ctx = await createContext({
        name: bundle.name,
        data: bundle.binary,
        analysisDepth,
        rzdb: bundle.rzdb,
      });
      launchContext({
        id: ctx.id,
        name: ctx.name,
        data: bundle.binary,
        size: bundle.binary.byteLength,
        projectData: bundle.rzdb,
        artifactHash: ctx.artifactHash,
      });
    } catch {
      toast.error('Unable to open the selected project file.');
    }
  }, [analysisDepth, launchContext]);

  const handleOpenRizin = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const hash = await computeFileHash(data);
      const existing = await listContextsForHash(hash);
      if (existing.length > 0) {
        setPendingLaunch({ name: file.name, data, size: file.size, hash, existing });
        return;
      }
      const ctx = await createContext({ name: file.name, data, analysisDepth });
      launchContext({
        id: ctx.id,
        name: ctx.name,
        data,
        size: file.size,
        artifactHash: ctx.artifactHash,
      });
    } catch {
      toast.error('Unable to open the selected binary.');
    } finally {
      setIsProcessing(false);
    }
  }, [analysisDepth, file, launchContext]);

  const handleResumeLatest = useCallback(() => {
    if (!pendingLaunch) return;
    void resumeContext(pendingLaunch.existing[0], pendingLaunch.data);
  }, [pendingLaunch, resumeContext]);

  const handleCreateNewContext = useCallback(async () => {
    if (!pendingLaunch) return;
    setIsProcessing(true);
    try {
      const ctx = await createContext({
        name: pendingLaunch.name,
        data: pendingLaunch.data,
        analysisDepth,
      });
      launchContext({
        id: ctx.id,
        name: ctx.name,
        data: pendingLaunch.data,
        size: pendingLaunch.size,
        artifactHash: ctx.artifactHash,
      });
    } catch {
      toast.error('Unable to create a new context.');
    } finally {
      setIsProcessing(false);
    }
  }, [analysisDepth, launchContext, pendingLaunch]);

  const handleDeleteContext = useCallback(async (id: string) => {
    if (!window.confirm('Delete this context and its snapshots? The binary stays if another context still uses it.')) {
      return;
    }
    try {
      await deleteContext(id);
      refreshLibrary();
    } catch {
      toast.error('Unable to delete that context.');
    }
  }, [refreshLibrary]);

  const formatHash = useCallback((hash: string) => `${hash.slice(0, 12)}...${hash.slice(-6)}`, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-primary" />
          <span className="font-mono font-bold text-primary">RzWeb</span>
          <span className="text-[10px] font-mono text-muted-foreground">v{rizinVersion}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'rizin-light' : 'rizin-dark')}
            title="Toggle light / dark"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <a href="https://github.com/IndAlok/rzweb" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center sm:mb-8">
            <div className="overflow-x-auto">
              <pre
                aria-label="RzWeb"
                className="inline-block min-w-max text-[9px] leading-none text-primary sm:text-sm font-mono"
              >
{` ____         __        __         _     
|  _ \\   ____ \\ \\      / /   ___  | |__  
| |_) | |_  /  \\ \\ /\\ / /   / _ \\ | '_ \\ 
|  _ <   / /    \\ V  V /   |  __/ | |_) |
|_| \\_\\ /___|    \\_/\\_/     \\___| |_.__/`}
              </pre>
            </div>
            <p className="mt-4 text-sm font-mono text-foreground/80">
              Browser-Based Reverse Engineering
            </p>
            <p className="mx-auto mt-2 max-w-md text-xs font-mono text-muted-foreground">
              Analyze binaries in your browser. Files stay on this device unless you use hosted MCP.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <FileDropZone
              onFileSelect={handleFileSelect}
              selectedFile={file}
              onClear={() => { setFile(null); setPendingLaunch(null); }}
            />

            {pendingLaunch && (
              <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-xs font-medium text-foreground">
                  This binary already has {pendingLaunch.existing.length === 1 ? 'a context' : `${pendingLaunch.existing.length} contexts`}.
                </p>
                <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                  Resume keeps names, comments, and analysis. New context starts a separate history.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleResumeLatest} loading={openingContextId === pendingLaunch.existing[0]?.id}>
                    Resume {pendingLaunch.existing[0]?.name}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleCreateNewContext()} loading={isProcessing}>
                    New context
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-mono text-muted-foreground">
                <input
                  type="checkbox"
                  checked={cacheVersions}
                  onChange={(event) => setCacheVersions(event.target.checked)}
                  className="h-3 w-3 rounded border-border"
                />
                Cache offline
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={projectInputRef}
                  type="file"
                  accept=".rzdb,.rzwebprj,application/octet-stream"
                  className="hidden"
                  onChange={handleProjectFileSelected}
                />
                <Button variant="outline" onClick={handleOpenProjectClick} title="Open a saved RzWeb project">
                  <FolderOpen className="mr-1.5 h-4 w-4" />
                  Open Project
                </Button>
                <Button
                  onClick={handleOpenRizin}
                  disabled={!file || isProcessing}
                  loading={isProcessing && !pendingLaunch}
                >
                  Analyze
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:mt-6 sm:grid-cols-3 sm:gap-4">
            <div className="flex items-center justify-center gap-2 rounded border border-border/50 bg-card/40 px-3 py-2 text-xs font-mono text-muted-foreground sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Cpu className="h-4 w-4 text-primary" />
              <span>WASM Powered</span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded border border-border/50 bg-card/40 px-3 py-2 text-xs font-mono text-muted-foreground sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Lock className="h-4 w-4 text-primary" />
              <span>Local by default</span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded border border-border/50 bg-card/40 px-3 py-2 text-xs font-mono text-muted-foreground sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Code2 className="h-4 w-4 text-primary" />
              <span>Full CLI Access</span>
            </div>
          </div>

          {contexts.length > 0 && (
            <div className="mt-6 rounded border border-border bg-card/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-mono text-muted-foreground">CONTEXTS:</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Click a name to resume
                </p>
              </div>
              <div className="space-y-2">
                {contexts.slice(0, 8).map((ctx) => {
                  const isOpening = openingContextId === ctx.id;
                  return (
                    <div
                      key={ctx.id}
                      className="flex w-full items-center gap-2 rounded border border-border/60 bg-background/40 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => void resumeContext(ctx)}
                        disabled={isOpening}
                        className="min-w-0 flex-1 text-left transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <div className="truncate text-xs font-mono text-foreground">{ctx.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
                          <span>{formatSize(ctx.fileSize)}</span>
                          <span>{formatHash(ctx.artifactHash)}</span>
                          <span>{ctx.job}</span>
                          <span>{new Date(ctx.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteContext(ctx.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                        title="Delete context"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {recentFiles.length > 0 && (
            <div className="mt-4 rounded border border-border bg-card/50 p-3">
              <p className="mb-2 text-[10px] font-mono text-muted-foreground">RECENT:</p>
              <div className="space-y-1">
                {recentFiles.slice(0, 3).map((recentFile) => (
                  <div key={`${recentFile.name}-${recentFile.loadedAt}`} className="flex justify-between text-xs font-mono">
                    <span className="max-w-[200px] truncate text-foreground">{recentFile.name}</span>
                    <span className="text-muted-foreground">{formatSize(recentFile.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center justify-center gap-4 text-[10px] font-mono text-muted-foreground">
          <span>
            by{' '}
            <a href="https://github.com/IndAlok" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              IndAlok
            </a>
          </span>
          <span className="text-border">|</span>
          <span>
            powered by{' '}
            <a href="https://rizin.re" target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              Rizin
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
