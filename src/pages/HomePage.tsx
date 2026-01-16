import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFileStore, useSettingsStore } from '@/stores';
import { Button } from '@/components/ui';
import { FileDropZone } from '@/components/file';
import { formatSize } from '@/lib/utils/format';
import { getRizinVersion } from '@/lib/utils/version';
import { Github, Moon, Sun, Terminal, Cpu, Lock, Code2 } from 'lucide-react';
import { useTheme } from '@/providers';

export default function HomePage() {
  const navigate = useNavigate();
  const { setCurrentFile, recentFiles } = useFileStore();
  const { cacheVersions, setCacheVersions } = useSettingsStore();
  const { setTheme, resolvedTheme } = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rizinVersion, setRizinVersion] = useState('0.8.1');

  useEffect(() => {
    getRizinVersion().then(setRizinVersion);
  }, []);

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
  }, []);

  const handleOpenRizin = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      setCurrentFile({
        id: crypto.randomUUID(),
        name: file.name,
        data: new Uint8Array(arrayBuffer),
        size: file.size,
        loadedAt: Date.now(),
      });
      navigate(`/analyze?cache=${cacheVersions}`);
    } catch {
      // File processing error
    } finally {
      setIsProcessing(false);
    }
  }, [file, cacheVersions, setCurrentFile, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 items-center justify-between border-b border-border px-6 bg-card">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-primary" />
          <span className="font-mono font-bold text-primary">RzWeb</span>
          <span className="text-[10px] text-muted-foreground font-mono">v{rizinVersion}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
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

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <pre className="text-primary font-mono text-xs leading-tight inline-block">
{`  ____       __        __   _     
 |  _ \\ ____\\ \\      / /__| |__  
 | |_) |_  / \\ \\ /\\ / / _ \\ '_ \\ 
 |  _ < / /   \\ V  V /  __/ |_) |
 |_| \\_\\___|   \\_/\\_/ \\___|_.__/ `}
            </pre>
            <p className="mt-4 text-foreground/80 font-mono text-sm">
              Browser-Based Reverse Engineering
            </p>
            <p className="mt-2 text-muted-foreground font-mono text-xs max-w-md mx-auto">
              Analyze binaries directly in your browser. No uploads, no servers. 
              Powered by Rizin compiled to WebAssembly.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <FileDropZone
              onFileSelect={handleFileSelect}
              selectedFile={file}
              onClear={() => setFile(null)}
            />

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-muted-foreground font-mono cursor-pointer">
                <input
                  type="checkbox"
                  checked={cacheVersions}
                  onChange={(e) => setCacheVersions(e.target.checked)}
                  className="rounded border-border h-3 w-3"
                />
                Cache offline
              </label>
              <Button
                onClick={handleOpenRizin}
                disabled={!file || isProcessing}
                loading={isProcessing}
              >
                Analyze →
              </Button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
              <Cpu className="h-4 w-4 text-primary" />
              <span>WASM Powered</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
              <Lock className="h-4 w-4 text-primary" />
              <span>100% Private</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
              <Code2 className="h-4 w-4 text-primary" />
              <span>Full CLI Access</span>
            </div>
          </div>

          {recentFiles.length > 0 && (
            <div className="mt-6 border border-border rounded bg-card/50 p-3">
              <p className="text-[10px] text-muted-foreground font-mono mb-2">RECENT:</p>
              <div className="space-y-1">
                {recentFiles.slice(0, 3).map((rf) => (
                  <div key={rf.name} className="flex justify-between text-xs font-mono">
                    <span className="text-foreground truncate max-w-[200px]">{rf.name}</span>
                    <span className="text-muted-foreground">{formatSize(rf.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border py-3 px-6 bg-card">
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground font-mono">
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
