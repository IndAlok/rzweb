import { Button } from '@/components/ui';

export function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-destructive">
          Something went wrong
        </h1>
        <pre className="overflow-auto rounded bg-card p-4 text-left text-sm text-muted-foreground max-h-48">
          {error.message}
        </pre>
        <div className="flex gap-2 justify-center">
          <Button onClick={resetErrorBoundary}>
            Try again
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
