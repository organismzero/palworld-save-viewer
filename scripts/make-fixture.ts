/**
 * Generates `test/fixtures/level.mini.json` from a real `data/Level.json`.
 *
 *     pnpm fixture
 *
 * The output is a **redacted structural subset**: real shapes, real sparsity,
 * real cross-links — but no personal data and no bulk. That combination is
 * what lets the reader tests run on a machine with no save file, which is
 * every contributor's machine and all of CI.
 *
 * Two properties make it safe to commit:
 *
 * 1. **Every GUID is deterministically remapped.** The same input GUID always
 *    yields the same output GUID, so links between sections survive the
 *    redaction intact. Nothing traceable to the original world remains.
 * 2. **Every human name is replaced** with a fixture name.
 *
 * Entities are chosen to span the sparsity spectrum rather than sampled at
 * random — the whole point is to include the pal with almost no fields set,
 * the alpha, the nicknamed one, and one of each map-object module type.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SOURCE = resolve(process.cwd(), 'data/Level.json')
const OUT = resolve(process.cwd(), 'test/fixtures/level.mini.json')

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const ZERO = '00000000-0000-0000-0000-000000000000'

/**
 * GUIDs also appear **unhyphenated** in a few places — most importantly a
 * guild's `group_name`, which is its admin's player UID with the hyphens
 * stripped and upper-cased. Those bypass `GUID_RE` entirely, so they need
 * their own pattern or a real player identifier ships in the fixture.
 */
const BARE_GUID_RE = /^[0-9a-fA-F]{32}$/

const PLAYER_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Edsger',
  'Barbara',
  'Donald',
  'Ken',
  'Dennis',
  'Margaret',
  'Linus',
]
const PAL_NICKNAMES = ['Biscuit', 'Waffle', 'Pepper', 'Marble']

/* -------------------------------------------------------------------------
   Deterministic GUID remapping
   ------------------------------------------------------------------------- */

/** FNV-1a, seeded, so one source GUID always maps to one output GUID. */
function hash32(input: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const guidCache = new Map<string, string>()

function remapGuid(guid: string): string {
  if (guid === ZERO) return ZERO
  const cached = guidCache.get(guid)
  if (cached) return cached

  const key = guid.toLowerCase()
  const hex = [0, 1, 2, 3]
    .map((i) => hash32(key, i).toString(16).padStart(8, '0'))
    .join('')
  const out = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')

  guidCache.set(guid, out)
  return out
}

/** Keys whose string values are human names and must be replaced wholesale. */
const NAME_KEYS = new Set([
  'NickName',
  'FilteredNickName',
  'player_name',
  'guild_name',
  'DebugName',
])

/**
 * A chest's `PasswordLock.password` is a real secret the player typed, and
 * people reuse passwords. It is replaced rather than blanked, because the
 * reader distinguishes locked from unlocked by whether it is empty.
 */
const FIXTURE_PASSWORD = 'fixture-password'

let playerNameIndex = 0
let palNameIndex = 0
const nameCache = new Map<string, string>()

function redactName(original: string, key: string): string {
  if (!original) return original
  const cached = nameCache.get(original)
  if (cached) return cached

  let replacement: string
  if (key === 'guild_name') {
    replacement = 'The Fixture Guild'
  } else if (key === 'player_name') {
    replacement = PLAYER_NAMES[playerNameIndex++ % PLAYER_NAMES.length]!
  } else {
    replacement = PAL_NICKNAMES[palNameIndex++ % PAL_NICKNAMES.length]!
  }
  nameCache.set(original, replacement)
  return replacement
}

/** Rewrites GUIDs and names throughout a subtree, in place on a fresh copy. */
function redact(node: unknown, key = ''): unknown {
  if (typeof node === 'string') {
    if (GUID_RE.test(node)) return remapGuid(node)
    if (BARE_GUID_RE.test(node)) {
      // Re-hyphenate so it maps through the same table as its hyphenated
      // twin — a guild's group_name and its admin_player_uid must stay
      // consistent — then restore the original spelling.
      const hyphenated = [
        node.slice(0, 8),
        node.slice(8, 12),
        node.slice(12, 16),
        node.slice(16, 20),
        node.slice(20, 32),
      ].join('-')
      const mapped = remapGuid(hyphenated).replace(/-/g, '')
      return node === node.toUpperCase() ? mapped.toUpperCase() : mapped
    }
    if (NAME_KEYS.has(key)) return redactName(node, key)
    if (key === 'password') return node ? FIXTURE_PASSWORD : node
    return node
  }
  if (Array.isArray(node)) return node.map((n) => redact(n, key))
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      // A GVAS wrapper puts the payload at `.value`, so carry the property
      // name down through it or NickName's string is never seen as a name.
      out[k] = redact(v, k === 'value' || k === 'values' ? key : k)
    }
    return out
  }
  return node
}

/* -------------------------------------------------------------------------
   Selection
   ------------------------------------------------------------------------- */

const sp = (entry: any) =>
  entry?.value?.RawData?.value?.object?.SaveParameter?.value

/** Scores a pal by how many optional fields it carries. */
const richness = (entry: any) => Object.keys(sp(entry) ?? {}).length

function pickPals(characters: any[]): any[] {
  const pals = characters.filter((c) => !sp(c)?.IsPlayer?.value)
  const chosen = new Map<any, true>()

  const take = (entry: any | undefined) => {
    if (entry) chosen.set(entry, true)
  }

  const sorted = [...pals].sort((a, b) => richness(b) - richness(a))
  // The extremes of the sparsity spectrum matter most - they are what break
  // naive readers.
  take(sorted[0])
  take(sorted[sorted.length - 1])
  take(pals.find((c) => sp(c)?.CharacterID?.value?.startsWith('BOSS_')))
  take(pals.find((c) => sp(c)?.NickName?.value))
  take(pals.find((c) => sp(c)?.Rank?.value?.value > 0))
  take(pals.find((c) => sp(c)?.IsRarePal?.value))
  take(pals.find((c) => sp(c)?.WorkerSick))
  take(pals.find((c) => sp(c)?.PassiveSkillList?.value?.values?.length >= 3))
  take(pals.find((c) => !sp(c)?.OwnerPlayerUId))
  take(pals.find((c) => sp(c)?.GotWorkSuitabilityAddRankList))

  // Pad to a round dozen with ordinary specimens.
  for (const pal of pals) {
    if (chosen.size >= 12) break
    chosen.set(pal, true)
  }
  return [...chosen.keys()]
}

function pickMapObjects(objects: any[]): any[] {
  const moduleOf = (o: any, type: string) =>
    (o?.ConcreteModel?.value?.ModuleMap?.value ?? []).some((m: any) =>
      m?.key?.endsWith('::' + type),
    )

  const chosen = new Map<any, true>()
  const take = (o: any | undefined) => {
    if (o) chosen.set(o, true)
  }

  // One of every module type, so the reader's dispatch is fully exercised.
  for (const type of [
    'ItemContainer',
    'StatusObserver',
    'Workee',
    'Energy',
    'PasswordLock',
    'GuildSecurity',
    'Switch',
    'RequireElementalAction',
  ]) {
    take(objects.find((o) => moduleOf(o, type)))
  }
  // A `PasswordLock` module is not the same thing as a locked object: nearly
  // every one of them carries `lock_state: 1` and no password. Take one that
  // is genuinely locked so the reader's actual test — a non-empty password —
  // is exercised rather than only its default.
  take(
    objects.find((o) =>
      (o?.ConcreteModel?.value?.ModuleMap?.value ?? []).some(
        (m: any) =>
          m?.key?.endsWith('::PasswordLock') &&
          m?.value?.RawData?.value?.password,
      ),
    ),
  )
  take(
    objects.find(
      (o) => o?.Model?.value?.RawData?.value?.base_camp_id_belong_to !== ZERO,
    ),
  )
  take(
    objects.find((o) => {
      const hp = o?.Model?.value?.RawData?.value?.hp
      return hp && hp.current < hp.max
    }),
  )

  for (const o of objects) {
    if (chosen.size >= 20) break
    chosen.set(o, true)
  }
  return [...chosen.keys()]
}

/* -------------------------------------------------------------------------
   Verification
   ------------------------------------------------------------------------- */

/**
 * Refuses to write a fixture that still contains anything from the source.
 *
 * This exists because the first version of this script shipped a real player
 * UID: a guild's `group_name` is its admin's UID with the hyphens stripped,
 * which slipped past a hyphen-requiring GUID pattern. A redaction routine that
 * is only as good as its list of patterns needs a check that does not depend
 * on that list being complete — so this compares the output against the source
 * directly, and aborts rather than writing.
 */
function verifyRedaction(output: string, source: string): void {
  const problems: string[] = []
  const zeroBare = '0'.repeat(32)

  const candidates = new Set<string>()
  for (const m of output.match(/"[^"]{8,}"/g) ?? []) {
    const value = m.slice(1, -1)
    if (GUID_RE.test(value) && value !== ZERO) candidates.add(value)
    else if (BARE_GUID_RE.test(value) && value !== zeroBare)
      candidates.add(value)
  }

  const lowerSource = source.toLowerCase()
  for (const value of candidates) {
    if (lowerSource.includes(value.toLowerCase())) {
      problems.push(`identifier survived redaction: ${value}`)
    }
  }

  for (const key of NAME_KEYS) {
    // Every retained name must be one we substituted, never a real one.
    const allowed = new Set([
      ...PLAYER_NAMES,
      ...PAL_NICKNAMES,
      'The Fixture Guild',
      '',
    ])
    const re = new RegExp(
      `"${key}"\\s*:\\s*(?:\\{[^{}]*"value"\\s*:\\s*)?"([^"]*)"`,
      'g',
    )
    for (const m of output.matchAll(re)) {
      const name = m[1]!
      if (!allowed.has(name) && !BARE_GUID_RE.test(name)) {
        problems.push(`unredacted ${key}: ${JSON.stringify(name)}`)
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      'Refusing to write the fixture — redaction is incomplete:\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    )
    process.exit(1)
  }
  console.log(
    `redaction verified: ${candidates.size} identifiers, all remapped`,
  )
}

/* -------------------------------------------------------------------------
   Main
   ------------------------------------------------------------------------- */

function main() {
  if (!existsSync(SOURCE)) {
    console.error(
      `No save at ${SOURCE}.\n` +
        'Drop a converted Level.json into data/ first — see the README.',
    )
    process.exit(1)
  }

  console.log(`reading ${SOURCE} …`)
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8'))
  const wsd = raw?.properties?.worldSaveData?.value
  if (!wsd) {
    console.error('properties.worldSaveData is missing — is this a Level save?')
    process.exit(1)
  }

  const characters: any[] = wsd.CharacterSaveParameterMap?.value ?? []
  const players = characters.filter((c) => sp(c)?.IsPlayer?.value).slice(0, 2)
  const pals = pickPals(characters)
  const keptCharacters = [...players, ...pals]

  const mapObjects = pickMapObjects(wsd.MapObjectSaveData?.value?.values ?? [])

  // Keep containers the retained entities actually reference, so the fixture's
  // cross-links resolve rather than dangling.
  const wantedContainers = new Set<string>()
  for (const o of mapObjects) {
    for (const m of o?.ConcreteModel?.value?.ModuleMap?.value ?? []) {
      const id = m?.value?.RawData?.value?.target_container_id
      if (id && id !== ZERO) wantedContainers.add(id)
    }
  }
  const wantedCharContainers = new Set<string>()
  for (const c of keptCharacters) {
    const id = sp(c)?.SlotId?.value?.ContainerId?.value?.ID?.value
    if (id && id !== ZERO) wantedCharContainers.add(id)
  }

  const bases = (wsd.BaseCampSaveData?.value ?? []).slice(0, 1)
  for (const b of bases) {
    const id = b?.value?.WorkerDirector?.value?.RawData?.value?.container_id
    if (id && id !== ZERO) wantedCharContainers.add(id)
  }

  const itemContainers = (wsd.ItemContainerSaveData?.value ?? [])
    .filter((c: any) => wantedContainers.has(c?.key?.ID?.value))
    .slice(0, 5)
  // Include one orphan so ownership inference has something to chew on.
  const orphan = (wsd.ItemContainerSaveData?.value ?? []).find(
    (c: any) => !wantedContainers.has(c?.key?.ID?.value),
  )
  if (orphan) itemContainers.push(orphan)

  // Palboxes run to hundreds of slots and would dominate the fixture. Keep
  // only the slots pointing at pals we retained, plus a couple of others for
  // shape - a full 211-slot roster proves nothing the first dozen do not.
  const keptInstanceIds = new Set(
    keptCharacters.map((c) => c?.key?.InstanceId?.value).filter(Boolean),
  )
  const charContainers = (wsd.CharacterContainerSaveData?.value ?? [])
    .filter((c: any) => wantedCharContainers.has(c?.key?.ID?.value))
    .map((c: any) => {
      const slots: any[] = c?.value?.Slots?.value?.values ?? []
      const relevant = slots.filter((s) =>
        keptInstanceIds.has(s?.RawData?.value?.instance_id),
      )
      const filler = slots
        .filter((s) => !keptInstanceIds.has(s?.RawData?.value?.instance_id))
        .slice(0, 2)
      return {
        ...c,
        value: {
          ...c.value,
          Slots: {
            ...c.value.Slots,
            value: {
              ...c.value.Slots.value,
              values: [...relevant, ...filler],
            },
          },
        },
      }
    })

  // Guilds keep their structure but not their thousand handle ids. Their
  // base_ids are filtered to the bases actually retained — otherwise the
  // fixture ships a dangling reference, and "parses without warnings" stops
  // being a meaningful assertion.
  const keptBaseIds = new Set(
    bases.map((b: any) => b?.value?.RawData?.value?.id).filter(Boolean),
  )
  const groups = (wsd.GroupSaveDataMap?.value ?? []).map((g: any) => {
    const rd = g?.value?.RawData?.value
    if (!rd) return g
    return {
      ...g,
      value: {
        ...g.value,
        RawData: {
          ...g.value.RawData,
          value: {
            ...rd,
            ...(rd.individual_character_handle_ids && {
              individual_character_handle_ids:
                rd.individual_character_handle_ids.slice(0, 8),
            }),
            ...(rd.base_ids && {
              base_ids: rd.base_ids.filter((id: string) => keptBaseIds.has(id)),
            }),
          },
        },
      },
    }
  })

  const mini = {
    header: raw.header,
    properties: {
      Version: raw.properties.Version,
      Timestamp: raw.properties.Timestamp,
      worldSaveData: {
        ...raw.properties.worldSaveData,
        value: {
          CharacterSaveParameterMap: {
            ...wsd.CharacterSaveParameterMap,
            value: keptCharacters,
          },
          MapObjectSaveData: {
            ...wsd.MapObjectSaveData,
            value: { ...wsd.MapObjectSaveData.value, values: mapObjects },
          },
          BaseCampSaveData: { ...wsd.BaseCampSaveData, value: bases },
          ItemContainerSaveData: {
            ...wsd.ItemContainerSaveData,
            value: itemContainers,
          },
          CharacterContainerSaveData: {
            ...wsd.CharacterContainerSaveData,
            value: charContainers,
          },
          GroupSaveDataMap: { ...wsd.GroupSaveDataMap, value: groups },
          DynamicItemSaveData: {
            ...wsd.DynamicItemSaveData,
            value: {
              ...wsd.DynamicItemSaveData.value,
              values: (wsd.DynamicItemSaveData.value?.values ?? []).slice(0, 3),
            },
          },
          DungeonSaveData: {
            ...wsd.DungeonSaveData,
            value: {
              ...wsd.DungeonSaveData.value,
              values: (wsd.DungeonSaveData.value?.values ?? []).slice(0, 2),
            },
          },
        },
      },
    },
    trailer: raw.trailer,
  }

  const redacted = redact(mini)
  const text = JSON.stringify(redacted)

  verifyRedaction(text, readFileSync(SOURCE, 'utf8'))

  mkdirSync(dirname(OUT), { recursive: true })
  // Written compact: indentation roughly doubles the committed size, and this
  // file is read by the parser, not by people.
  writeFileSync(OUT, text + '\n')

  const bytes = readFileSync(OUT).length
  console.log(
    `wrote ${OUT}\n` +
      `  ${keptCharacters.length} characters (${players.length} players, ${pals.length} pals)\n` +
      `  ${mapObjects.length} map objects, ${itemContainers.length} item containers,\n` +
      `  ${charContainers.length} pal containers, ${bases.length} base, ${groups.length} groups\n` +
      `  ${guidCache.size} GUIDs remapped, ${nameCache.size} names replaced\n` +
      `  ${(bytes / 1024).toFixed(0)} KB`,
  )
}

main()
