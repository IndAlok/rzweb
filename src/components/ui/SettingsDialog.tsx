import { Dialog, DialogContent, DialogHeader, DialogTitle, Tabs, TabsList, TabsTrigger, TabsContent, ScrollArea, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { useUIStore, useSettingsStore } from '@/stores';
import { useTheme } from '@/providers';
import { Settings, Monitor, Terminal, Database, Sliders, Moon, Sun, Laptop, Trash2 } from 'lucide-react';
import { clearAnalysisCache, getCacheStats, type CacheStats } from '@/lib/rizin';
import { useState, useEffect } from 'react';

const ANALYSIS_LEVELS = [
  { value: 'aa', label: 'Basic (aa)', description: 'Fast analysis, basic function detection' },
  { value: 'aaa', label: 'Full (aaa)', description: 'Recommended - full analysis with xrefs' },
  { value: 'aaaa', label: 'Deep (aaaa)', description: 'Experimental - recursive analysis' },
];

export function SettingsDialog() {
  const { settingsDialogOpen, setSettingsDialogOpen } = useUIStore();
  const { 
    terminalFontSize, setTerminalFontSize, 
    terminalScrollback, setTerminalScrollback,
    ioCache, setIoCache,
    analysisDepth, setAnalysisDepth,
    noAnalysis, setNoAnalysis,
    showLineNumbers, setShowLineNumbers
  } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  useEffect(() => {
    if (settingsDialogOpen) {
      getCacheStats().then(setCacheStats);
    }
  }, [settingsDialogOpen]);

  return (
    <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          <Tabs defaultValue="general" orientation="vertical" className="flex w-full h-full">
            <TabsList className="w-48 h-full flex flex-col items-stretch justify-start bg-muted/30 p-2 rounded-none border-r border-border shrink-0">
              <TabsTrigger value="general" className="justify-start gap-2 h-9">
                <Monitor className="h-4 w-4" /> General
              </TabsTrigger>
              <TabsTrigger value="terminal" className="justify-start gap-2 h-9">
                <Terminal className="h-4 w-4" /> Terminal
              </TabsTrigger>
              <TabsTrigger value="analysis" className="justify-start gap-2 h-9">
                <Sliders className="h-4 w-4" /> Analysis
              </TabsTrigger>
              <TabsTrigger value="io" className="justify-start gap-2 h-9">
                <Database className="h-4 w-4" /> I/O & Storage
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-6 space-y-6">
                  <TabsContent value="general" className="m-0 space-y-4">
                    <section>
                      <h4 className="text-sm font-semibold mb-3">Theme</h4>
                      <div className="flex gap-2">
                        <Button
                          variant={theme === 'light' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('light')}
                          className="flex-1"
                        >
                          <Sun className="h-4 w-4 mr-2" /> Light
                        </Button>
                        <Button
                          variant={theme === 'dark' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('dark')}
                          className="flex-1"
                        >
                          <Moon className="h-4 w-4 mr-2" /> Dark
                        </Button>
                        <Button
                          variant={theme === 'system' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTheme('system')}
                          className="flex-1"
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
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <label className="text-sm font-medium">Analysis Cache</label>
                            <p className="text-[10px] text-muted-foreground">
                              {cacheStats ? `${cacheStats.entryCount} cached ${cacheStats.entryCount === 1 ? 'binary' : 'binaries'} (${(cacheStats.totalBytes / 1024 / 1024).toFixed(1)} MB)` : 'Loading...'}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            onClick={async () => {
                              await clearAnalysisCache();
                              setCacheStats({ entryCount: 0, totalBytes: 0, entries: [] });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Clear
                          </Button>
                        </div>
                      </div>
                    </section>
                  </TabsContent>
                </div>
              </ScrollArea>
            </div>
          </Tabs>
        </div>

        <div className="p-4 border-t border-border flex justify-end shrink-0 bg-muted/30">
          <Button onClick={() => setSettingsDialogOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
