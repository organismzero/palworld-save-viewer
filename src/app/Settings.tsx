/**
 * Settings: everything about the app that can be changed, in one place.
 *
 * The session toggle, the cache button and the saved paths used to live in the
 * About dialog, which is where you go to read and not where you look for a
 * switch. They are here now, beside the preferences that had nowhere to live
 * at all.
 *
 * What is absent is said, not left to be wondered about: there is no theme and
 * no language because the app has one of each by construction.
 */

import { useEffect, useState } from 'react'

import {
  clearCache,
  refdataInfo,
  type RefdataInfo,
} from '../refdata/refdata.ts'
import { bytes, relativeTime } from '../lib/format.ts'
import {
  MAP_LAYER_IDS,
  VIEW_IDS,
  readPrefs,
  writePrefs,
  type Prefs,
} from '../store/prefs.ts'
import { useRefdataStore } from '../store/refdataStore.ts'
import {
  flushSessionWrite,
  forgetSession,
  rememberPref,
  sessionDescriptor,
  setRememberPref,
} from '../store/session.ts'
import { useUiStore, type ViewId } from '../store/uiStore.ts'
import { usePathsStore } from '../views/breed/pathsStore.ts'
import { DEFAULT_LAYERS } from '../views/map/params.ts'
import {
  Button,
  Checkbox,
  Modal,
  SelectControl,
} from '../components/controls.tsx'

const VIEW_LABEL: Record<ViewId, string> = {
  map: 'Map',
  pals: 'Pals',
  bases: 'Bases',
  guild: 'Guild',
  summary: 'Summary',
  breed: 'Breed',
  builds: 'Builds',
}

/** The map's layers in the words its own legend uses. */
const LAYER_LABEL: Record<(typeof MAP_LAYER_IDS)[number], string> = {
  players: 'Players',
  bases: 'Bases',
  structuresBuilt: 'Built by players',
  markers: 'Map pins',
  pals: 'Pals',
  chests: 'Loot chests',
  structuresWorld: 'World objects',
  landmarks: 'Fast travel',
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const setSettings = useUiStore((s) => s.setSettings)
  const setAbout = useUiStore((s) => s.setAbout)

  return (
    <Modal open={open} onClose={() => setSettings(false)} title="Settings">
      {/* Mounted only while open, so each section reads what is stored at the
          moment the dialog is opened and not at page load. */}
      {open && (
        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h3 className="label mb-2">where things start</h3>
            <StartPrefs />
          </section>

          <section>
            <h3 className="label mb-2">your save, in this browser</h3>
            <SessionControls />
          </section>

          <section>
            <h3 className="label mb-2">game data</h3>
            <GameData />
          </section>

          <section>
            <h3 className="label mb-2">about</h3>
            <p className="text-[var(--color-muted)]">
              Where the game data comes from, what happens to your save, and the
              licence are in{' '}
              <button
                type="button"
                className="text-[var(--color-signal)] underline"
                onClick={() => {
                  setSettings(false)
                  setAbout(true)
                }}
              >
                Data sources and licence
              </button>
              .
            </p>
          </section>

          <section>
            <h3 className="label mb-2">not offered</h3>
            <p className="text-[var(--color-muted)]">
              There is no light theme: the interface is drawn dark throughout,
              not themed. And there is one language, because the names of pals,
              items and passives come from a source that is in English only.
            </p>
          </section>
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------
   Preferences
   ------------------------------------------------------------------------- */

function StartPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs())
  const save = (next: Partial<Prefs>) => setPrefs(writePrefs(next))
  const trayPinned = useUiStore((s) => s.trayPinned)
  const setTray = useUiStore((s) => s.setTray)

  const layers = new Set(prefs.mapLayers ?? DEFAULT_LAYERS)
  const custom = prefs.mapLayers !== undefined

  return (
    <div className="space-y-4">
      <SelectControl
        label="open on"
        value={prefs.defaultView ?? 'map'}
        onChange={(v) =>
          save({ defaultView: v === 'map' ? undefined : (v as ViewId) })
        }
        options={VIEW_IDS.map((id) => ({ value: id, label: VIEW_LABEL[id] }))}
        className="w-48"
      />

      <Checkbox
        checked={trayPinned}
        onChange={(pinned) => setTray({ pinned })}
        className="items-start text-[var(--color-muted)]"
        label={
          <span>
            <span className="text-[var(--color-text)]">
              Dock the utility tray
            </span>{' '}
            beside the view, where it stays open across reloads, instead of
            laying it over the top.
          </span>
        }
      />

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="label">the map starts with</span>
          {custom && (
            <Button size="sm" onClick={() => save({ mapLayers: undefined })}>
              Use the usual set
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {MAP_LAYER_IDS.map((id) => (
            <Checkbox
              key={id}
              checked={layers.has(id)}
              onChange={(on) => {
                const next = new Set(layers)
                if (on) next.add(id)
                else next.delete(id)
                save({ mapLayers: [...next] })
              }}
              label={LAYER_LABEL[id]}
              className="text-xs"
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">
          These are where a view starts. A link that says otherwise still wins,
          and so does whatever you change once you are there.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Game data
   ------------------------------------------------------------------------- */

/**
 * What game data this build reads, how old the cached copy is, and the two
 * things that can be done about it.
 */
function GameData() {
  const [info, setInfo] = useState<RefdataInfo>()
  const [busy, setBusy] = useState<'refresh' | 'clear'>()
  const [said, setSaid] = useState<string>()
  const refresh = useRefdataStore((s) => s.refresh)
  const status = useRefdataStore((s) => s.status)

  useEffect(() => {
    let live = true
    void refdataInfo().then((i) => {
      if (live) setInfo(i)
    })
    return () => {
      live = false
    }
  }, [busy])

  return (
    <>
      <p className="text-[var(--color-muted)]">
        Names, icons, tables and the map are fetched from the PalworldSaveTools
        mirror and kept in this browser so a second visit needs no network.
      </p>
      <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-[var(--color-muted)]">source</dt>
        <dd>PalworldSaveTools @ {info?.ref ?? '…'}</dd>
        <dt className="text-[var(--color-muted)]">format</dt>
        <dd>version {info?.version ?? '…'}</dd>
        <dt className="text-[var(--color-muted)]">cached</dt>
        <dd>
          {!info
            ? '…'
            : info.cachedAt
              ? relativeTime(new Date(info.cachedAt))
              : status === 'degraded'
                ? 'not cached: it could not be fetched'
                : 'not recorded'}
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={busy !== undefined}
          onClick={() => {
            setBusy('refresh')
            setSaid(undefined)
            void refresh()
              .then((ok) =>
                setSaid(
                  ok
                    ? 'fetched again just now'
                    : 'could not be fetched; the cached copy is unchanged',
                ),
              )
              .finally(() => setBusy(undefined))
          }}
        >
          {busy === 'refresh' ? 'Fetching…' : 'Refresh'}
        </Button>
        <Button
          size="sm"
          disabled={busy !== undefined}
          onClick={() => {
            setBusy('clear')
            setSaid(undefined)
            void clearCache()
              .then((n) => setSaid(`freed ${bytes(n)} · reload to refetch`))
              .finally(() => setBusy(undefined))
          }}
        >
          {busy === 'clear' ? 'Clearing…' : 'Clear cached game data'}
        </Button>
        {said && <span className="label normal-case">{said}</span>}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------
   The save and the paths
   ------------------------------------------------------------------------- */

/**
 * The saved-session controls.
 *
 * Sits above the game-data section, and is worded so the two buttons cannot be
 * confused: one deletes a copy of *your world*, the other deletes downloaded
 * *Pocketpair art*. Both used to be one vague idea of "cached data".
 *
 * Turning the toggle off deletes the snapshot there and then rather than
 * merely stopping future writes — "stop remembering my saves" that leaves
 * three megabytes of parsed world on disk is the failure this whole feature is
 * negotiating around.
 */
function SessionControls() {
  const [pref, setPref] = useState(() => rememberPref())
  const [descriptor, setDescriptor] = useState(() => sessionDescriptor())

  const toggle = (on: boolean) => {
    setPref(on ? 'on' : 'off')
    void setRememberPref(on)
      // Turning it on with a save already open should have a visible effect
      // now, rather than at some later merge that may never happen.
      .then(() => (on ? flushSessionWrite() : undefined))
      .then(() => setDescriptor(sessionDescriptor()))
  }

  return (
    <>
      <Checkbox
        checked={pref === 'on'}
        onChange={toggle}
        className="items-start text-[var(--color-muted)]"
        label={
          <span>
            Keep the save I have open in this browser, so it comes back after a
            reload. It is stored on this machine only and still never uploaded.
            Only the most recent save is kept.{' '}
            <span className="text-[var(--color-text)]">
              Turning this off deletes what is stored.
            </span>
          </span>
        }
      />

      {descriptor && pref === 'on' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            tone="danger"
            onClick={() => {
              void forgetSession().then(() =>
                setDescriptor(sessionDescriptor()),
              )
            }}
          >
            Forget this save
          </Button>
          <span className="label">
            <span className="num">{descriptor.fileName}</span> ·{' '}
            {bytes(descriptor.fileBytes)} ·{' '}
            {relativeTime(new Date(descriptor.savedAt))}
          </span>
        </div>
      )}

      <SavedPathsControl />
    </>
  )
}

/**
 * The other thing this browser may be holding: breeding paths saved from the
 * tray. Listed here, beside the saved session, because it is the same question
 * — what of mine is stored — and deserves the same one-press answer.
 */
function SavedPathsControl() {
  const n = usePathsStore((s) => s.paths.length)
  const writable = usePathsStore((s) => s.writable)
  const clear = usePathsStore((s) => s.clear)
  // An unreadable list still counts as something stored.
  if (n === 0 && writable) return null

  return (
    <div className="mt-4">
      <p className="text-[var(--color-muted)]">
        Breeding paths you save are kept in this browser too, each as a name and
        the link the Breed view would show for it. That link includes shortened
        ids for the player and any pals it names.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" tone="danger" onClick={clear}>
          Forget saved paths
        </Button>
        <span className="label">
          {writable ? (
            <>
              <span className="num">{n}</span> saved
            </>
          ) : (
            'saved by a newer version'
          )}
        </span>
      </div>
    </div>
  )
}
