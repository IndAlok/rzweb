import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useFileStore, useSettingsStore } from '@/stores';
import { Button } from '@/components/ui';
import { FileDropZone } from '@/components/file';
import { formatSize } from '@/lib/utils/format';
import { getRizinVersion } from '@/lib/utils/version';
import { getCachedAnalysisEntry, listCachedAnalyses, decodeProjectBundle, type CachedAnalysisSummary } from '@/lib/rizin';
import { Github, Moon, Sun, Terminal, Cpu, Lock, Code2, FolderOpen } from 'lucide-react';
import { useTheme } from '@/providers';

export default function HomePage() {
  const navigate = useNavigate();
  const { setCurrentFile, recentFiles } = useFileStore();
  const { cacheVersions, setCacheVersions } = useSettingsStore();
  const { setTheme, resolvedTheme } = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [openingCachedHash, setOpeningCachedHash] = useState<string | null>(null);
  const [rizinVersion, setRizinVersion] = useState('...');
  const [cachedEntries, setCachedEntries] = useState<CachedAnalysisSummary[]>([]);
  const projectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getRizinVersion().then(setRizinVersion);
    listCachedAnalyses().then(setCachedEntries);
  }, []);

  const handleFileSelect = useCallback((nextFile: File) => {
    setFile(nextFile);
  }, []);

  const launchBinary = useCallback((params: {
    name: string;
    data: Uint8Array;
    size: number;
    useCache: boolean;
    projectData?: Uint8Array;
  }) => {
    setCurrentFile({
      id: crypto.randomUUID(),
      name: params.name,
      data: params.data,
      size: params.size,
      loadedAt: Date.now(),
      projectData: params.projectData,
    });
    navigate(`/analyze?cache=${params.useCache}`);
  }, [navigate, setCurrentFile]);

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
        toast.error('A raw Rizin project needs its binary: open the binary first, then load the project from the workspace.');
        return;
      }
      launchBinary({
        name: bundle.name,
        data: bundle.binary,
        size: bundle.binary.byteLength,
        useCache: cacheVersions,
        projectData: bundle.rzdb,
      });
    } catch {
      toast.error('Unable to open the selected project file.');
    }
  }, [cacheVersions, launchBinary]);

  const handleOpenRizin = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      launchBinary({
        name: file.name,
        data: new Uint8Array(arrayBuffer),
        size: file.size,
        useCache: cacheVersions,
      });
    } catch {
      toast.error('Unable to open the selected binary.');
    } finally {
      setIsProcessing(false);
    }
  }, [cacheVersions, file, launchBinary]);

  const handleOpenCachedBinary = useCallback(async (hash: string) => {
    setOpeningCachedHash(hash);
    try {
      const cached = await getCachedAnalysisEntry(hash);
      if (!cached) {
        toast.error('That cached analysis is no longer available.');
        setCachedEntries(await listCachedAnalyses());
        return;
      }

      if (!(cached.binaryData instanceof Uint8Array) || cached.binaryData.byteLength === 0) {
        toast.error('This cache entry stores metadata only. Re-analyze the binary to reopen it directly from Home.');
        return;
      }

      launchBinary({
        name: cached.fileName,
        data: new Uint8Array(cached.binaryData),
        size: cached.fileSize,
        useCache: true,
      });
    } catch {
      toast.error('Unable to reopen the cached binary right now.');
    } finally {
      setOpeningCachedHash(null);
    }
  }, [launchBinary]);

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
              Analyze binaries directly in your browser. No uploads, no servers.
              Powered by Rizin compiled to WebAssembly.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <FileDropZone
              onFileSelect={handleFileSelect}
              selectedFile={file}
              onClear={() => setFile(null)}
            />

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
                  accept=".rzdb,application/octet-stream"
                  className="hidden"
                  onChange={handleProjectFileSelected}
                />
                <Button variant="outline" onClick={handleOpenProjectClick} title="Open a saved RzWeb project (.rzdb)">
                  <FolderOpen className="mr-1.5 h-4 w-4" />
                  Open Project
                </Button>
                <Button
                  onClick={handleOpenRizin}
                  disabled={!file || isProcessing}
                  loading={isProcessing}
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
              <span>100% Private</span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded border border-border/50 bg-card/40 px-3 py-2 text-xs font-mono text-muted-foreground sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Code2 className="h-4 w-4 text-primary" />
              <span>Full CLI Access</span>
            </div>
          </div>

          {cachedEntries.length > 0 && (
            <div className="mt-6 rounded border border-border bg-card/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-mono text-muted-foreground">OFFLINE CACHE:</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Click a cached filename to reopen instantly
                </p>
              </div>
              <div className="space-y-2">
                {cachedEntries.slice(0, 5).map((entry) => {
                  const isOpening = openingCachedHash === entry.hash;
                  return (
                    <button
                      key={entry.hash}
                      type="button"
                      onClick={() => void handleOpenCachedBinary(entry.hash)}
                      disabled={!entry.hasBinaryData || isOpening}
                      className="flex w-full items-center justify-between gap-3 rounded border border-border/60 bg-background/40 px-3 py-2 text-left transition hover:border-primary/40 hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-mono text-foreground">{entry.fileName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
                          <span>{formatSize(entry.fileSize)}</span>
                          <span>{formatHash(entry.hash)}</span>
                          <span>{entry.hasBinaryData ? 'launchable' : 'metadata only'}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-[10px] font-mono text-primary">
                        {isOpening ? 'Opening...' : entry.hasBinaryData ? 'Open' : 'Rebuild'}
                      </div>
                    </button>
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
