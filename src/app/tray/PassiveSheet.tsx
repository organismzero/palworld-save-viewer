/**
 * Every passive a pal can carry, and what it does, in one scrolling list.
 *
 * The hover card already says all of this for one chip at a time. This is for
 * the other question — "which one was the work-speed-without-the-SAN-penalty
 * one?" — where the thing being looked for is not yet on screen to hover.
 */

import { useEffect, useMemo, useState } from 'react'

import {
  PASSIVE_GROUPS,
  passiveGroups,
  type PassiveGroup,
} from '../../domain/passiveGroups.ts'
import { busiestPlayer } from '../../domain/guild.ts'
import { MAX_SLOTS, carrierCounts } from '../../domain/passives.ts'
import type { SaveIndex } from '../../domain/types.ts'
import type { PassiveInfo } from '../../refdata/refdata.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { serialiseParams } from '../viewParams.ts'
import { BREED_DEFAULTS, breedCodec } from '../../views/breed/params.ts'
import { decodePath } from '../../views/breed/savedPaths.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { SOURCE_LABEL, passiveText } from '../../views/breed/passiveText.ts'
import { effectText } from '../../views/builds/buildsText.ts'
import {
  Button,
  Checkbox,
  SegmentBar,
  TextInput,
} from '../../components/controls.tsx'
import { PassiveChip, Pill } from '../../components/primitives.tsx'

/** Ties the group filter to the list it narrows, for `aria-controls`. */
const GROUP_TABS = 'passive-group'
const LIST = 'passive-sheet'

type Filter = PassiveGroup | 'all'

interface Row {
  id: string
  info: PassiveInfo
  /** What the row says the passive does, one line each. */
  lines: string[]
  groups: Set<PassiveGroup>
  /** Lowercased, everything the search box matches against. */
  haystack: string
}

const IMPLANT_TITLE = {
  reusable: 'A reusable implant exists, applied at a Pal Surgery Table.',
  disposable: 'A single-use implant exists, applied at a Pal Surgery Table.',
  both: 'Reusable and single-use implants exist, applied at a Pal Surgery Table.',
} as const

export function PassiveSheet({ index }: { index: SaveIndex }) {
  const { data, status, ensure } = useRefdataStore()
  useEffect(() => {
    void ensure()
  }, [ensure])

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [heldOnly, setHeldOnly] = useState(false)

  // Whose pals "have" means: the player the Breed view is planning for, which
  // is its own default when nobody has been picked there. The same player the
  // "add to path" button would be adding for, so the two cannot disagree.
  const view = useUiStore((s) => s.view)
  const breedQs = useUiStore((s) => s.viewParams.breed)
  const breed = useMemo(
    () => decodePath(breedQs ?? '', index),
    [breedQs, index],
  )
  const player = breed.playerUid
    ? index.playerByUid.get(breed.playerUid)
    : busiestPlayer(index)
  const held = useMemo(
    () => carrierCounts(index.palsByOwner.get(player?.playerUid ?? '') ?? []),
    [index, player],
  )

  // Only while the Breed view is the one on screen and planning a target: the
  // button changes what that view shows, and doing it from the map would be a
  // change nobody could see.
  const canAdd =
    view === 'breed' &&
    breed.mode === 'plan' &&
    breed.passives.length < MAX_SLOTS
  const add = (id: string) => {
    const next = {
      ...breed,
      passives: [...breed.passives, id].sort(),
      // A pinned first pair was chosen for the old passive set.
      route: undefined,
    }
    useUiStore
      .getState()
      .adoptHashParams(
        'breed',
        serialiseParams(breedCodec(index).encode(next, BREED_DEFAULTS)),
      )
  }

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    return passiveText(data)
      .all()
      .flatMap(({ id }) => {
        const info = data.passives[id]
        if (!info) return []
        const effects = (info.effects ?? []).map(effectText)
        // The game's own wording where there is some. Two descriptions are
        // dropped upstream of here for contradicting themselves — see
        // `resolveEffects` — and those fall back to the effects, which do not.
        const lines = info.description
          ? info.description.split('\n').filter((l) => l.trim() !== '')
          : effects
        return [
          {
            id,
            info,
            lines,
            groups: passiveGroups(info),
            // Effects are searched even when the description is what prints:
            // the game says "Work Speed", "SAN" and "Hunger" in a dozen
            // phrasings, and the effect labels say each one way.
            haystack: [info.name, id, ...lines, ...effects]
              .join('\n')
              .toLowerCase(),
          },
        ]
      })
  }, [data])

  const q = query.trim().toLowerCase()
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || r.groups.has(filter)) &&
      (q === '' || r.haystack.includes(q)) &&
      (!heldOnly || held.has(r.id)),
  )
  const rowProps = (r: Row) => ({
    have: player ? (held.get(r.id) ?? 0) : undefined,
    inPath: view === 'breed' && breed.passives.includes(r.id),
    onAdd:
      canAdd && !breed.passives.includes(r.id) ? () => add(r.id) : undefined,
  })
  const helpful = shown.filter((r) => r.info.rank >= 0)
  const detrimental = shown.filter((r) => r.info.rank < 0)

  if (status === 'degraded') {
    return (
      <p className="p-4 text-sm text-[var(--color-muted)]">
        The passive list comes from reference data, which could not be loaded.
        Everything read from your save still works.
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-[var(--color-line)] p-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Name or effect — work speed, fire, hunger"
          aria-label="Search passives"
          aria-controls={LIST}
          suffix={
            <span className="num text-xs text-[var(--color-faint)]">
              {shown.length}
            </span>
          }
        />
        <SegmentBar
          name={GROUP_TABS}
          panelId={LIST}
          value={filter}
          onChange={(id) => setFilter(id as Filter)}
          tabs={[{ id: 'all', label: 'all' }, ...PASSIVE_GROUPS]}
        />
        {player && (
          <Checkbox
            checked={heldOnly}
            onChange={setHeldOnly}
            className="gap-2 text-xs text-[var(--color-muted)]"
            label={
              <span>
                only ones {player.name}’s pals have
                <span className="num text-[var(--color-faint)]">
                  {' '}
                  · {rows.filter((r) => held.has(r.id)).length}
                </span>
              </span>
            }
          />
        )}
      </div>

      <div id={LIST} className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <p className="label p-4">loading passives</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-muted)]">
            No passive matches that.
          </p>
        ) : (
          <>
            <ul>
              {helpful.map((r) => (
                <PassiveRow key={r.id} row={r} {...rowProps(r)} />
              ))}
            </ul>
            {detrimental.length > 0 && (
              <>
                <h3 className="label border-y border-[var(--color-line)] bg-[rgb(3_9_13/0.4)] px-3 py-1.5">
                  detrimental
                </h3>
                <ul>
                  {detrimental.map((r) => (
                    <PassiveRow key={r.id} row={r} {...rowProps(r)} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PassiveRow({
  row,
  have,
  inPath,
  onAdd,
}: {
  row: Row
  /** How many of the player's pals carry it. Absent with nobody to count for. */
  have?: number
  /** Already one of the passives the Breed view is planning for. */
  inPath: boolean
  /** Absent when it cannot be added: wrong view, four already, or in the path. */
  onAdd?: () => void
}) {
  const { info, lines } = row
  return (
    <li className="border-b border-[var(--color-line-faint)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* No `id`, so no hover card: the row already says what it would. */}
        <PassiveChip name={info.name} rank={info.rank} />
        {info.source !== 'random' && (
          <Pill tone="warn" title="Breeding cannot roll this one at random.">
            {SOURCE_LABEL[info.source]}
          </Pill>
        )}
        {info.implant && (
          <Pill title={IMPLANT_TITLE[info.implant]}>implant</Pill>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {have !== undefined && have > 0 && (
            <Pill
              tone="good"
              title={`${have} of this player’s pals ${have === 1 ? 'carries' : 'carry'} it, so it can be bred down.`}
            >
              have {have}
            </Pill>
          )}
          {inPath && <span className="label">in path</span>}
          {onAdd && (
            <Button
              size="sm"
              tone="ghost"
              onClick={onAdd}
              title="Add this to the passives the Breed view is planning for"
            >
              Add to path
            </Button>
          )}
        </span>
      </div>
      {lines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--color-muted)]">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  )
}
