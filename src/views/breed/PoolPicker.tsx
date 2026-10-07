/**
 * The "also from" controls: which of the guild's pals to count beside the
 * selected player's own.
 *
 * Its own module because two views use it. Breed pools pals to breed from and
 * Builds pools them to recommend from, and the two must agree on what a ticked
 * box means.
 */

import type { Stock } from '../../domain/breeding.ts'
import type { Guid } from '../../domain/types.ts'
import { Button, Checkbox } from '../../components/controls.tsx'
import { count } from '../../lib/format.ts'
import type { OwnerText } from './ownerText.ts'

/** The three pooling settings, as both views keep them in their links. */
export interface Pool {
  includeGuild?: boolean
  includeBase?: boolean
  includeMembers?: Guid[]
}

/**
 * Whose pals to breed from.
 *
 * One checkbox used to cover the whole guild, which conflated two different
 * amounts of asking. A base worker in shared storage is one any member can walk
 * up to and fetch; a pal in someone's palbox needs that person to put it in the
 * pen. Those belong on separate lines, and the palboxes belong one line each,
 * because "everyone except the one who is never online" is the selection people
 * actually want.
 *
 * Every row is checked off the *stock* rather than the params, so a selection
 * the domain declined — a member with no pals, a uid this world does not know —
 * cannot render as ticked and do nothing.
 *
 * The member list is built from the pals, not from the guild roster: a departed
 * member's pals keep their owner uid, and a row that quietly dropped them would
 * lose stock without saying so.
 */
export function PoolPicker({
  stock,
  owner,
  onPool,
  title = 'also breed from',
  memberNote = (n) =>
    `which they have to put in the pen ${n === 1 ? 'itself' : 'themselves'}`,
}: {
  stock: Stock
  owner: OwnerText
  onPool: (next: Pool) => void
  /** The heading: what the pooled pals are being pooled for. */
  title?: string
  /** What borrowing a guildmate's pals costs, after "N pals, ". */
  memberNote?: (n: number) => string
}) {
  const members = [...stock.poolable].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  const everyone = members.map(([uid]) => uid)
  const allOn =
    stock.includedGuild ||
    (stock.includedBase && stock.includedMembers.size === members.length)

  /** `gp` is the "everything" intent; the finer flags only speak without it. */
  const set = (base: boolean, uids: Guid[]) =>
    onPool({ includeGuild: false, includeBase: base, includeMembers: uids })

  const toggleMember = (uid: Guid) => {
    const on = new Set(
      stock.includedGuild ? everyone : [...stock.includedMembers],
    )
    if (on.has(uid)) on.delete(uid)
    else on.add(uid)
    set(stock.includedBase, [...on])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">{title}</span>
        <span className="flex gap-2">
          <Button
            size="sm"
            tone={allOn ? 'signal' : 'ghost'}
            onClick={() => onPool({ includeGuild: true })}
          >
            all
          </Button>
          <Button
            size="sm"
            tone="ghost"
            onClick={() => set(false, [])}
            disabled={!stock.includedBase && stock.includedMembers.size === 0}
          >
            none
          </Button>
        </span>
      </div>

      {stock.poolableBase > 0 && (
        <Checkbox
          checked={stock.includedBase}
          onChange={() =>
            set(
              !stock.includedBase,
              stock.includedGuild ? everyone : [...stock.includedMembers],
            )
          }
          className="items-start text-[11px] leading-relaxed text-[var(--color-muted)]"
          label={
            <span>
              <span className="text-[var(--color-text)]">
                {count(stock.poolableBase)} base{' '}
                {stock.poolableBase === 1 ? 'pal' : 'pals'}
              </span>{' '}
              — nobody owns {stock.poolableBase === 1 ? 'it' : 'these'}, so any
              member can fetch {stock.poolableBase === 1 ? 'it' : 'one'}.
            </span>
          }
        />
      )}

      {members.map(([uid, n]) => (
        <Checkbox
          key={uid}
          checked={stock.includedMembers.has(uid)}
          onChange={() => toggleMember(uid)}
          className="items-start text-[11px] leading-relaxed text-[var(--color-muted)]"
          label={
            <span>
              <span className="text-[var(--color-text)]">
                {owner.name(uid)}
              </span>{' '}
              — {count(n)} {n === 1 ? 'pal' : 'pals'}, {memberNote(n)}.
            </span>
          }
        />
      ))}

      {members.length === 0 && stock.poolableBase === 0 && (
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
          Nobody else in {stock.guild?.name || 'this guild'} holds a pal, so
          there is nothing to pool.
        </p>
      )}
      {/* Kept visible so an old `gp=1` link explains itself rather than looking
          like three boxes that ticked themselves. */}
      {stock.includedGuild && members.length > 0 && (
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
          All of {stock.guild?.name || 'this guild'} is pooled, including anyone
          who joins later. Unticking one narrows it to the rest.
        </p>
      )}
    </div>
  )
}
