/**
 * Breeding paths kept for later, and the way back to each.
 *
 * The problem this answers is working on three things at once — a worker for
 * the base, a mount, a fighter — where each is a different target with
 * different passives and the Breed view holds exactly one. Browser tabs were
 * the workaround, and each new tab meant opening the save again.
 */

import { useMemo, useState, type KeyboardEvent } from 'react'

import type { SaveIndex } from '../../domain/types.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { passiveText, type PassiveText } from '../../views/breed/passiveText.ts'
import {
  openPath,
  pathLink,
  saveCurrentPath,
  usePathsStore,
} from '../../views/breed/pathsStore.ts'
import {
  belongsHere,
  canonicalPath,
  decodePath,
  summaryText,
  type SavedPath,
} from '../../views/breed/savedPaths.ts'
import { speciesText, type SpeciesText } from '../../views/breed/speciesText.ts'
import { PAIR_PURPOSES } from '../../domain/pairOutcomes.ts'
import { cn } from '../../lib/utils.ts'
import { Button, TextInput } from '../../components/controls.tsx'
import { PassiveChip } from '../../components/primitives.tsx'

export function SavedPaths({ index }: { index: SaveIndex }) {
  const { data } = useRefdataStore()
  const species = speciesText(data)
  const passives = passiveText(data)

  const paths = usePathsStore((s) => s.paths)
  const writable = usePathsStore((s) => s.writable)
  const activeId = usePathsStore((s) => s.activeId)
  const repoint = usePathsStore((s) => s.repoint)
  const notify = useUiStore((s) => s.notify)

  // What the Breed view is showing, read from where it publishes it. Empty
  // until that view has been opened once, which is also when there is nothing
  // to save.
  const breedQs = useUiStore((s) => s.viewParams.breed)
  const params = useMemo(
    () => decodePath(breedQs ?? '', index),
    [breedQs, index],
  )
  const current = useMemo(() => canonicalPath(params, index), [params, index])

  const here = paths.filter((p) => belongsHere(p, index))
  const elsewhere = paths.filter((p) => !belongsHere(p, index))
  const saved = current && here.find((p) => p.qs === current.qs)
  // The path that was opened and has since been changed: a passive added, a
  // guildmate pooled in. Offered as an update rather than assumed, because
  // wandering off to look at something else is just as likely.
  const drifted =
    current && !saved ? here.find((p) => p.id === activeId) : undefined

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-[var(--color-line)] p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            tone="signal"
            disabled={!current || saved !== undefined || !writable}
            onClick={() => saveCurrentPath(params, index, data)}
          >
            {saved ? 'Saved' : 'Save current path'}
          </Button>
          {drifted && current && (
            <Button
              onClick={() => {
                repoint(drifted.id, current)
                notify(`Updated “${drifted.name}”`)
              }}
              title={`Replace what “${drifted.name}” holds with what the Breed view is showing now`}
            >
              Update “{drifted.name}”
            </Button>
          )}
        </div>
        {!writable ? (
          <p className="text-xs text-[var(--color-gold)]">
            Saved paths in this browser were written by a newer version of the
            app, or its storage is switched off. They are left untouched.
          </p>
        ) : (
          !current && (
            <p className="text-xs text-[var(--color-muted)]">
              Pick a target or a pair in Breed, then save it here to come back
              to it.
            </p>
          )
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {paths.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-muted)]">
            Nothing saved yet. A saved path keeps the target, the passives and
            whose pals to use; the route itself is worked out again from
            whichever save is open.
          </p>
        ) : (
          <>
            <ul>
              {here.map((p) => (
                <PathRow
                  key={p.id}
                  path={p}
                  index={index}
                  current={saved?.id === p.id}
                  species={species}
                  passives={passives}
                />
              ))}
            </ul>
            {here.some((p) => p.summary) && (
              <p className="px-3 py-2 text-xs text-[var(--color-faint)]">
                Each count is from the last time that path was open in Breed.
                Open one to work it out again against this save.
              </p>
            )}
            {elsewhere.length > 0 && (
              <details className="border-b border-[var(--color-line-faint)]">
                <summary className="label cursor-pointer bg-[rgb(3_9_13/0.4)] px-3 py-1.5">
                  not in this save · {elsewhere.length}
                </summary>
                <p className="px-3 pt-2 text-xs text-[var(--color-muted)]">
                  These were saved for a player this save does not contain, most
                  likely from another world.
                </p>
                <ul>
                  {elsewhere.map((p) => (
                    <PathRow key={p.id} path={p} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One saved path. Without `index` it is a path for another world: named, and
 * deletable, and nothing else, since none of its ids mean anything here.
 */
function PathRow({
  path,
  index,
  current,
  species,
  passives,
}: {
  path: SavedPath
  index?: SaveIndex
  current?: boolean
  species?: SpeciesText
  passives?: PassiveText
}) {
  const rename = usePathsStore((s) => s.rename)
  const remove = usePathsStore((s) => s.remove)
  const notify = useUiStore((s) => s.notify)

  const [draft, setDraft] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const editing = draft !== undefined

  const commit = () => {
    if (draft !== undefined) rename(path.id, draft)
    setDraft(undefined)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') {
      // Kept from the shell's handler, or cancelling a rename would also
      // close the tray it is in.
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      setDraft(undefined)
    }
  }

  const params = index ? decodePath(path.qs, index) : undefined
  // Muted grey on the selection fill falls well short of readable.
  const sub = current ? 'text-white/85' : 'text-[var(--color-muted)]'

  return (
    <li
      className={cn(
        'border-b border-[var(--color-line-faint)]',
        current && 'bg-[image:var(--surface-row-selected)]',
      )}
    >
      {editing ? (
        <div className="px-3 pt-2">
          <TextInput
            value={draft}
            onChange={setDraft}
            onKeyDown={onKey}
            onBlur={commit}
            autoFocus
            aria-label="Path name"
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={!index}
          aria-current={current ? 'true' : undefined}
          onClick={() => openPath(path)}
          className="block w-full px-3 pt-2 text-left enabled:hover:bg-[var(--color-signal)]/[0.08] disabled:text-[var(--color-muted)]"
        >
          <span className="block truncate text-sm">{path.name}</span>
          {params && species && passives && (
            <span
              className={cn(
                'mt-1 flex flex-wrap items-center gap-1.5 text-xs',
                sub,
              )}
            >
              {params.mode === 'pair' ? (
                <span>
                  pair, ranked for{' '}
                  {PAIR_PURPOSES.find((p) => p.id === params.purpose)?.label ??
                    params.purpose}
                </span>
              ) : (
                <>
                  <span>{species.name(params.target)}</span>
                  {params.passives.map((id) => (
                    <PassiveChip
                      key={id}
                      name={passives.name(id)}
                      rank={passives.rank(id)}
                    />
                  ))}
                  {params.noSpares && <span>and nothing else</span>}
                </>
              )}
            </span>
          )}
          {path.summary && params?.mode === 'plan' && (
            <span className={cn('num mt-1 block text-xs', sub)}>
              {summaryText(path.summary)}
              {path.summary.previous && (
                <span
                  className={current ? undefined : 'text-[var(--color-faint)]'}
                >
                  {' '}
                  · was {path.summary.previous.steps}
                  {path.summary.previous.hatches !== undefined &&
                    `, ≈${path.summary.previous.hatches} hatches`}
                </span>
              )}
            </span>
          )}
        </button>
      )}

      <div className="flex gap-1 px-2 pt-1 pb-1.5">
        {index && (
          <>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => setDraft(path.name)}
              disabled={editing}
            >
              Rename
            </Button>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(pathLink(path)).then(
                  () => notify('Link copied'),
                  () =>
                    notify('Could not reach the clipboard.', { tone: 'warn' }),
                )
              }}
            >
              Copy link
            </Button>
          </>
        )}
        {/* Two presses rather than a dialog: the app has no confirm dialog by
            design, and one press too few should not cost a named path. */}
        <Button
          size="sm"
          tone={confirming ? 'danger' : 'ghost'}
          onClick={() => (confirming ? remove(path.id) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          className="ml-auto"
        >
          {confirming ? 'Delete it' : 'Delete'}
        </Button>
      </div>
    </li>
  )
}
