/**
 * The controls, named.
 *
 * Every one of these was written inline in a view before this file existed —
 * seven flavours of bordered button, four selects, three sliders, six close
 * crosses — which is why a colour change used to mean a hunt through five view
 * files. The design system names them, so this does too.
 *
 * Shared behaviour, decided once: hover raises the border to signal cyan and
 * never moves the element; press sinks it 1px and swaps the inset highlight for
 * an inset shadow; the filled selection blue (`--surface-select-fill`) is the
 * only filled state in the system; disabled is 40% opacity with no border
 * change. Radii are 0–3px and every number is monospaced.
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

import { KeyHint } from './primitives.tsx'
import { cn, tabId } from '../lib/utils.ts'

/* -------------------------------------------------------------------------
   Buttons
   ------------------------------------------------------------------------- */

export type ButtonTone = 'default' | 'signal' | 'primary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const TONES: Record<ButtonTone, string> = {
  default:
    'border-[var(--color-line-strong)] bg-[rgb(8_20_28/0.55)] text-[var(--color-text)]',
  signal:
    'border-[var(--color-signal)]/60 bg-[var(--color-signal)]/10 text-[var(--color-signal)]',
  primary:
    'border-[rgb(140_215_255/0.8)] bg-[image:var(--surface-select-fill)] text-white',
  danger:
    'border-[var(--color-danger)]/70 bg-[var(--color-danger)]/12 text-[#ffd9d6]',
  ghost: 'border-transparent text-[var(--color-muted)]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1.5 px-2 text-[11px]',
  md: 'h-[30px] gap-2 px-3.5 text-sm',
  lg: 'h-10 gap-2 px-5 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
  size?: ButtonSize
  /** Keycap printed after the label, as the game prints its prompts. */
  keyHint?: string
  icon?: ReactNode
}

export function Button({
  tone = 'default',
  size = 'md',
  keyHint,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cn(
        'raised-edge inline-flex shrink-0 items-center justify-center rounded-control border font-semibold tracking-[0.01em] transition-colors',
        'enabled:hover:border-[var(--color-signal)]',
        'enabled:active:translate-y-px enabled:active:bg-[var(--color-signal)]/15 enabled:active:shadow-[var(--edge-sunken)]',
        'disabled:cursor-not-allowed disabled:text-[var(--color-faint)] disabled:opacity-40',
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      {icon}
      {children}
      {keyHint !== undefined && <KeyHint>{keyHint}</KeyHint>}
    </button>
  )
}

/**
 * A square button holding one glyph.
 *
 * `label` is required and not optional-with-a-fallback: the app's close crosses
 * are a `×` character, which reads to a screen reader as "multiplication sign".
 */
export function IconButton({
  label,
  size = 30,
  className,
  style,
  children,
  ...rest
}: Omit<ButtonProps, 'size' | 'keyHint' | 'icon'> & {
  label: string
  size?: number
}) {
  return (
    <Button
      aria-label={label}
      title={label}
      className={cn('px-0', className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </Button>
  )
}

/* -------------------------------------------------------------------------
   Tabs
   ------------------------------------------------------------------------- */

export interface TabDef {
  id: string
  label: string
  /** Small monospaced count or keycap shown after the label. */
  hint?: string | number
}

/**
 * Arrow-key movement for a tab strip, with **manual activation**: the arrows
 * move focus and only Enter, Space or a click changes the selection.
 *
 * That is the deliberate choice, not the lazy one. Every view in this app is a
 * separate lazily-loaded chunk and one of them starts Pixi, so automatic
 * activation would mount the map on the way past it.
 */
function useTabKeys(count: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = count - 1
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = i === last ? 0 : i + 1
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = i === 0 ? last : i - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    e.preventDefault()
    refs.current[next]?.focus()
  }

  return { refs, onKeyDown }
}

interface TabStripProps {
  /** Prefixes the generated tab ids; must be unique on the page. */
  name: string
  tabs: TabDef[]
  value: string
  onChange: (id: string) => void
  /** Element id of the panel these tabs drive, for `aria-controls`. */
  panelId?: string
  className?: string
}

/**
 * The in-game tab strip: parallelograms sheared 14°, the active one filled with
 * selection blue.
 */
export function TabBar({
  name,
  tabs,
  value,
  onChange,
  panelId,
  className,
}: TabStripProps) {
  const { refs, onKeyDown } = useTabKeys(tabs.length)
  const shear = 14

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn('flex h-[var(--tab-height)] gap-0.5', className)}
    >
      {tabs.map((tab, i) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={tabId(name, tab.id)}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              clipPath: `polygon(${shear}px 0, 100% 0, calc(100% - ${shear}px) 100%, 0 100%)`,
            }}
            className={cn(
              'relative inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 px-5 text-base transition-colors',
              active
                ? 'bg-[image:var(--surface-select-fill)] text-white'
                : 'bg-[rgb(7_17_25/0.72)] text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {tab.label}
            {tab.hint !== undefined && (
              <span className="num text-[11px] opacity-75">{tab.hint}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The squared-off toggle pair used inside a panel, where a sheared tab would
 * look like the screen's own navigation.
 */
export function SegmentBar({
  name,
  tabs,
  value,
  onChange,
  panelId,
  className,
}: TabStripProps) {
  const { refs, onKeyDown } = useTabKeys(tabs.length)

  return (
    <div role="tablist" className={cn('flex gap-0.5', className)}>
      {tabs.map((tab, i) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={tabId(name, tab.id)}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'h-[30px] flex-1 px-3 text-sm transition-colors',
              active
                ? 'bg-[var(--color-muted)] text-[var(--color-inverse)]'
                : 'bg-[var(--color-raised)]/50 text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Rows
   ------------------------------------------------------------------------- */

/**
 * The full-width menu entry from the game's own menus. Selected is the filled
 * blue with cyan corner ticks — the one strong selection treatment in the
 * system.
 */
export function MenuButton({
  selected,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      {...rest}
      className={cn(
        'relative isolate block w-full rounded-control border px-5 py-3 text-left transition-colors',
        selected
          ? 'corner-ticks border-[rgb(150_225_255/0.85)] bg-[image:var(--surface-select-fill)] text-white shadow-[var(--glow-select)] [--tick-color:var(--color-signal)] [--tick-size:12px]'
          : 'raised-edge border-[var(--color-line)] bg-[rgb(6_16_23/0.62)] text-[var(--color-text)] hover:bg-[var(--color-signal)]/[0.08]',
        'disabled:cursor-not-allowed disabled:text-[var(--color-faint)] disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * A row in a list panel — a server browser row, a player, a structure.
 *
 * Renders a real `<button>` when it is clickable rather than the design
 * system's `<div role="button">`, which is not reachable by keyboard.
 */
export function ListRow({
  selected,
  onClick,
  title,
  className,
  children,
}: {
  selected?: boolean
  onClick?: () => void
  title?: string
  className?: string
  children?: ReactNode
}) {
  const shared = cn(
    'flex min-h-[var(--row-height)] w-full items-center gap-3 border-t border-[var(--color-line-faint)] px-3 text-left text-sm transition-colors',
    selected
      ? 'bg-[image:var(--surface-row-selected)] text-white'
      : 'text-[var(--color-text)]',
    className,
  )

  if (!onClick) {
    return (
      <div title={title} className={shared}>
        {children}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        shared,
        !selected && 'hover:bg-[var(--color-signal)]/[0.08]',
      )}
    >
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------
   Form controls
   ------------------------------------------------------------------------- */

export interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value: string
  onChange: (value: string) => void
  /** Uppercase micro label above the field. */
  label?: string
  /** Trailing adornment inside the field — a keycap, a unit, a count. */
  suffix?: ReactNode
  className?: string
}

/** The sunken text field: dark well, hairline edge, cyan edge on focus. */
export function TextInput({
  value,
  onChange,
  label,
  suffix,
  className,
  ...rest
}: TextInputProps) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="label mb-1.5 block">{label}</span>}
      <span className="flex h-8 items-center gap-2 rounded-control border border-[var(--color-line-strong)] bg-[rgb(3_9_13/0.75)] px-3 shadow-[var(--edge-sunken)] transition-colors focus-within:border-[var(--color-signal)]">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)]"
        />
        {suffix}
      </span>
    </label>
  )
}

/**
 * The game's checkbox: a small square that fills with selection blue.
 *
 * A real `<input>`, visually hidden and driving the box through `peer-*`, rather
 * than the `appearance-none` styling this replaced — the tick is a `✓`
 * character, and pseudo-elements on a replaced element are not something to bet
 * a checkbox on.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-3 text-sm',
        disabled && 'cursor-not-allowed text-[var(--color-faint)]',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-control border border-[var(--color-line-strong)] bg-[rgb(3_9_13/0.75)] text-xs text-white shadow-[var(--edge-sunken)] transition-colors',
          'peer-checked:border-[rgb(150_225_255/0.8)] peer-checked:bg-[image:var(--surface-select-fill)] peer-checked:shadow-none',
          'peer-focus-visible:outline peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-signal)]',
        )}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </label>
  )
}

/** A native select dressed as a game control, caret and all. */
export function SelectControl({
  value,
  onChange,
  options,
  label,
  className,
  ...rest
}: {
  value: string
  onChange: (value: string) => void
  options: (string | { value: string; label: string })[]
  label?: string
  className?: string
} & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value' | 'children'
>) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="label mb-1.5 block">{label}</span>}
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
          className="h-8 w-full appearance-none rounded-control border border-[var(--color-line-strong)] bg-[rgb(3_9_13/0.75)] pr-7 pl-3 text-sm transition-colors outline-none focus:border-[var(--color-signal)]"
        >
          {options.map((o) => {
            const v = typeof o === 'string' ? o : o.value
            const l = typeof o === 'string' ? o : o.label
            return (
              <option key={v} value={v}>
                {l}
              </option>
            )
          })}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-[var(--color-muted)]"
        >
          ▾
        </span>
      </span>
    </label>
  )
}

/** A labelled slider with its value printed in the monospaced voice. */
export function RangeControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        <span className="num text-xs">{value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-signal)]"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------
   Overlay
   ------------------------------------------------------------------------- */

/**
 * The game's modal: everything behind it darkens and blurs, the dialog is a
 * near-black rectangle with corner ticks, and the close cross floats outside
 * the frame rather than sitting inside it.
 *
 * Built on `<dialog>` rather than a positioned `<div>` as the design system
 * does. A modal needs three things to be correct — Escape closes it, a backdrop
 * click closes it, and focus does not escape behind it — and the platform gives
 * all three, including top-layer stacking that otherwise costs a portal and a
 * z-index argument. The entrance animation is in index.css, on `dialog[open]`,
 * because it has to fire when the element is shown rather than when it mounts.
 */
/**
 * `overflow-visible` is load-bearing: the UA stylesheet sets
 * `dialog { overflow: auto }`, which silently clips the close cross floating
 * above the frame. Scrolling belongs to the body div in any case.
 */
const SHELL =
  'corner-ticks relative isolate m-auto max-w-[92vw] overflow-visible border border-[var(--color-line)] bg-[rgb(4_10_15/0.94)] p-0 text-[var(--color-text)] shadow-modal [--tick-inset:4px] [--tick-size:14px] backdrop:bg-[var(--color-scrim)] backdrop:backdrop-blur-scrim'

export function Modal({
  open,
  onClose,
  title,
  footer,
  width = 720,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Centred single-line prompt above the body. */
  title?: string
  footer?: ReactNode
  width?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // `showModal` is what puts the element in the top layer and traps focus;
    // toggling the `open` attribute directly does neither.
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // The backdrop is part of the dialog element, so a click landing on the
        // element itself rather than its contents is a backdrop click.
        if (e.target === ref.current) onClose()
      }}
      style={{ width }}
      className={SHELL}
    >
      <IconButton
        label="Close"
        tone="danger"
        onClick={onClose}
        className="absolute -top-11 right-0 text-base"
      >
        ✕
      </IconButton>

      <div className="max-h-[70vh] overflow-y-auto px-10 pt-9 pb-7">
        {title && (
          <h2 className="mb-5 text-center text-base text-[var(--color-text)]">
            {title}
          </h2>
        )}
        {children}
      </div>

      {footer && (
        <div className="flex justify-center gap-4 border-t border-[var(--color-line-faint)] px-10 pt-4 pb-6">
          {footer}
        </div>
      )}
    </dialog>
  )
}
