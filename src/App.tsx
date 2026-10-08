import { Suspense, lazy } from 'react'

import { DropZone } from './app/DropZone.tsx'
import { ErrorBoundary } from './app/ErrorBoundary.tsx'
import { useSaveStore } from './store/saveStore.ts'
import { bytes } from './lib/format.ts'
import { Button } from './components/controls.tsx'

/**
 * Lazy so the empty state does not pay for the shell.
 *
 * The shell pulls in the command palette (cmdk), both dialogs and the
 * diagnostics popover — around 90 KB that is useless until a save exists.
 * Someone who lands on the page and never drops a file should download the
 * drop zone and nothing else.
 */
const AppShell = lazy(() =>
  import('./app/AppShell.tsx').then((m) => ({ default: m.AppShell })),
)

export function App() {
  const {
    status,
    index,
    progressLabel,
    progress,
    error,
    fileName,
    fileBytes,
    reset,
    cancelLoad,
  } = useSaveStore()

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="font-display text-xl font-[200] tracking-[0.08em] uppercase">
          {fileName}
        </div>
        <div className="label" role="status" aria-live="polite">
          {progressLabel ?? 'Working'}
          {fileBytes ? ` · ${bytes(fileBytes)}` : ''}
        </div>
        {progress !== undefined ? (
          <div
            role="progressbar"
            aria-label="Reading the save"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-0.5 w-64 overflow-hidden bg-[var(--color-line)] shadow-[var(--edge-sunken)]"
          >
            <div
              className="h-full bg-[var(--color-signal)]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        ) : (
          // No measure, so a pulse says only "still going". With motion
          // reduced a pulse that does not move is a bar stuck at a third, so
          // the phase text above is left to say it alone.
          <div
            aria-hidden
            className="h-0.5 w-64 overflow-hidden bg-[var(--color-line)] shadow-[var(--edge-sunken)] motion-reduce:invisible"
          >
            <div className="h-full w-1/3 animate-pulse-dot bg-[var(--color-signal)]" />
          </div>
        )}
        {/* A big world on a slow machine is a long wait, and the wrong file is
            a wait for nothing. */}
        <Button size="sm" tone="ghost" onClick={cancelLoad}>
          Cancel
        </Button>
      </main>
    )
  }

  if (status === 'restoring') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="font-display text-xl font-[200] tracking-[0.08em] uppercase">
          {fileName}
        </div>
        <div className="label" role="status" aria-live="polite">
          Restoring the save kept in this browser
          {fileBytes ? ` · ${bytes(fileBytes)}` : ''}
        </div>
        {/* A way out, because this waits on the browser's storage and nothing
            here can make that answer. */}
        <Button size="sm" tone="ghost" onClick={reset}>
          Open a different save
        </Button>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
        <div className="label">could not read that file</div>
        <p
          className="max-w-xl text-center text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
        <Button onClick={reset}>Try another file</Button>
      </main>
    )
  }

  if (status === 'ready' && index) {
    return (
      // The per-view boundaries inside the shell catch most things; this one
      // catches the shell itself, so even a broken header degrades to a
      // message and a reload rather than to nothing at all.
      <ErrorBoundary what="the viewer">
        <Suspense
          fallback={
            <div className="label flex min-h-dvh items-center justify-center">
              opening
            </div>
          }
        >
          <AppShell index={index} />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return <DropZone />
}
