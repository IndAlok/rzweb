import { Dialog, DialogContent, DialogHeader, DialogTitle, Tabs, TabsList, TabsTrigger, TabsContent, ScrollArea, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { useFileStore, useUIStore, useSettingsStore } from '@/stores';
import { useTheme } from '@/providers';
import { Settings, Monitor, Terminal, Database, Sliders, Moon, Sun, Laptop, Trash2 } from 'lucide-react';
import { clearAnalysisCache, computeFileHash, getCacheStats, removeCachedAnalysis, type CacheStats } from '@/lib/rizin';
import { useState, useEffect } from 'react';

const ANALYSIS_LEVELS = [
  { value: 'aa', label: 'Basic (aa)', description: 'Fast analysis, basic function detection' },
  { value: 'aaa', label: 'Full (aaa)', description: 'Recommended - full analysis with xrefs' },
  { value: 'aaaa', label: 'Deep (aaaa)', description: 'Experimental - recursive analysis' },
];

export function SettingsDialog() {
  const { settingsDialogOpen, setSettingsDialogOpen } = useUIStore();
  const { currentFile } = useFileStore();
  const { 
    terminalFontSize, setTerminalFontSize, 
    terminalScrollback, setTerminalScrollback,
    terminalAutocompleteMinChars, setTerminalAutocompleteMinChars,
    terminalAutocompleteMaxResults, setTerminalAutocompleteMaxResults,
    ioCache, setIoCache,
    analysisDepth, setAnalysisDepth,
    maxOutputSizeMb, setMaxOutputSizeMb,
    noAnalysis, setNoAnalysis,
    showLineNumbers, setShowLineNumbers
  } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCurrentCache, setClearingCurrentCache] = useState(false);

  useEffect(() => {
    if (settingsDialogOpen) {
      getCacheStats().then(setCacheStats);
    }
  }, [settingsDialogOpen]);

  return (
    <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
      <DialogContent className="flex h-[min(92vh,640px)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border p-4 sm:p-6">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          <Tabs defaultValue="general" className="flex h-full w-full flex-col md:flex-row">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-muted/30 p-2 md:h-full md:w-52 md:flex-col md:items-stretch md:justify-start md:overflow-visible md:border-b-0 md:border-r md:p-2">
              <TabsTrigger value="general" className="h-9 shrink-0 justify-start gap-2">
                <Monitor className="h-4 w-4" /> General
              </TabsTrigger>
              <TabsTrigger value="terminal" className="h-9 shrink-0 justify-start gap-2">
                <Terminal className="h-4 w-4" /> Terminal
              </TabsTrigger>
              <TabsTrigger value="analysis" className="h-9 shrink-0 justify-start gap-2">
                <Sliders className="h-4 w-4" /> Analysis
              </TabsTrigger>
              <TabsTrigger value="io" className="h-9 shrink-0 justify-start gap-2">
                <Database className="h-4 w-4" /> I/O & Storage
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-6 p-4 sm:p-6">
                  <TabsContent value="general" className="m-0 space-y-4">
                    <section>
                      <h4 className="text-sm font-semibold mb-3">Theme</h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Button
                          variant={theme === 'light' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('light')}
                          className="w-full"
                        >
                          <Sun className="h-4 w-4 mr-2" /> Light
                        </Button>
                        <Button
                          variant={theme === 'dark' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('dark')}
                          className="w-full"
                        >
                          <Moon className="h-4 w-4 mr-2" /> Dark
                        </Button>
                        <Button
                          variant={theme === 'system' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('system')}
                          className="w-full"
                        >
                          <Laptop className="h-4 w-4 mr-2" /> System
                        </Button>
                      </div>
                    </section>
                  </TabsContent>

                  <TabsContent value="terminal" className="m-0 space-y-4">
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Font Size</label>
                        <Select value={terminalFontSize.toString()} onValueChange={(v) => setTerminalFontSize(parseInt(v))}>
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[10, 11, 12, 14, 16, 18].map(s => (
                              <SelectItem key={s} value={s.toString()}>{s}px</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Scrollback Lines</label>
                        <Select value={terminalScrollback.toString()} onValueChange={(v) => setTerminalScrollback(parseInt(v))}>
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1000, 5000, 10000, 50000].map(s => (
                              <SelectItem key={s} value={s.toString()}>{s.toLocaleString()}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">Autocomplete Min Chars</label>
                          <p className="text-[10px] text-muted-foreground">
                            Live suggestions appear after this many typed characters. Tab can still request completion earlier.
                          </p>
                        </div>
                        <Select value={terminalAutocompleteMinChars.toString()} onValueChange={(v) => setTerminalAutocompleteMinChars(parseInt(v))}>
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 8, 10].map(value => (
                              <SelectItem key={value} value={value.toString()}>{value}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">Max Results Returned</label>
                          <p className="text-[10px] text-muted-foreground">
                            Caps the terminal autocomplete list. Fewer matches may appear when fewer commands match what you typed.
                          </p>
                        </div>
                        <Select value={terminalAutocompleteMaxResults.toString()} onValueChange={(v) => setTerminalAutocompleteMaxResults(parseInt(v))}>
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[5, 8, 12, 16, 20, 30, 50, 100].map(value => (
                              <SelectItem key={value} value={value.toString()}>{value}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </section>
                  </TabsContent>

                  <TabsContent value="analysis" className="m-0 space-y-4">
                    <section className="space-y-4">
                      <div>
                        <label className="text-sm font-medium block mb-2">Analysis Level</label>
                        <Select value={analysisDepth.toString()} onValueChange={(v) => setAnalysisDepth(parseInt(v))}>
                          <SelectTrigger className="w-full h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ANALYSIS_LEVELS.map((level, i) => (
                              <SelectItem key={level.value} value={(i + 1).toString()}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{level.label}</span>
                                  <span className="text-xs text-muted-foreground">{level.description}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-2">
                          Analysis runs when opening a binary. Higher levels take longer but detect more functions.
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-2">Max Command Output</label>
                        <Select value={maxOutputSizeMb.toString()} onValueChange={(v) => setMaxOutputSizeMb(parseInt(v))}>
                          <SelectTrigger className="w-full h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[4, 8, 16, 32, 64].map(size => (
                              <SelectItem key={size} value={size.toString()}>
                                {size} MB
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-2">
                          Larger values keep more output for huge binaries and long listings, but use more browser memory.
                        </p>
                      </div>
                    </section>
                  </TabsContent>

                  <TabsContent value="io" className="m-0 space-y-4">
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">Enable I/O Cache</label>
                          <p className="text-[10px] text-muted-foreground">
                            Caches file reads in memory for faster repeated access.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={ioCache} 
                          onChange={(e) => setIoCache(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">Skip Auto-Analysis</label>
                          <p className="text-[10px] text-muted-foreground">
                            Open binaries without running analysis. Use for quick inspection.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={noAnalysis} 
                          onChange={(e) => setNoAnalysis(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">Show Line Numbers</label>
                          <p className="text-[10px] text-muted-foreground">
                            Display address column in disassembly view.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={showLineNumbers} 
                          onChange={(e) => setShowLineNumbers(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                      </div>
                      <div className="border-t border-border pt-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-0.5">
                            <label className="text-sm font-medium">Analysis Cache</label>
                            <p className="text-[10px] text-muted-foreground">
                              {cacheStats ? `${cacheStats.entryCount} cached ${cacheStats.entryCount === 1 ? 'binary' : 'binaries'} (${(cacheStats.totalBytes / 1024 / 1024).toFixed(1)} MB)` : 'Loading...'}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            {currentFile && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={clearingCurrentCache}
                                onClick={async () => {
                                  setClearingCurrentCache(true);
                                  try {
                                    const hash = await computeFileHash(currentFile.data);
                                    await removeCachedAnalysis(hash);
                                    setCacheStats(await getCacheStats());
                                  } finally {
                                    setClearingCurrentCache(false);
                                  }
                                }}
                              >
                                Clear Current Binary
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              onClick={async () => {
                                await clearAnalysisCache();
                                setCacheStats({ entryCount: 0, totalBytes: 0, entries: [] });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Clear All
                            </Button>
                          </div>
                        </div>
                      </div>
                    </section>
                  </TabsContent>
                </div>
              </ScrollArea>
            </div>
          </Tabs>
        </div>

        <div className="shrink-0 border-t border-border bg-muted/30 p-4 flex justify-end">
          <Button onClick={() => setSettingsDialogOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
