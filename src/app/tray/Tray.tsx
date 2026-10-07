/**
 * The utility tray: reference sheets and saved work, one key from any view.
 *
 * It is not a modal. The point of a cheat sheet is to read it *while* doing the
 * thing it is a cheat sheet for, so the view underneath stays live — clickable,
 * scrollable, and still the target of every shortcut.
 *
 * Two ways to sit, because neither is right everywhere. Floating covers the
 * right edge of the view and moves nothing, which is what a quick look wants.
 * Docked takes its width out of the view instead, which is what working beside
 * it wants and what a narrow window cannot afford. The choice is remembered.
 */

import { useEffect, useRef } from 'react'

import type { SaveIndex } from '../../domain/types.ts'
import { useUiStore, type TrayTab } from '../../store/uiStore.ts'
import { cn, tabId } from '../../lib/utils.ts'
import { Button, IconButton, SegmentBar } from '../../components/controls.tsx'
import { useEscape } from '../../components/drawer.ts'
import { PassiveSheet } from './PassiveSheet.tsx'
import { SavedPaths } from './SavedPaths.tsx'
import { TypeChart } from './TypeChart.tsx'

/** Ties the sheet tabs to the panel they drive, for `aria-controls`. */
const TRAY_TABS = 'tray'
const TRAY_PANEL = 'tray-panel'

const TABS: { id: TrayTab; label: string }[] = [
  { id: 'passives', label: 'passives' },
  { id: 'paths', label: 'paths' },
  { id: 'types', label: 'types' },
]

export function Tray({ index }: { index: SaveIndex }) {
  const tab = useUiStore((s) => s.trayTab)
  const pinned = useUiStore((s) => s.trayPinned)
  const setTray = useUiStore((s) => s.setTray)
  const close = () => setTray({ open: false })

  const ref = useRef<HTMLElement>(null)
  // Docked, the tray is part of the layout rather than something in the way,
  // and Escape closing it would be Escape rearranging the screen.
  useEscape(!pinned, close)

  // Focus goes to the sheet's search box when it has one — opening the tray is
  // nearly always the start of looking something up — and back to wherever it
  // came from on close. Mounted only while open, so mount is "opened" — except
  // for a docked tray restored with the page, which nobody just opened.
  useEffect(() => {
    if (!useUiStore.getState().trayOpenedHere) return
    const before = document.activeElement
    const el = ref.current
    const target = el?.querySelector<HTMLElement>('input') ?? el
    target?.focus({ preventScroll: true })
    return () => {
      if (before instanceof HTMLElement && before.isConnected) {
        before.focus({ preventScroll: true })
      }
    }
  }, [])

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="complementary"
      aria-label="Utility tray"
      className={cn(
        'flex w-[var(--tray-width)] shrink-0 flex-col border-l border-[var(--color-line-strong)] bg-[var(--color-panel-solid)] outline-none',
        !pinned &&
          'absolute inset-y-0 right-0 z-30 animate-[pw-tray-in_var(--dur-fast)_var(--ease-out)]',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-line)] p-2">
        <SegmentBar
          name={TRAY_TABS}
          panelId={TRAY_PANEL}
          value={tab}
          onChange={(id) => setTray({ tab: id as TrayTab })}
          tabs={TABS}
          className="min-w-0 flex-1"
        />
        <Button
          size="sm"
          aria-pressed={pinned}
          onClick={() => setTray({ pinned: !pinned })}
          title={
            pinned
              ? 'Float the tray over the view'
              : 'Dock the tray beside the view'
          }
        >
          {pinned ? 'Unpin' : 'Pin'}
        </Button>
        <IconButton label="Close" tone="ghost" size={24} onClick={close}>
          ×
        </IconButton>
      </div>

      <div
        id={TRAY_PANEL}
        role="tabpanel"
        aria-labelledby={tabId(TRAY_TABS, tab)}
        className="min-h-0 flex-1"
      >
        {tab === 'passives' && <PassiveSheet index={index} />}
        {tab === 'paths' && <SavedPaths index={index} />}
        {tab === 'types' && <TypeChart index={index} />}
      </div>
    </aside>
  )
}
