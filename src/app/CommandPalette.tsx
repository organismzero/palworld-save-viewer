/**
 * One search box over the whole save.
 *
 * ## Why the filtering is ours
 *
 * `cmdk` filters by scoring every rendered item, which is the right design for
 * a menu of twenty commands and the wrong one for a save holding 1,098 pals,
 * 1,504 structures and 333 distinct items. Rendering all of those so the
 * library can score them costs more than the search saves. So `shouldFilter` is
 * off, the matching happens over the flat domain arrays, and only the top few
 * results per group are ever mounted.
 *
 * ## Why results are capped per group rather than overall
 *
 * A query like "wood" legitimately matches hundreds of things. Showing 200
 * chests and no pals would look like the palette cannot find pals. Each group
 * gets its own small allowance so every kind of answer stays visible.
 */

import { useMemo, useState } from 'react'
import { Command } from 'cmdk'

import { searchItems } from '../domain/bases.ts'
import { playerGuilds } from '../domain/index.ts'
import type { SaveIndex } from '../domain/types.ts'
import { count } from '../lib/format.ts'
import { useRefdataStore } from '../store/refdataStore.ts'
import { useUiStore, type Focus, type ViewId } from '../store/uiStore.ts'

const PER_GROUP = 6

interface Result {
  key: string
  label: string
  hint?: string
  group: string
  run: () => void
}

export function CommandPalette({ index }: { index?: SaveIndex }) {
  const open = useUiStore((s) => s.paletteOpen)
  const setPalette = useUiStore((s) => s.setPalette)
  const setView = useUiStore((s) => s.setView)
  const jump = useUiStore((s) => s.jump)
  const setAbout = useUiStore((s) => s.setAbout)
  const setShortcuts = useUiStore((s) => s.setShortcuts)
  const { data } = useRefdataStore()

  const [query, setQuery] = useState('')

  // A stale query from last time is never what someone wants on reopening, so
  // it is cleared where the close actually happens rather than by an effect
  // watching `open` — same result, one render fewer, and no cascade.
  const setOpen = (next: boolean) => {
    if (!next) setQuery('')
    setPalette(next)
  }

  const results = useMemo((): Result[] => {
    const q = query.trim().toLowerCase()
    const out: Result[] = []

    const go = (view: ViewId, label: string, hint?: string) => ({
      key: `view:${view}`,
      label,
      hint,
      group: 'Go to',
      run: () => {
        setView(view)
        setPalette(false)
      },
    })

    const views: Result[] = [
      go('map', 'Map', 'the world'),
      go('pals', 'Pals', 'collection browser'),
      go('bases', 'Bases', 'storage and inventories'),
      go('guild', 'Guild', 'players and roster'),
      go('summary', 'Summary', 'diagnostics'),
      go('breed', 'Breed', 'breeding paths'),
    ]
    out.push(...views.filter((v) => !q || v.label.toLowerCase().includes(q)))

    const actions: Result[] = [
      {
        key: 'action:about',
        label: 'Data sources and licence',
        group: 'Actions',
        run: () => {
          setAbout(true)
          setPalette(false)
        },
      },
      {
        key: 'action:shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Actions',
        run: () => {
          setShortcuts(true)
          setPalette(false)
        },
      },
    ]
    out.push(...actions.filter((a) => !q || a.label.toLowerCase().includes(q)))

    if (!index || !q) return out

    const jumpTo = (view: ViewId, focus: Focus) => () => jump(view, focus)

    /* --- pals ---------------------------------------------------------- */
    const named = (id: string) => data?.species[id.toLowerCase()]?.name ?? id
    let n = 0
    for (const pal of index.pals) {
      if (n >= PER_GROUP) break
      const label = pal.nickname ?? named(pal.characterId)
      if (
        !label.toLowerCase().includes(q) &&
        !pal.characterId.toLowerCase().includes(q)
      ) {
        continue
      }
      n += 1
      out.push({
        key: `pal:${pal.instanceId}`,
        label,
        hint: `level ${pal.level} · ${named(pal.characterId)}`,
        group: 'Pals',
        run: jumpTo('pals', { kind: 'pal', id: pal.instanceId, label }),
      })
    }

    /* --- players ------------------------------------------------------- */
    for (const player of index.players) {
      if (!player.name.toLowerCase().includes(q)) continue
      out.push({
        key: `player:${player.playerUid}`,
        label: player.name,
        hint: `level ${player.level} · player`,
        group: 'Players',
        run: jumpTo('guild', { kind: 'player', id: player.playerUid }),
      })
    }

    /* --- guilds -------------------------------------------------------- */
    for (const guild of playerGuilds(index)) {
      if (!guild.name.toLowerCase().includes(q)) continue
      out.push({
        key: `guild:${guild.groupId}`,
        label: guild.name,
        hint: `${guild.members.length} members · guild`,
        group: 'Players',
        run: () => {
          setView('guild')
          setPalette(false)
        },
      })
    }

    /* --- items --------------------------------------------------------- */
    for (const hit of searchItems(index, q, nameOfItem, PER_GROUP)) {
      const first = hit.places[0]
      if (!first) continue
      out.push({
        key: `item:${hit.staticId}`,
        label: hit.name,
        hint: `${count(hit.total)} in ${hit.places.length} place${
          hit.places.length === 1 ? '' : 's'
        }`,
        group: 'Items',
        run: jumpTo('bases', { kind: 'container', id: first.containerId }),
      })
    }

    /* --- bases --------------------------------------------------------- */
    index.bases.forEach((base, i) => {
      const label = `Base ${i + 1}`
      if (!label.toLowerCase().includes(q)) return
      out.push({
        key: `base:${base.baseId}`,
        label,
        hint: `${index.structuresByBase.get(base.baseId)?.length ?? 0} structures`,
        group: 'Bases',
        run: jumpTo('bases', { kind: 'base', id: base.baseId }),
      })
    })

    return out

    function nameOfItem(staticId: string) {
      return data?.items[staticId.toLowerCase()]?.name ?? staticId
    }
  }, [query, index, data, jump, setView, setPalette, setAbout, setShortcuts])

  const groups = useMemo(() => {
    const byGroup = new Map<string, Result[]>()
    for (const r of results) {
      const bucket = byGroup.get(r.group)
      if (bucket) bucket.push(r)
      else byGroup.set(r.group, [r])
    }
    return [...byGroup]
  }, [results])

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search this save"
      shouldFilter={false}
      // cmdk renders into a portal; these classes style its overlay wrapper.
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-scrim)] p-4 pt-[12vh] backdrop-blur-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="corner-ticks relative isolate w-full max-w-xl overflow-hidden border border-[var(--color-line)] bg-[rgb(4_10_15/0.94)] shadow-modal [--tick-size:12px]">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={
            index
              ? 'Search pals, items, players, bases…'
              : 'Load a save to search it'
          }
          className="w-full border-b border-[var(--color-line)] bg-[rgb(3_9_13/0.75)] px-4 py-3 text-sm shadow-[var(--edge-sunken)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="label px-2 py-6 text-center">
            nothing matches
          </Command.Empty>
          {groups.map(([group, items]) => (
            <Command.Group
              key={group}
              heading={group}
              // The heading is rendered by cmdk, so it is reached through an
              // arbitrary variant. Spelled out in utilities rather than reusing
              // `.label`: an arbitrary variant composes utilities, and cannot
              // apply a custom class from a `@layer base` rule.
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[var(--tracking-label)] [&_[cmdk-group-heading]]:text-[var(--color-faint)] [&_[cmdk-group-heading]]:uppercase"
            >
              {items.map((r) => (
                <Command.Item
                  key={r.key}
                  value={r.key}
                  onSelect={r.run}
                  className="flex cursor-pointer items-baseline gap-3 rounded-control px-2 py-1.5 text-sm data-[selected=true]:bg-[image:var(--surface-row-selected)] data-[selected=true]:text-white"
                >
                  <span className="truncate">{r.label}</span>
                  {r.hint && (
                    <span className="label ml-auto shrink-0 normal-case">
                      {r.hint}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
