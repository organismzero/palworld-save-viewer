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

import { containerLocation, searchItems } from '../domain/bases.ts'
import { playerGuilds } from '../domain/index.ts'
import {
  baseNames,
  itemName,
  speciesName,
  structureName,
} from '../domain/names.ts'
import type { SaveIndex } from '../domain/types.ts'
import { count } from '../lib/format.ts'
import { clearCache } from '../refdata/refdata.ts'
import { MAP_LAYER_IDS } from '../store/prefs.ts'
import { useRefdataStore } from '../store/refdataStore.ts'
import { forgetSession, sessionDescriptor } from '../store/session.ts'
import { useUiStore, type Focus, type ViewId } from '../store/uiStore.ts'
import { BREED_DEFAULTS, breedCodec } from '../views/breed/params.ts'
import { openPath, usePathsStore } from '../views/breed/pathsStore.ts'
import { withLayerToggled } from '../views/map/params.ts'
import { serialiseParams } from './viewParams.ts'
import { matchRank, pushRecent, rankPals } from './paletteSearch.ts'

const PER_GROUP = 6

interface Result {
  key: string
  label: string
  hint?: string
  group: string
  run: () => void
  /**
   * Whether choosing this is a jump to a thing, and so worth remembering.
   * Navigation and actions are always one keystroke away and are not.
   */
  recent?: boolean
}

const LAYER_LABEL: Record<(typeof MAP_LAYER_IDS)[number], string> = {
  players: 'players',
  bases: 'bases',
  structuresBuilt: 'built by players',
  markers: 'map pins',
  pals: 'pals',
  chests: 'loot chests',
  structuresWorld: 'world objects',
  landmarks: 'fast travel',
}

export function CommandPalette({
  index,
  onAddFiles,
  onLoadAnother,
  onCopyLink,
}: {
  index?: SaveIndex
  /** The shell's own actions, which need its file picker and its reset. */
  onAddFiles: () => void
  onLoadAnother: () => void
  onCopyLink: () => void
}) {
  const open = useUiStore((s) => s.paletteOpen)
  const setPalette = useUiStore((s) => s.setPalette)
  const setView = useUiStore((s) => s.setView)
  const jump = useUiStore((s) => s.jump)
  const setAbout = useUiStore((s) => s.setAbout)
  const setShortcuts = useUiStore((s) => s.setShortcuts)
  const setSettings = useUiStore((s) => s.setSettings)
  const { data } = useRefdataStore()
  const paths = usePathsStore((s) => s.paths)

  /**
   * The last few things jumped to. In memory and nowhere else: it names pals
   * and players, which is not something to leave in `localStorage` for a
   * convenience. The palette lives inside the shell, which is unmounted when
   * a save is closed, so this empties itself with the world it described.
   */
  const [recents, setRecents] = useState<Result[]>([])
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
      go('builds', 'Builds', 'party and base pals by purpose'),
    ]
    out.push(...views.filter((v) => !q || v.label.toLowerCase().includes(q)))

    const ui = () => useUiStore.getState()
    const act = (
      key: string,
      label: string,
      run: () => void,
      hint?: string,
    ) => ({
      key: `action:${key}`,
      label,
      hint,
      group: 'Actions',
      run: () => {
        setPalette(false)
        run()
      },
    })
    const actions: Result[] = [
      act('settings', 'Settings', () => setSettings(true)),
      act(
        'add',
        'Add files',
        onAddFiles,
        'player saves, LevelMeta, LocalData, server settings',
      ),
      act('load', 'Load another save', onLoadAnother),
      act('copy', 'Copy link to this view', onCopyLink),
      act('tray', 'Toggle the utility tray', () =>
        ui().setTray({ open: !ui().trayOpen }),
      ),
      ...MAP_LAYER_IDS.map((id) =>
        act(`layer:${id}`, `Map: toggle ${LAYER_LABEL[id]}`, () => {
          // Adopted, not published: the map may be on screen, and it only
          // re-reads its link when told a navigation happened.
          ui().adoptHashParams(
            'map',
            withLayerToggled(ui().viewParams.map ?? '', id),
          )
          ui().setView('map')
        }),
      ),
      act('clear-cache', 'Clear cached game data', () => {
        void clearCache().then(() =>
          ui().notify('Cached game data cleared. Reload to fetch it again.'),
        )
      }),
      // Only when there is one: an action that does nothing is a lie.
      ...(sessionDescriptor()
        ? [
            act('forget', 'Forget the save kept in this browser', () => {
              void forgetSession().then(() =>
                ui().notify('The kept save was deleted from this browser.'),
              )
            }),
          ]
        : []),
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
    // With nothing typed, the short list of what the palette always offers.
    // The layer toggles and housekeeping would bury it, so they wait for a
    // query that asks for them.
    const quiet = new Set(['action:settings', 'action:about', 'action:shortcuts', 'action:add', 'action:copy']) // prettier-ignore
    out.push(
      ...actions.filter((a) =>
        q ? a.label.toLowerCase().includes(q) : quiet.has(a.key),
      ),
    )

    if (!index) return out
    if (!q) {
      return [...recents.map((r) => ({ ...r, group: 'Recent' })), ...out]
    }

    // Every result below is a jump to a thing, so every one is remembered.
    const found: Result[] = []
    const jumpTo = (view: ViewId, focus: Focus) => () => jump(view, focus)

    /* --- pals ---------------------------------------------------------- */
    const named = (id: string) => speciesName(data, id)
    for (const pal of rankPals(index.pals, q, named, PER_GROUP)) {
      const label = pal.nickname ?? named(pal.characterId)
      found.push({
        key: `pal:${pal.instanceId}`,
        label,
        hint: `level ${pal.level} · ${named(pal.characterId)}`,
        group: 'Pals',
        run: jumpTo('pals', { kind: 'pal', id: pal.instanceId, label }),
      })
    }

    /* --- species nobody holds ------------------------------------------ */
    // A species with pals is found through them above. One with none has
    // nowhere to jump to but the plan for getting it.
    if (data) {
      const held = new Set(index.pals.map((p) => p.characterId.toLowerCase()))
      const missing = Object.keys(data.breeding?.pals ?? {})
        .filter((id) => !held.has(id))
        .map((id) => ({ id, name: named(id), rank: matchRank(named(id), q) }))
        .filter((s) => s.rank !== undefined)
        .sort((a, b) => a.rank! - b.rank! || a.name.localeCompare(b.name))
        .slice(0, PER_GROUP)
      for (const s of missing) {
        found.push({
          key: `species:${s.id}`,
          label: s.name,
          hint: 'not held · plan breeding it',
          group: 'Species',
          run: () => {
            const qs = serialiseParams(
              breedCodec(index).encode(
                { ...BREED_DEFAULTS, target: s.id },
                BREED_DEFAULTS,
              ),
            )
            setPalette(false)
            ui().adoptHashParams('breed', qs)
            ui().setView('breed')
          },
        })
      }
    }

    /* --- players ------------------------------------------------------- */
    for (const player of index.players) {
      if (!player.name.toLowerCase().includes(q)) continue
      found.push({
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
      found.push({
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
      found.push({
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
    // The label the Bases view and the map use, landmark included, so typing
    // the name of a place finds the base beside it.
    const bases = baseNames(index, data)
    index.bases.forEach((base) => {
      const label = bases.get(base.baseId) ?? 'Base'
      if (!label.toLowerCase().includes(q)) return
      found.push({
        key: `base:${base.baseId}`,
        label,
        hint: `${index.structuresByBase.get(base.baseId)?.length ?? 0} structures`,
        group: 'Bases',
        run: jumpTo('bases', { kind: 'base', id: base.baseId }),
      })
    })

    /* --- structures and storage ---------------------------------------- */
    // By what they are called, one row per structure, storage first: "chest"
    // is asked to find a chest, and a base has hundreds of walls.
    const nameOfStructure = (st: (typeof index.structures)[number]) =>
      structureName(data, st)
    const stacks = (st: (typeof index.structures)[number]) =>
      st.containerId
        ? (index.containerById.get(st.containerId)?.slots.length ?? 0)
        : 0
    const structures = index.structures
      // An egg waiting on a Breeding Farm is found as the farm's contents.
      .filter((st) => !index.looseEggFarm.has(st.instanceId))
      .map((st) => ({ st, rank: matchRank(nameOfStructure(st), q) }))
      .filter((x) => x.rank !== undefined)
      .sort(
        (a, b) =>
          a.rank! - b.rank! ||
          // Yours before the world's: a save has thousands of treasure
          // chests nobody placed, and they would fill every row.
          (b.st.baseCampId ? 1 : 0) - (a.st.baseCampId ? 1 : 0) ||
          (b.st.containerId ? 1 : 0) - (a.st.containerId ? 1 : 0) ||
          stacks(b.st) - stacks(a.st) ||
          a.st.instanceId.localeCompare(b.st.instanceId),
      )
      .slice(0, PER_GROUP)
    for (const { st } of structures) {
      const container = st.containerId
        ? index.containerById.get(st.containerId)
        : undefined
      const where = container
        ? containerLocation(index, container, nameOfStructure, (b) => bases.get(b.baseId) ?? 'Base') // prettier-ignore
        : undefined
      const base = st.baseCampId ? bases.get(st.baseCampId) : undefined
      found.push({
        key: `structure:${st.instanceId}`,
        label: nameOfStructure(st),
        hint: [
          where?.detail ?? base ?? 'out in the world',
          container ? `${container.slots.length} stacks` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        group: 'Structures',
        run: jumpTo('bases', { kind: 'structure', id: st.instanceId }),
      })
    }

    /* --- fast travel ---------------------------------------------------- */
    const landmarks = (data?.landmarks ?? [])
      .map((l) => ({ l, rank: matchRank(l.name, q) }))
      .filter((x) => x.rank !== undefined)
      .sort((a, b) => a.rank! - b.rank! || a.l.name.localeCompare(b.l.name))
      .slice(0, PER_GROUP)
    for (const { l } of landmarks) {
      found.push({
        key: `landmark:${l.id}`,
        label: l.name,
        hint: 'fast travel · show on the map',
        group: 'Places',
        run: jumpTo('map', { kind: 'map', id: l.id }),
      })
    }

    /* --- passives -------------------------------------------------------- */
    const passives = Object.entries(data?.passives ?? {})
      .map(([id, p]) => ({ id, p, rank: matchRank(p.name, q) }))
      .filter((x) => x.rank !== undefined)
      .sort((a, b) => a.rank! - b.rank! || a.p.name.localeCompare(b.p.name))
      .slice(0, PER_GROUP)
    for (const { id, p } of passives) {
      found.push({
        key: `passive:${id}`,
        label: p.name,
        hint: 'passive · open the cheat sheet',
        group: 'Passives',
        run: () => {
          setPalette(false)
          ui().setPassiveQuery(p.name)
          ui().setTray({ open: true, tab: 'passives' })
        },
      })
    }

    /* --- saved breeding paths ------------------------------------------- */
    for (const path of paths) {
      if (!path.name.toLowerCase().includes(q)) continue
      found.push({
        key: `path:${path.id}`,
        label: path.name,
        hint: 'saved breeding path',
        group: 'Saved paths',
        run: () => {
          setPalette(false)
          openPath(path)
        },
      })
    }

    return [...out, ...found.map((r) => ({ ...r, recent: true }))]

    function nameOfItem(staticId: string) {
      return itemName(data, staticId)
    }
  }, [
    query,
    index,
    data,
    paths,
    recents,
    jump,
    setView,
    setPalette,
    setAbout,
    setShortcuts,
    setSettings,
    onAddFiles,
    onLoadAnother,
    onCopyLink,
  ])

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
              ? 'Search pals, items, places, passives, actions…'
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
                  onSelect={() => {
                    if (r.recent) setRecents((list) => pushRecent(list, r))
                    // Here as well as on close: most results close the
                    // palette through the store, which does not pass by the
                    // handler that empties the box.
                    setQuery('')
                    r.run()
                  }}
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
