/**
 * The element chart, as the matrix it is.
 *
 * `typeChart.ts` holds who beats whom and the Builds view applies it, but the
 * only place it could be *read* was one element at a time, in a hover card.
 * Every row here is an attacker and every column a defender, which also puts
 * the app's one assumption where it can be seen: the game says who beats whom
 * and nothing about by how much, and the ×2 and ×½ are this app's.
 */

import { useEffect, useMemo } from 'react'

import { busiestPlayer, elementDistribution } from '../../domain/guild.ts'
import {
  ALL_ELEMENTS,
  STRONG,
  WEAK,
  multiplier,
} from '../../domain/typeChart.ts'
import type { SaveIndex } from '../../domain/types.ts'
import { element } from '../../lib/color.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { decodePath } from '../../views/breed/savedPaths.ts'
import { ElementBadge } from '../../components/primitives.tsx'

export function TypeChart({ index }: { index: SaveIndex }) {
  const { data, ensure } = useRefdataStore()
  useEffect(() => {
    void ensure()
  }, [ensure])

  // The same player the other sheets count for: whoever Breed is planning for.
  const breedQs = useUiStore((s) => s.viewParams.breed)
  const playerUid = useMemo(
    () => decodePath(breedQs ?? '', index).playerUid,
    [breedQs, index],
  )
  const player = playerUid
    ? index.playerByUid.get(playerUid)
    : busiestPlayer(index)

  const held = useMemo(() => {
    const pals = index.palsByOwner.get(player?.playerUid ?? '') ?? []
    const slices = elementDistribution(
      pals,
      (id) => data?.species[id.toLowerCase()],
    )
    return new Map<string, number>(slices.map((s) => [s.name, s.count]))
  }, [index, player, data])

  return (
    <div className="space-y-4 p-3">
      <table className="w-full border-collapse text-center text-xs">
        <caption className="label mb-2 text-left">
          attacker down the side, defender across the top
        </caption>
        <thead>
          <tr>
            <td />
            {ALL_ELEMENTS.map((d) => (
              <th key={d} scope="col" className="pb-1.5 font-normal">
                <ElementBadge name={d} size={12} />
              </th>
            ))}
            {data && player && (
              <th
                scope="col"
                className="label pb-1.5 pl-2 text-right font-normal"
              >
                held
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {ALL_ELEMENTS.map((a) => (
            <tr key={a} className="border-t border-[var(--color-line-faint)]">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span className="flex items-center gap-1.5">
                  <ElementBadge name={a} size={12} card={false} />
                  {element(a)?.display ?? a}
                </span>
              </th>
              {ALL_ELEMENTS.map((d) => (
                <Cell key={d} m={multiplier(a, d)} />
              ))}
              {data && player && (
                <td className="num pl-2 text-right text-[var(--color-muted)]">
                  {held.get(a) ?? 0}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-2 text-xs text-[var(--color-muted)]">
        <p>
          <span className="num text-[var(--color-hp)]">×{STRONG}</span> hits
          harder, <span className="num text-[var(--color-danger)]">×½</span> is
          resisted, and a blank is even. The game shows who beats whom and not
          by how much, so the two numbers are this app’s assumption.
        </p>
        <p>
          Against a pal with two elements the multipliers are multiplied, so a
          hit one element is weak to and the other resists comes out even.
        </p>
        {data && player && (
          <p>
            “Held” counts {player.name}’s pals by their first element only, so a
            dual-element pal is counted once.
          </p>
        )}
      </div>
    </div>
  )
}

function Cell({ m }: { m: number }) {
  if (m === STRONG) {
    return <td className="num text-[var(--color-hp)]">×{STRONG}</td>
  }
  if (m === WEAK) {
    return <td className="num text-[var(--color-danger)]">×½</td>
  }
  // An empty cell, but one a screen reader should not have to guess at.
  return (
    <td>
      <span className="sr-only">even</span>
    </td>
  )
}
