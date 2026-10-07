/**
 * What needs doing, base by base.
 *
 * The Bases overview says the same about one base at a time, once you have
 * gone there. This is the guild's view of it: every base that has something
 * wrong, in one list, each line a way to the thing itself. A base with nothing
 * wrong is left out, because a list of four bases reading "fine" is four lines
 * to read to learn nothing.
 */

import {
  ailingWorkers,
  baseHealth,
  type AilingWorker,
} from '../../domain/bases.ts'
import { baseNames } from '../../domain/names.ts'
import { palName } from '../../domain/palText.ts'
import type { Base, Guild, SaveIndex } from '../../domain/types.ts'
import { Jump } from '../../components/Jump.tsx'
import { Panel, Pill, SectionHeading } from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { basesLink } from '../bases/params.ts'

/** Ailing workers named per base before the rest are counted. */
const NAMED = 6

export function BaseTriage({
  index,
  guild,
}: {
  index: SaveIndex
  guild: Guild
}) {
  const { data } = useRefdataStore()
  const bases = index.basesByGuild.get(guild.groupId) ?? []
  if (bases.length === 0) return null

  const names = baseNames(index, data)
  const rows = bases
    .map((base) => ({
      base,
      health: baseHealth(index, base),
      ailing: ailingWorkers(index, base),
    }))
    .filter((r) => r.health.damaged > 0 || r.ailing.length > 0)

  return (
    <section className="mb-10">
      <SectionHeading
        title="Needs attention"
        hint={
          rows.length === 0
            ? undefined
            : `${rows.length} of ${bases.length} ${bases.length === 1 ? 'base' : 'bases'}`
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          Nothing at{' '}
          {bases.length === 1 ? 'the base' : `any of the ${bases.length} bases`}
          : no damaged structures, and no worker sick, hurt, starving or low on
          sanity.
        </p>
      ) : (
        <Panel className="divide-y divide-[var(--color-line-faint)]">
          {rows.map(({ base, health, ailing }) => (
            <div
              key={base.baseId}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3 text-sm"
            >
              <Jump
                view="bases"
                focus={{ kind: 'base', id: base.baseId }}
                card={{ kind: 'base', id: base.baseId }}
                className="w-64 shrink-0"
              >
                {names.get(base.baseId) ?? 'Base'}
              </Jump>
              {health.damaged > 0 && (
                <DamagedLink index={index} base={base} n={health.damaged} />
              )}
              {ailing.length > 0 && <Ailing ailing={ailing} />}
            </div>
          ))}
        </Panel>
      )}
    </section>
  )
}

/** Opens Bases on this base with its list narrowed to what is damaged. */
function DamagedLink({
  index,
  base,
  n,
}: {
  index: SaveIndex
  base: Base
  n: number
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const ui = useUiStore.getState()
        ui.publishParams(
          'bases',
          basesLink(index, {
            source: { kind: 'base', baseId: base.baseId },
            damaged: true,
            // Most of what gets damaged is a wall, which holds nothing.
            storageOnly: false,
          }),
        )
        ui.setView('bases')
      }}
      className="shrink-0 text-[var(--color-stamina)] underline-offset-2 hover:underline"
    >
      <span className="num">{count(n)}</span> damaged{' '}
      {n === 1 ? 'structure' : 'structures'}
      <span aria-hidden className="ml-1 text-[var(--color-signal)]">
        →
      </span>
    </button>
  )
}

function Ailing({ ailing }: { ailing: AilingWorker[] }) {
  const { data } = useRefdataStore()
  return (
    <ul className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1.5">
      {ailing.slice(0, NAMED).map(({ pal, conditions }) => {
        const name = palName(pal, data?.species[pal.characterId.toLowerCase()])
        return (
          <li key={pal.instanceId} className="flex items-baseline gap-1.5">
            <Jump
              view="pals"
              focus={{ kind: 'pal', id: pal.instanceId, label: name }}
              card={{ kind: 'pal', pal }}
              quiet
            >
              {name}
            </Jump>
            {conditions.map((c) => (
              <Pill key={c.id} tone={c.tone} title={c.detail}>
                {c.label}
              </Pill>
            ))}
          </li>
        )
      })}
      {ailing.length > NAMED && (
        <li className="text-xs text-[var(--color-muted)]">
          and {count(ailing.length - NAMED)} more workers
        </li>
      )}
    </ul>
  )
}
