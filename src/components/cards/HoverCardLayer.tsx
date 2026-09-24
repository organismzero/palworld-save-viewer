import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
  type VirtualElement,
} from '@floating-ui/react-dom'

import type { SaveIndex } from '../../domain/types.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { describeCard } from './describe.ts'
import {
  DESCRIPTION_ID,
  hideHoverCard,
  installHoverCards,
  useHoverCardStore,
  type CardDescriptor,
} from './hoverCard.ts'
import { PalCard } from './PalCard.tsx'
import { BaseCard, StructureCard } from './BaseCards.tsx'
import { ElementCard } from './ElementCard.tsx'
import { ItemCard } from './ItemCard.tsx'
import { SkillCard } from './SkillCard.tsx'
import { WorkCard } from './WorkCard.tsx'
import { PassiveCard } from './PassiveCard.tsx'
import { PlayerCard } from './PlayerCard.tsx'
import { SpeciesCard } from './SpeciesCard.tsx'

const HAS_POPOVER =
  typeof HTMLElement !== 'undefined' &&
  typeof HTMLElement.prototype.showPopover === 'function'

/**
 * The one hover card on screen, mounted once by the shell.
 *
 * It is a manual popover, shown into the top layer on each open. That is what
 * stops a scrolling container's `overflow` from clipping it and a Panel's
 * `backdrop-filter` from trapping its fixed position, and — because the top
 * layer stacks in the order things were shown — what keeps it above an open
 * `<dialog>` and the command palette. A browser without popovers gets a fixed
 * element at the top of the stacking order, which covers everything but a
 * modal dialog.
 *
 * `pointer-events: none` throughout: a card is a read-out, never a place to
 * click, so it can overlap the neighbouring cells without taking their hover.
 */
export function HoverCardLayer({ index }: { index: SaveIndex }) {
  const { open, desc, anchor, pointerX } = useHoverCardStore()
  const data = useRefdataStore((s) => s.data)
  const popover = useRef<HTMLDivElement | null>(null)

  // Read through refs by the document listeners, which are installed once and
  // must see the current world and reference data rather than the first ones.
  const dataRef = useRef(data)
  const indexRef = useRef(index)
  useEffect(() => {
    dataRef.current = data
    indexRef.current = index
  }, [data, index])
  useEffect(
    () =>
      installHoverCards((d) =>
        describeCard(d, dataRef.current, indexRef.current),
      ),
    [],
  )

  // A wide trigger is narrowed to a zero-width strip at the pointer, still
  // tracking the element itself so scrolling and resizing move it.
  const reference = useMemo((): Element | VirtualElement | null => {
    if (!anchor) return null
    if (pointerX === undefined) return anchor
    return {
      contextElement: anchor,
      getBoundingClientRect() {
        const r = anchor.getBoundingClientRect()
        const x = r.left + pointerX
        return DOMRect.fromRect({ x, y: r.top, width: 0, height: r.height })
      },
    }
  }, [anchor, pointerX])

  const { refs, floatingStyles, isPositioned } = useFloating({
    open,
    strategy: 'fixed',
    // Placed with top/left, leaving `transform` free for the entrance
    // animation in index.css; animating it would otherwise fly the card in
    // from the corner.
    transform: false,
    placement: 'right-start',
    elements: { reference },
    middleware: [
      offset(8),
      // Sideways only. Running off the bottom is `shift`'s to fix by sliding
      // the card up; letting `flip` answer it throws the card above the
      // trigger, over whatever the user was reading.
      flip({
        crossAxis: false,
        fallbackPlacements: ['left-start', 'bottom', 'top'],
      }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`
        },
      }),
    ],
    whileElementsMounted: (reference, floating, update) =>
      autoUpdate(reference, floating, () => {
        // The hovered cell left the page — a filter changed, a list
        // re-rendered — and a card pointing at nothing would be a ghost.
        const el =
          reference instanceof Element ? reference : reference.contextElement
        if (el && !el.isConnected) {
          hideHoverCard()
        } else {
          update()
        }
      }),
  })

  // Shown again on every open, not just toggled: the top layer stacks by the
  // order of showing, so a dialog opened since the last card would otherwise
  // sit on top of this one.
  useLayoutEffect(() => {
    const el = popover.current
    if (!el || !HAS_POPOVER) return
    if (el.matches(':popover-open')) el.hidePopover()
    if (open) el.showPopover()
  }, [open])

  const setFloating = refs.setFloating
  const floatingRef = useCallback(
    (el: HTMLDivElement | null) => {
      popover.current = el
      setFloating(el)
    },
    [setFloating],
  )

  return (
    <>
      <div id={DESCRIPTION_ID} className="sr-only" />
      <div
        ref={floatingRef}
        popover={HAS_POPOVER ? 'manual' : undefined}
        hidden={!HAS_POPOVER && !open}
        aria-hidden
        data-hover-card
        // Hidden until placed, or the first frame of every cold open would
        // flash the card in the top-left corner.
        style={{
          ...floatingStyles,
          visibility: isPositioned ? undefined : 'hidden',
        }}
        className="pointer-events-none inset-auto z-[1000] m-0 overflow-hidden border-0 bg-transparent p-0 text-[var(--color-text)]"
      >
        {open && desc && <Body desc={desc} index={index} />}
      </div>
    </>
  )
}

function Body({ desc, index }: { desc: CardDescriptor; index: SaveIndex }) {
  const data = useRefdataStore((s) => s.data)
  switch (desc.kind) {
    case 'pal':
      return (
        <PalCard
          pal={desc.pal}
          data={desc.raw ? undefined : data}
          index={index}
        />
      )
    case 'species':
      return <SpeciesCard id={desc.id} note={desc.note} data={data} />
    case 'passive':
      return <PassiveCard id={desc.id} note={desc.note} data={data} />
    case 'player':
      return (
        <PlayerCard
          uid={desc.uid}
          note={desc.note}
          data={desc.raw ? undefined : data}
          index={index}
        />
      )
    case 'skill':
      return <SkillCard id={desc.id} note={desc.note} data={data} />
    case 'element':
      return <ElementCard name={desc.name} data={data} index={index} />
    case 'work':
      return <WorkCard id={desc.id} data={data} index={index} />
    case 'base':
      return <BaseCard id={desc.id} data={data} index={index} />
    case 'structure':
      return <StructureCard id={desc.id} data={data} index={index} />
    case 'item':
      return (
        <ItemCard
          staticId={desc.staticId}
          count={desc.count}
          dynamicId={desc.dynamicId}
          places={desc.places}
          data={data}
          index={index}
        />
      )
  }
}
