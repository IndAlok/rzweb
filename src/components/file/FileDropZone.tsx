import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatSize } from '@/lib/utils/format';
import { Upload, FileCode2, X } from 'lucide-react';

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear?: () => void;
  accept?: string;
  maxSize?: number;
  className?: string;
}

export function FileDropZone({
  onFileSelect,
  selectedFile,
  onClear,
  accept = '*',
  maxSize = 100 * 1024 * 1024,
  className,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (file.size > maxSize) {
        setError(`File too large. Maximum size is ${formatSize(maxSize)}`);
        return;
      }

      onFileSelect(file);
    },
    [maxSize, onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      e.target.value = '';
    },
    [handleFile]
  );

  return (
    <div className={cn('space-y-4', className)}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-all duration-200',
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : 'border-border hover:border-muted-foreground hover:bg-muted/50'
        )}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="File upload"
        />

        <Upload
          className={cn(
            'mb-4 h-12 w-12 transition-colors',
            isDragging ? 'text-primary' : 'text-muted-foreground'
          )}
        />

        <p className="mb-2 text-center text-muted-foreground">
          <span className="font-medium text-foreground">Click to upload</span>
          {' '}or drag and drop
        </p>
        <p className="text-sm text-muted-foreground/60">
          Binary files up to {formatSize(maxSize)}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {selectedFile && (
        <div className="flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <FileCode2 className="h-8 w-8 text-primary" />
            <div>
              <p className="font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatSize(selectedFile.size)}
              </p>
            </div>
          </div>
          {onClear && (
            <button
              onClick={onClear}
              className="rounded-full p-1 hover:bg-muted"
              aria-label="Clear file"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
