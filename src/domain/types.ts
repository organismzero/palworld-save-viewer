/**
 * The slim domain model.
 *
 * Design rule: **flat, plain and structured-cloneable.** No `Map`s on the wire,
 * no class instances, no cyclic references — cross-entity links are GUID
 * strings, and the main thread builds its `Map` indexes on receipt (a few ms
 * for ~1,100 entries). Numbers arrive pre-scaled (HP already divided by 1000)
 * and every GUID pre-normalised.
 *
 * That discipline is what keeps the ~170 MB raw GVAS tree inside the worker:
 * the payload that actually crosses to the UI measures ~1.8 MB for a full save,
 * against a 74 MB input. `test/golden/level.golden.test.ts` pins it.
 */

import type { Guid } from '../parse/guid.ts'
import type { MapKind, MapPos, Vec3 } from './coords.ts'
import type { StatusKey } from './statusNames.ts'

export type { Guid } from '../parse/guid.ts'
export type { MapKind, MapPos, Vec3 } from './coords.ts'

export type Gender = 'Male' | 'Female'

export interface Pal {
  instanceId: Guid
  /** Species asset id with any `BOSS_` prefix stripped, e.g. `"SamuraiDog"`. */
  characterId: string
  /** True when the raw `CharacterID` carried the `BOSS_` prefix (alphas/bosses). */
  isBoss: boolean
  isRare: boolean
  nickname?: string
  gender?: Gender
  level: number
  exp: number
  /** Condensing ("souls") rank, 0–4. Present on very few pals. */
  rank: number
  rankAttack: number
  rankDefence: number
  rankHp: number
  rankCraftSpeed: number
  /** IVs, 0–100. `Talent_Shot` is the attack IV despite the name. */
  ivHp?: number
  ivAttack?: number
  ivDefense?: number
  /** Current HP, already divided out of the save's FixedPoint64 ×1000 form. */
  hp?: number
  fullStomach?: number
  sanity?: number
  friendship?: number
  /** Raw passive asset ids; resolved to names via reference data. */
  passives: string[]
  /** Equipped active skills, enum tails. */
  equipWaza: string[]
  masteredWaza: string[]
  /** `GotWorkSuitabilityAddRankList` — work-suitability bonuses above base. */
  workSuitabilityBonus: Record<string, number>
  ownerPlayerUid?: Guid
  oldOwnerUids: Guid[]
  /** Guild link, read from `RawData.group_id` (a sibling of `object`). */
  groupId?: Guid
  containerId?: Guid
  slotIndex?: number
  /** `LastJumpedLocation` — the only position the save records for a pal. */
  pos?: Vec3
  /**
   * .NET ticks since year 1. Past `Number.MAX_SAFE_INTEGER`, so already
   * rounded by `JSON.parse` — fine for display via `ticksToDate`, never safe
   * to compare for equality. */
  ownedTime?: number
  /**
   * `WorkerSick` is an enum naming the illness (e.g. `"DepressionSprain"`),
   * not a boolean. Absent on healthy pals.
   */
  sickness?: string
  /** `PhysicalHealth`, e.g. `"Dying"`. Absent when healthy. */
  physicalHealth?: string
  /** Work type the pal is currently assigned to, when it is working. */
  currentWork?: string
  skinCharacterId?: string
}

export interface Player {
  playerUid: Guid
  instanceId: Guid
  name: string
  level: number
  exp: number
  hp?: number
  shieldHp?: number
  fullStomach?: number
  statusPoints: Partial<Record<StatusKey, number>>
  exStatusPoints: Record<string, number>
  /**
   * `LastJumpedLocation` — a fallback, not a real position. The only true
   * player position lives in `Players/<uid>.sav`; see {@link PlayerDetail.pos}.
   */
  pos?: Vec3
  groupId?: Guid
}

/* -------------------------------------------------------------------------
   Player saves — everything only `Players/<uid>.json` knows
   ------------------------------------------------------------------------- */

export type PlayerPlatform = 'Steam' | 'PS5' | 'Xbox' | 'Mac' | 'Unknown'

/** The six item containers every player carries. */
export type PlayerContainerSlot =
  | 'main' // CommonContainerId — 10–41 slots observed
  | 'essential' // EssentialContainerId — key items
  | 'weapon' // WeaponLoadOutContainerId
  | 'equip' // PlayerEquipArmorContainerId
  | 'food' // FoodEquipContainerId
  | 'drop' // DropSlotContainerId — always empty, but always present

export interface PlayerRecord {
  /** Sum over `PalCaptureCount`. */
  palsCaught: number
  /** Distinct species in `PalCaptureCount`. */
  speciesCaught: number
  /** `PaldeckUnlockFlag` entries that are true. */
  paldexUnlocked: number
  captureCountBySpecies: Record<string, number>
  tribesCaught?: number
  bossesDefeated: number
  towerBossesDefeated: number
  relicsFound?: number
  fastTravelUnlocked: number
  normalDungeonsCleared?: number
  fixedDungeonsCleared?: number
  itemsCrafted: number
  npcsTalkedTo: number
  /** Fields a newer game version added; absent on older saves. */
  predatorsDefeated?: number
  palsButchered: number
  fishCaught: number
  /** Sum of `PalRankupCount` — pals put through the condenser. */
  palsCondensed: number
}

export interface PlayerDetail {
  playerUid: Guid
  /** `IndividualId.InstanceId` — the authoritative link to the live body. */
  instanceId?: Guid
  /**
   * Absolute .NET ticks since year 1 — a real wall clock, unlike the guild's
   * `last_online_real_time`. Past `Number.MAX_SAFE_INTEGER`, so already
   * rounded by `JSON.parse`: safe to display, never to compare for equality.
   */
  lastOnlineTicks?: number
  /**
   * This file's own `properties.Timestamp`. Measured 2.44 h later than the
   * level file's, so the two are not one snapshot and must not be shown as one.
   */
  savedAtTicks?: number
  platform: PlayerPlatform
  /** Absent on 1 of 10 reference players — `undefined` and `0` differ. */
  technologyPoints?: number
  bossTechnologyPoints?: number
  /** `LastTransform.Translation` — the only true player position in any save. */
  pos?: Vec3
  palboxContainerId?: Guid
  otomoContainerId?: Guid
  otomoOrder?: string
  inventory: Partial<Record<PlayerContainerSlot, Guid>>
  unlockedRecipes: string[]
  record: PlayerRecord
  /** Provenance, for the diagnostics panel. */
  sourceFileName: string
}

export interface GuildMarker {
  markerId: Guid
  icon: number
  pos: Vec3
  ownerPlayerUid?: Guid
}

/** Guild roles: 1 = master, 2 = officer, 3 = member, 4 = unassigned. */
export type GuildRole = 1 | 2 | 3 | 4

export interface GuildMember {
  playerUid: Guid
  name: string
  role?: GuildRole
  /**
   * Raw `last_online_real_time`. Unlike a pal's `OwnedTime`, this is *not*
   * .NET ticks since year 1 — observed values (~4.7e12) are far too small for
   * that, and their epoch is unidentified. Stored raw and left uninterpreted
   * until it can be pinned down; ordering by it is safe, absolute dates are
   * not.
   */
  lastOnlineTicks?: number
}

export interface Guild {
  groupId: Guid
  /**
   * Most groups in a save are `Organization` bookkeeping entries with no
   * members; only `Guild` entries are player guilds. The dashboard hides empty
   * Organizations by default — showing them makes the app look broken.
   */
  type: 'Guild' | 'Organization'
  name: string
  adminPlayerUid?: Guid
  members: GuildMember[]
  playerUids: Guid[]
  memberCount: number
  characterHandleIds: Guid[]
  baseIds: Guid[]
  baseCampLevel: number
  markers: GuildMarker[]
  /** Post-2026-07 guild tail, detected by the presence of `role_permissions`. */
  hasV2Tail: boolean
}

export interface Base {
  baseId: Guid
  /**
   * The raw name is a Japanese placeholder
   * (`新規生成拠点テンプレート名1(仮)`, "new base template name 1
   * (provisional)"), so the UI names bases by their nearest landmark instead.
   */
  rawName: string
  groupId?: Guid
  pos: Vec3
  areaRange: number
  ownerMapObjectInstanceId?: Guid
  /** `WorkerDirector` container holding this base's assigned worker pals. */
  workerContainerId?: Guid
  workIds: Guid[]
  state?: number
}

export interface Structure {
  instanceId: Guid
  /** e.g. `"ItemChest"`, `"DamagableRock0002"`; matches `world.json` assets. */
  mapObjectId: string
  concreteModelType?: string
  pos: Vec3
  hpCurrent?: number
  hpMax?: number
  baseCampId?: Guid
  groupId?: Guid
  buildPlayerUid?: Guid
  /** From the `ItemContainer` module — the chest → inventory link. */
  containerId?: Guid
  workId?: Guid
  locked: boolean
  /** True when the object belongs to a base camp rather than the world. */
  isBuilt: boolean
}

export interface ItemStack {
  slot: number
  staticId: string
  count: number
  /** Resolves into `DynamicItemSaveData` for durability, ammo, per-item passives. */
  dynamicLocalId?: Guid
}

export type OwnerKind = 'structure' | 'player' | 'guild' | 'pal' | 'unknown'

export interface Container {
  containerId: Guid
  slots: ItemStack[]
  belongGroupId?: Guid
  ownerKind: OwnerKind
  ownerId?: Guid
  /** Which of a player's six containers this is, once a player save says so. */
  ownerSlot?: PlayerContainerSlot
  /**
   * Containers do not record their owner, so attribution from `Level.json`
   * alone is guesswork. A loaded player save upgrades its six containers to
   * `exact`; everything else stays `inferred` and the UI says so.
   */
  confidence: 'exact' | 'inferred'
  slotCount: number
  usedSlots: number
}

/**
 * Pal storage: palboxes, parties and base worker rosters. Distinct from
 * `Container`, which holds items — a pal's `containerId` always points here.
 */
export interface CharacterContainer {
  containerId: Guid
  slots: { slot: number; instanceId: Guid; playerUid?: Guid }[]
  /** Inferred from the pals inside, or exact once a player save names it. */
  ownerPlayerUid?: Guid
  /** Set once the owning base is known; identifies a worker roster. */
  ownerBaseId?: Guid
  /** Distinguishes a palbox from a party — the vote alone cannot. */
  ownerSlot?: 'palbox' | 'party' | 'workers'
  confidence: 'exact' | 'inferred'
}

export interface DynamicItem {
  localId: Guid
  staticId?: string
  kind?: string
  durability?: number
  ammo?: number
  passives: string[]
}

export interface Dungeon {
  instanceId: Guid
  type?: string
  area?: string
  levelName?: string
  bossState?: string
  markerPointId?: Guid
  pos?: Vec3
}

/* -------------------------------------------------------------------------
   Aggregates
   ------------------------------------------------------------------------- */

export interface SaveWarning {
  kind:
    | 'unknown-concrete-model'
    | 'missing-save-parameter'
    | 'dangling-container'
    | 'dangling-group'
    | 'dangling-base'
    | 'unreadable-entry'
    /** A RecordData field we do not read yet — the cheapest format canary. */
    | 'unknown-record-field'
    | 'unknown-platform'
    /** Two exact sources disagree; that is news, not noise. */
    | 'ownership-conflict'
    /** A `LocalData` `SaveData` key we do not read yet. Same canary role. */
    | 'unknown-local-field'
    /** A fog mask keyed by a map this build has never heard of. */
    | 'unknown-map-mask'
    /** A fog mask whose byte count is not four times a square. */
    | 'malformed-map-mask'
  detail: string
  count: number
}

export interface SaveStats {
  characters: number
  pals: number
  players: number
  species: number
  guilds: number
  organizations: number
  bases: number
  structures: number
  containers: number
  /** `confidence === 'exact'`. */
  attributedExact: number
  /** Attributed, but by heuristic. */
  attributedInferred: number
  /** `ownerKind === 'unknown'`. The number player saves actually improve. */
  unattributedContainers: number
  /**
   * Containers no map object claims. Retained as a format canary — note this
   * does *not* move when player saves load, by definition.
   */
  orphanContainers: number
  charContainers: number
  dynamicItems: number
  dungeons: number
  /** Player saves merged, against how many the level expects. */
  playerDetails: number
  playersInLevel: number
  /**
   * First-class output, not an afterthought. Palworld ships save-format
   * changes every few months; surfacing these in a diagnostics popover is how
   * we find out fast rather than via a blank screen.
   */
  warnings: SaveWarning[]
}

/** Exactly what crosses from the worker to the main thread. */
export interface SlimPayload {
  pals: Pal[]
  players: Player[]
  guilds: Guild[]
  bases: Base[]
  structures: Structure[]
  containers: Container[]
  charContainers: CharacterContainer[]
  dynamicItems: DynamicItem[]
  dungeons: Dungeon[]
  /** Empty from a level-only parse; filled as player saves are merged. */
  playerDetails: PlayerDetail[]
  stats: SaveStats
  meta: SaveMeta
}

export interface SaveMeta {
  /** From the GVAS header, e.g. `"++UE5+Release-5.1"`. */
  engineVersion?: string
  saveGameVersion?: number
  /** `properties.Timestamp` — absolute .NET ticks when this file was written. */
  savedAtTicks?: number
  /**
   * `GameTimeSaveData.RealDateTimeTicks` — server **uptime**, not a wall clock.
   * It stops while the server is down, so it can never be converted to a date;
   * measured error against a real timestamp reaches 52 hours.
   */
  worldUptimeTicks?: number
  /** `GameTimeSaveData.GameDateTimeTicks` — in-world time. */
  gameTimeTicks?: number
  /** Which path produced this tree; both yield an identical `SaveIndex`. */
  source: 'json' | 'sav'
}

/* -------------------------------------------------------------------------
   `LocalData.sav` — the client's own file
   ------------------------------------------------------------------------- */

/**
 * One map's fog of war, as the game stores it.
 *
 * The save holds an RGBA texture whose **alpha channel is the fog**: 255 is
 * unexplored, 0 is explored, and the values between are the soft edge the game
 * paints as you walk. RGB is zero throughout and carries nothing, so the reader
 * keeps alpha alone — a quarter of the bytes for all of the information.
 *
 * `alpha` is row-major from the top-left and maps onto map space by exactly the
 * transform every marker already uses: `mapToPixel(mx, my, size, size)`, no
 * flip and no offset. `test/golden/localData.golden.test.ts` pins that against
 * every player-built structure in the reference save.
 */
export interface FogMask {
  map: MapKind
  /** Edge length in pixels. 1024 for the overworld, 512 for the World Tree. */
  size: number
  alpha: Uint8Array
  /** Fraction of the texture that is explored, 0–1. */
  exploredFraction: number
}

/** A pin the player dropped on their map by hand. */
export interface CustomMarker {
  pos: Vec3
  at: MapPos
  /**
   * The game's icon index. Left as a number: there is no name table for it in
   * any reference data this project has, and inventing labels would be a guess.
   */
  iconType: number
}

/**
 * A saved party preset.
 *
 * The file embeds a whole `PalSaveParameter` copy per slot, but it also carries
 * the pal's instance GUID — and every one of them resolves against the level
 * save. So this stores references and throws the copies away: no duplicate pal
 * records to drift out of step with the real ones.
 */
export interface OtomoPreset {
  name: string
  palIds: Guid[]
}

/**
 * Everything read out of `LocalData.sav`.
 *
 * Deliberately **not** part of {@link SlimPayload}. That payload is cloned into
 * a `SaveIndex` on arrival, and a megabyte of fog mask has no business going
 * through that; this travels beside it and its mask buffers are transferred,
 * not copied.
 *
 * One file describes one client. On a shared world it is one player's
 * exploration and one player's progress, never the server's.
 */
export interface LocalDataPayload {
  fileName: string
  fog: FogMask[]
  markers: CustomMarker[]
  presets: OtomoPreset[]
  trackingQuestId?: string
  paldeckEncountered: number
  techsUnlocked: number
  buildsUnlocked: number
  hiddenLocations: number
  tutorialsSeen: number
  /**
   * Whose client this is, inferred on the main thread: the owner every pal in
   * every party preset agrees on. Undefined when they disagree, when none
   * resolve, or when there are no presets — the file itself names nobody.
   */
  ownerUid?: Guid
  /** Surfaced in Diagnostics alongside the level save's own. */
  warnings: SaveWarning[]
}

/** The main-thread view: flat arrays plus the derived lookup indexes. */
export interface SaveIndex extends SlimPayload {
  palById: Map<Guid, Pal>
  playerByUid: Map<Guid, Player>
  guildById: Map<Guid, Guild>
  baseById: Map<Guid, Base>
  structureById: Map<Guid, Structure>
  containerById: Map<Guid, Container>
  charContainerById: Map<Guid, CharacterContainer>
  dynamicItemById: Map<Guid, DynamicItem>

  palsByOwner: Map<Guid, Pal[]>
  palsByContainer: Map<Guid, Pal[]>
  palsByGuild: Map<Guid, Pal[]>
  /** Species → its pals. Makes "Kitsunebi × 37" grouping instant. */
  palsByCharacterId: Map<string, Pal[]>
  structuresByBase: Map<Guid, Structure[]>
  structuresByGuild: Map<Guid, Structure[]>
  containerByStructure: Map<Guid, Guid>
  structureByContainer: Map<Guid, Guid>
  basesByGuild: Map<Guid, Base[]>
  playersByGuild: Map<Guid, Player[]>
  /** Inverted index powering global item search: item id → where it is. */
  containersByItem: Map<string, { containerId: Guid; count: number }[]>
}

/** Positions, resolved to map space. Computed lazily by the map view. */
export interface Placed<T> {
  entity: T
  at: MapPos
}
