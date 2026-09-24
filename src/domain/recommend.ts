/**
 * Which pals, and which passives on them, suit a purpose.
 *
 * ## Worked out, not looked up
 *
 * There is no tier list in here and no pal is named anywhere. Every ranking is
 * computed from the game's own tables as PalworldSaveTools exports them:
 *
 * - **Workers** by the species' work-suitability level, then its `craft_speed`,
 *   then how little it eats (`food_amount`).
 * - **Fighters** by how hard their element hits the opponent's, then how little
 *   the opponent's hits them back, then base `shot_attack`.
 * - **Mounts** by `ride_sprint_speed`, split by the kind of mount the
 *   partner-skill text says it is.
 * - **Passives** by what they do (`efftype`), by how much (`effect`) and, the
 *   part that decides party against base, on whom (`target_type`): an effect on
 *   the trainer only helps while the pal is out with you, and one on a building
 *   only helps at a base.
 *
 * The one input that is not data is the element chart in `typeChart.ts`.
 *
 * ## How a passive is scored
 *
 * Each purpose lists the effects it wants and which way is good — more work
 * speed, but *less* hunger. A passive's score is the sum of those effects'
 * percentages, signed, and every percentage point counts the same. That is
 * deliberately naive: the game does not say whether 10% attack is worth more
 * than 10% defence, and inventing an exchange rate would be the tier list this
 * module exists to avoid. An effect the purpose does not care about counts for
 * nothing either way, which is how Musclehead (+30% attack, −50% work speed)
 * comes out near the top for a fight and at the bottom for a base.
 *
 * Only percentages of one kind are added together. A fight sums the stat
 * multipliers — attack, defence, HP, element damage in and out — and a base
 * sums the work rates, and nothing else. Health regeneration is a percentage
 * too, but of a small base rate: Immortality's "+100% regen" added to "+15%
 * attack" would put it above everything on a number that means something
 * else. So those effects, along with switches and counts like Insomnia's
 * "works through the night" and Ranch Master's +2 Ranching, are listed beside
 * the ranking rather than inside it.
 */

import type {
  MountKind,
  PassiveEffect,
  PassiveInfo,
  Refdata,
} from '../refdata/refdata.ts'
import type { Guid, Pal, SaveIndex } from './types.ts'
import { against, strongAgainst } from './typeChart.ts'

/* -------------------------------------------------------------------------
   Purposes
   ------------------------------------------------------------------------- */

export type GoalId =
  | 'breeding'
  | 'work'
  | 'fight'
  | 'travel'
  | 'fishing'
  | 'food'
  | 'cake'
  | 'ranch'

/** Where a pal does its job for a purpose. */
export type Side = 'party' | 'base' | 'farm'

type Target = PassiveEffect['target']

/** One effect a purpose wants, and on whom it has to land to count. */
export interface Want {
  type: string
  /** `1` when more is better; `-1` when less is (hunger, sanity loss). */
  sign: 1 | -1
  targets: readonly Target[]
}

export interface SideSpec {
  side: Side
  /** Percentages of one kind: these are summed into the score. */
  want: Want[]
  /** Everything else worth having — listed, never summed. */
  extra: Want[]
}

const ON_PAL: readonly Target[] = ['self', 'both']
const ON_YOU: readonly Target[] = ['trainer', 'both']
const ON_BASE: readonly Target[] = ['base']

const want = (
  type: string,
  sign: 1 | -1,
  targets: readonly Target[],
): Want => ({
  type,
  sign,
  targets,
})

/** The jobs a breeding base starts with; the view lets them be changed. */
export const BREEDING_WORK = [
  'MonsterFarm',
  'Seeding',
  'Watering',
  'Collection',
  'EmitFlame',
  'Transport',
] as const

/**
 * The jobs a food base starts with: grow it, gather it, ranch it, cook it and
 * keep it cold. The view lets them be changed.
 */
export const FOOD_WORK = [
  'Seeding',
  'Watering',
  'Collection',
  'MonsterFarm',
  'EmitFlame',
  'Cool',
] as const

/** A ranch base's one job. */
export const RANCH_WORK = ['MonsterFarm'] as const

/** What a pal working at a base wants, for the jobs it has been given. */
function workerWants(
  work: readonly string[],
): Pick<SideSpec, 'want' | 'extra'> {
  const out: Pick<SideSpec, 'want' | 'extra'> = {
    want: [
      want('CraftSpeed', 1, ON_PAL),
      want('Sanity_Decrease', -1, ON_PAL),
      want('FullStomatch_Decrease', -1, ON_PAL),
    ],
    extra: [want('Nocturnal', 1, ON_PAL), want('NightOwl', -1, ON_PAL)],
  }
  // Carrying things is walking; nothing else at a base is.
  if (work.includes('Transport')) out.want.push(want('MoveSpeed', 1, ON_PAL))
  if (work.includes('MonsterFarm')) {
    out.extra.push(want('WorkSuitabilityAddRank_MonsterFarm', 1, ON_PAL))
  }
  return out
}

export interface GoalInput {
  /** Work type ids for `work` and `breeding`. */
  work: readonly string[]
  /** The opponent's elements, for `fight`. */
  opponentElements: readonly string[]
  /** The elements that hit it hardest, for `fight`. */
  attackElements: readonly string[]
}

/** The sides a purpose has, and what each one wants from a passive. */
export function sidesFor(goal: GoalId, input: GoalInput): SideSpec[] {
  switch (goal) {
    case 'breeding': {
      const base = workerWants(input.work)
      return [
        {
          side: 'base',
          // Babysitter's two effects target the building, not the pal.
          want: [
            want('PalEggHatchingSpeed', 1, ON_BASE),
            want('BreedSpeed_InBaseCamp', 1, ON_BASE),
            ...base.want,
          ],
          extra: base.extra,
        },
        {
          side: 'farm',
          want: [want('BreedSpeed', 1, ON_PAL)],
          extra: [],
        },
      ]
    }
    case 'work': {
      const base = workerWants(input.work)
      const party: SideSpec = {
        side: 'party',
        want: [want('CraftSpeed', 1, ON_YOU)],
        extra: [],
      }
      // The two jobs with a trainer-side passive of their own.
      if (input.work.includes('Mining')) {
        party.want.push(want('Mining', 1, ON_YOU))
      }
      if (input.work.includes('Deforest')) {
        party.want.push(want('Logging', 1, ON_YOU))
      }
      return [party, { side: 'base', ...base }]
    }
    case 'fight':
      return [
        {
          side: 'party',
          want: [
            want('ShotAttack', 1, [...ON_PAL, 'trainer']),
            want('Defense', 1, [...ON_PAL, 'trainer']),
            want('MaxHP', 1, ON_PAL),
            ...input.attackElements.map((e) =>
              want(`ElementBoost_${e}`, 1, ON_PAL),
            ),
            ...input.opponentElements.map((e) =>
              want(`ElementResist_${e}`, 1, ON_PAL),
            ),
          ],
          extra: [
            want('LifeSteal', 1, ON_PAL),
            want('AutoHPRegeneRate', 1, [...ON_PAL, 'trainer']),
            want('ActiveSkillCoolTime_Decrease', 1, ON_PAL),
            want('LeanBackInvalid_ForPassiveSkill', 1, ON_PAL),
            want('KnockbackInvalid_ForPassiveSkill', 1, ON_PAL),
          ],
        },
      ]
    // Fishing, salvaging and the three production bases are carried by partner
    // skills and ranch drops, not by anything a pal can roll: no displayable
    // passive touches fishing, crops or what a Ranch yields. So the party side
    // for fishing wants nothing, and says so, and the bases want what any
    // worker wants for the jobs they do.
    case 'fishing':
      return [{ side: 'party', want: [], extra: [] }]
    case 'food':
    case 'ranch':
      return [{ side: 'base', ...workerWants(input.work) }]
    case 'cake':
      return [
        { side: 'base', ...workerWants(input.work) },
        // A cake does its work in a Breeding Farm's chest.
        { side: 'farm', want: [want('BreedSpeed', 1, ON_PAL)], extra: [] },
      ]
    case 'travel':
      return [
        {
          side: 'party',
          want: [want('MoveSpeed', 1, ON_PAL)],
          extra: [
            want('PalSP_Increase', 1, ON_PAL),
            want('SwimSpeed', 1, ON_PAL),
            want('PlayerSP_DecreaseRate', -1, ON_YOU),
            want('RideJumpCount_Increase', 1, ON_PAL),
          ],
        },
      ]
  }
}

/* -------------------------------------------------------------------------
   Passives
   ------------------------------------------------------------------------- */

/** One effect of a passive that a purpose cared about, and which way it cut. */
export interface Counted {
  effect: PassiveEffect
  good: boolean
}

export interface PassiveScore {
  id: string
  /** Signed sum of the wanted percentage effects. */
  score: number
  /** Signed: positive when the switches and counts it carries are wanted. */
  extra: number
  counted: Counted[]
}

export function scorePassive(
  id: string,
  info: PassiveInfo,
  spec: SideSpec,
): PassiveScore {
  let score = 0
  let extra = 0
  const counted: Counted[] = []
  for (const effect of info.effects ?? []) {
    const hit = (w: Want) =>
      w.type === effect.type && w.targets.includes(effect.target)

    const w = spec.want.find(hit)
    if (w && effect.value !== 0) {
      const signed = w.sign * effect.value
      score += signed
      counted.push({ effect, good: signed > 0 })
      continue
    }
    const x = spec.extra.find(hit)
    if (x) {
      // A switch has no value to carry a direction, so its direction is the
      // want's own; a count's direction is its sign.
      const dir = x.sign * (effect.value === 0 ? 1 : Math.sign(effect.value))
      extra += dir * Math.max(1, Math.abs(effect.value))
      counted.push({ effect, good: dir > 0 })
    }
  }
  return { id, score, extra, counted }
}

export interface PassiveAdvice {
  /** Raise the score, best first. */
  best: PassiveScore[]
  /** No score, but a switch or count the purpose wants. */
  also: PassiveScore[]
  /** Work against the purpose, worst first. */
  avoid: PassiveScore[]
}

export function advisePassives(
  passives: Refdata['passives'],
  spec: SideSpec,
): PassiveAdvice {
  const best: PassiveScore[] = []
  const also: PassiveScore[] = []
  const avoid: PassiveScore[] = []
  for (const [id, info] of Object.entries(passives)) {
    const s = scorePassive(id, info, spec)
    if (s.score > 0) best.push(s)
    else if (s.score < 0) avoid.push(s)
    else if (s.extra > 0) also.push(s)
    else if (s.extra < 0) avoid.push(s)
  }
  const rank = (id: string) => passives[id]?.rank ?? 0
  best.sort((a, b) => b.score - a.score || b.extra - a.extra || rank(b.id) - rank(a.id)) // prettier-ignore
  also.sort((a, b) => b.extra - a.extra || rank(b.id) - rank(a.id))
  avoid.sort((a, b) => a.score - b.score || a.extra - b.extra)
  return { best, also, avoid }
}

/** A pal's passives scored together, for ranking the pals someone owns. */
export function palPassiveScore(
  pal: Pal,
  passives: Refdata['passives'],
  spec: SideSpec,
): number {
  let total = 0
  for (const raw of pal.passives) {
    const id = raw.toLowerCase()
    const info = passives[id]
    if (info) total += scorePassive(id, info, spec).score
  }
  return total
}

/**
 * Up to four of the best passives that breeding can actually deliver.
 *
 * Only `random` ones: every other source is a passive no ordinary hatch rolls,
 * and asking the Breed view for one of those gets a polite "cannot" rather than
 * a route. Four because a pal has four slots.
 */
export function breedablePicks(
  advice: PassiveAdvice,
  passives: Refdata['passives'],
): string[] {
  return advice.best
    .filter((s) => passives[s.id]?.source === 'random')
    .slice(0, 4)
    .map((s) => s.id)
}

/* -------------------------------------------------------------------------
   Species
   ------------------------------------------------------------------------- */

/**
 * The species worth ranking: every one that can be bred.
 *
 * `characters.json` also carries NPCs, raid variants and humans — 753 rows
 * against 304 real pals — and a Lv 5 Mining merchant is not advice. The breeding
 * table is the cleanest list of real pals there is. When it failed to load, the
 * paldex numbering is the fallback: only real pals have one.
 */
export function speciesPool(data: Refdata): string[] {
  const bred = Object.keys(data.breeding?.pals ?? {})
  if (bred.length > 0) return bred.filter((id) => data.species[id])
  return Object.entries(data.species)
    .filter(([, s]) => s.zukan !== undefined)
    .map(([id]) => id)
}

export interface WorkerRow {
  id: string
  level: number
  craftSpeed: number
  food: number
}

export function bestWorkers(
  data: Refdata,
  pool: readonly string[],
  workId: string,
  limit: number,
): WorkerRow[] {
  const rows: WorkerRow[] = []
  for (const id of pool) {
    const s = data.species[id]
    const level = s?.work?.[workId] ?? 0
    if (level <= 0) continue
    rows.push({
      id,
      level,
      craftSpeed: s?.stats?.craftSpeed ?? 0,
      food: s?.stats?.food ?? 0,
    })
  }
  return rows
    .sort(
      (a, b) =>
        b.level - a.level ||
        b.craftSpeed - a.craftSpeed ||
        a.food - b.food ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
}

export interface FighterRow {
  id: string
  /** Its element that hits the opponent hardest. */
  element?: string
  /** What that element does to the opponent. */
  dealt: number
  /** The worst the opponent's elements do to it. */
  taken: number
  attack: number
}

/** Both elements of a species, the missing second one left out. */
export function elementsOf(data: Refdata, id: string): string[] {
  const s = data.species[id]
  return [s?.element1, s?.element2].filter(
    (e): e is string => !!e && e !== 'None',
  )
}

/**
 * How one species fares against an opponent's elements.
 *
 * `taken` assumes the opponent fights with its own elements, which is what its
 * element badge says and all the data can say — which of its moves it actually
 * uses is not in any table.
 */
export function matchup(
  data: Refdata,
  id: string,
  opponent: readonly string[],
): FighterRow {
  const mine = elementsOf(data, id)
  let dealt = mine.length === 0 ? 1 : 0
  let element: string | undefined
  for (const e of mine) {
    const m = against(e, opponent)
    if (m > dealt) {
      dealt = m
      element = e
    }
  }
  let taken = opponent.length === 0 ? 1 : 0
  for (const e of opponent) taken = Math.max(taken, against(e, mine))
  return {
    id,
    element,
    dealt,
    taken,
    attack: data.species[id]?.stats?.attack ?? 0,
  }
}

const byMatchup = (a: FighterRow, b: FighterRow) =>
  b.dealt - a.dealt || a.taken - b.taken || b.attack - a.attack

export function bestFighters(
  data: Refdata,
  pool: readonly string[],
  opponent: readonly string[],
  limit: number,
): FighterRow[] {
  return pool
    .map((id) => matchup(data, id, opponent))
    .sort((a, b) => byMatchup(a, b) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export interface SkillRow {
  id: string
  name: string
  element: string
  power: number
  cooldown: number
}

/**
 * The hardest-hitting active skills of the elements that beat the opponent.
 *
 * Skills whose id starts `Unique_` belong to one species and cannot be taught
 * to another, so they are left out of a list meant for any pal of the element.
 */
export function strongSkills(
  data: Refdata,
  elements: readonly string[],
  perElement: number,
): SkillRow[] {
  const out: SkillRow[] = []
  for (const element of elements) {
    const rows = Object.entries(data.skills ?? {})
      .filter(([id, k]) => k.element === element && !id.startsWith('unique_'))
      .map(([id, k]) => ({
        id,
        name: k.name,
        element,
        power: k.power,
        cooldown: k.cooldown,
      }))
      .sort((a, b) => b.power - a.power || a.cooldown - b.cooldown)
    out.push(...rows.slice(0, perElement))
  }
  return out
}

export interface MountRow {
  id: string
  kind: MountKind
  speed: number
}

export const MOUNT_KINDS: readonly MountKind[] = [
  'flying',
  'ground',
  'water',
  'glider',
]

export function bestMounts(
  data: Refdata,
  pool: readonly string[],
  kind: MountKind,
  limit: number,
): MountRow[] {
  return pool
    .filter((id) => data.species[id]?.mount === kind)
    .map((id) => ({
      id,
      kind,
      speed: data.species[id]?.stats?.rideSpeed ?? 0,
    }))
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/* -------------------------------------------------------------------------
   The player's own pals
   ------------------------------------------------------------------------- */

export type Where = 'party' | 'palbox' | 'base' | 'unknown'

/**
 * Where each pal is right now, as far as the save says.
 *
 * Built once per index. A worker roster is recognised from the base that points
 * at it, which is exact; party and palbox come from a player save naming its
 * containers, or failing that from the container's own inferred slot.
 */
export function locator(index: SaveIndex): (pal: Pal) => Where {
  const workers = new Set<Guid>()
  for (const b of index.bases) {
    if (b.workerContainerId) workers.add(b.workerContainerId)
  }
  const party = new Set<Guid>()
  const palbox = new Set<Guid>()
  for (const p of index.playerDetails) {
    if (p.otomoContainerId) party.add(p.otomoContainerId)
    if (p.palboxContainerId) palbox.add(p.palboxContainerId)
  }

  return (pal) => {
    const id = pal.containerId
    if (!id) return 'unknown'
    if (workers.has(id)) return 'base'
    if (party.has(id)) return 'party'
    if (palbox.has(id)) return 'palbox'
    const cc = index.charContainerById.get(id)
    if (cc?.ownerBaseId || cc?.ownerSlot === 'workers') return 'base'
    if (cc?.ownerSlot === 'party') return 'party'
    if (cc?.ownerSlot === 'palbox') return 'palbox'
    return 'unknown'
  }
}

export interface OwnedRow {
  pal: Pal
  where: Where
  /** Its passives scored against the side it would work on. */
  passiveScore: number
}

/** A pal's level in a job: its species' level plus any the save has added. */
export function workLevel(data: Refdata, pal: Pal, workId: string): number {
  const base = data.species[pal.characterId.toLowerCase()]?.work?.[workId] ?? 0
  if (base <= 0) return 0
  return base + (pal.workSuitabilityBonus[workId] ?? 0)
}

export interface OwnedWorker extends OwnedRow {
  level: number
}

export function ownedWorkers(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  workId: string,
  spec: SideSpec,
  limit: number,
): OwnedWorker[] {
  const rows: OwnedWorker[] = []
  for (const pal of pals) {
    const level = workLevel(data, pal, workId)
    if (level <= 0) continue
    rows.push({
      pal,
      level,
      where: where(pal),
      passiveScore: palPassiveScore(pal, data.passives, spec),
    })
  }
  return rows
    .sort(
      (a, b) =>
        b.level - a.level ||
        b.passiveScore - a.passiveScore ||
        b.pal.level - a.pal.level,
    )
    .slice(0, limit)
}

export interface OwnedFighter extends OwnedRow {
  fight: FighterRow
  /** Equipped active skills of an element that beats the opponent. */
  strongMoves: string[]
}

/**
 * The player's pals for a fight, best first.
 *
 * Matchup first, as for species, then passives, then level. The save has the
 * level and IVs but the game's damage formula is in no table, so they order the
 * list rather than feed an invented number.
 */
export function ownedFighters(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  opponent: readonly string[],
  spec: SideSpec,
  limit: number,
): OwnedFighter[] {
  const strong = new Set(strongAgainst(opponent).map((s) => s.element))
  return pals
    .map((pal) => ({
      pal,
      where: where(pal),
      fight: matchup(data, pal.characterId.toLowerCase(), opponent),
      passiveScore: palPassiveScore(pal, data.passives, spec),
      strongMoves: pal.equipWaza.filter((w) => {
        const el = data.skills?.[w.toLowerCase()]?.element
        return el !== undefined && strong.has(el)
      }),
    }))
    .sort(
      (a, b) =>
        byMatchup(a.fight, b.fight) ||
        b.passiveScore - a.passiveScore ||
        b.pal.level - a.pal.level ||
        (b.pal.ivAttack ?? 0) - (a.pal.ivAttack ?? 0),
    )
    .slice(0, limit)
}

export interface OwnedMount extends OwnedRow {
  kind: MountKind
  speed: number
}

export function ownedMounts(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  spec: SideSpec,
  limit: number,
): OwnedMount[] {
  const rows: OwnedMount[] = []
  for (const pal of pals) {
    const s = data.species[pal.characterId.toLowerCase()]
    if (!s?.mount) continue
    rows.push({
      pal,
      kind: s.mount,
      speed: s.stats?.rideSpeed ?? 0,
      where: where(pal),
      passiveScore: palPassiveScore(pal, data.passives, spec),
    })
  }
  return rows
    .sort(
      (a, b) =>
        b.speed - a.speed ||
        b.passiveScore - a.passiveScore ||
        b.pal.level - a.pal.level,
    )
    .slice(0, limit)
}

/** The player's pals that already carry any of these passives, most first. */
export function carriersOf(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  ids: readonly string[],
  spec: SideSpec,
  limit: number,
): OwnedRow[] {
  const wanted = new Set(ids)
  return pals
    .filter((p) => p.passives.some((id) => wanted.has(id.toLowerCase())))
    .map((pal) => ({
      pal,
      where: where(pal),
      passiveScore: palPassiveScore(pal, data.passives, spec),
    }))
    .sort(
      (a, b) => b.passiveScore - a.passiveScore || b.pal.level - a.pal.level,
    )
    .slice(0, limit)
}

/** Lowercased species ids among these pals. */
export function speciesHeld(pals: readonly Pal[]): Set<string> {
  return new Set(pals.map((p) => p.characterId.toLowerCase()))
}

/* -------------------------------------------------------------------------
   Partner skills and ranch drops
   ------------------------------------------------------------------------- */

/**
 * Partner-skill effects each production purpose looks for, grouped the way the
 * view shows them. `sign` is `-1` where less is better (hunger, spoilage).
 *
 * All from `SpeciesInfo.partnerEffects` — typed effect data, not the prose —
 * and all at the partner skill's level 1.
 */
export const PARTNER_WANTS = {
  fishing: [
    want('Fishing_ItemAddDrop', 1, ON_YOU),
    want('Fishing_EnemyAddDrop', 1, ON_YOU),
    want('Fishing_GoodTalentPalProbability', 1, ON_YOU),
    want('Fishing_StartProgressAdd', 1, ON_YOU),
    want('Fishing_SuccessAmountUp', 1, ON_YOU),
    want('Fishing_FailedAmountDown', 1, ON_YOU),
  ],
  salvage: [want('FishingSalvage_ItemDrop', 1, ON_YOU)],
  crops: [
    want('FarmCropHarvestNumRate', 1, ON_BASE),
    want('FarmCropGrowupSpeed', 1, ON_BASE),
  ],
  hunger: [want('FullStomatch_Decrease', -1, ON_BASE)],
  ranchRank: [want('WorkSuitabilityAddRank_MonsterFarm', 1, ON_BASE)],
  spoilage: [want('ItemCorruptionSpeedRate', -1, ON_YOU)],
} as const satisfies Record<string, readonly Want[]>

export interface PartnerRow {
  id: string
  /** The species' partner effects that matched, in the order wanted. */
  effects: PassiveEffect[]
}

function matchedEffects(
  data: Refdata,
  speciesId: string,
  wants: readonly Want[],
): PassiveEffect[] {
  const effects = data.species[speciesId]?.partnerEffects ?? []
  const out: PassiveEffect[] = []
  for (const w of wants) {
    const e = effects.find(
      (x) =>
        x.type === w.type &&
        w.targets.includes(x.target) &&
        Math.sign(x.value) !== -w.sign,
    )
    if (e) out.push(e)
  }
  return out
}

/**
 * Species whose partner skill does something wanted, best first.
 *
 * Ordered by how many of the wanted effects it has, then by the size of its
 * first one. The effects are different kinds — more fishing drops, a head start
 * on the minigame — so their values are never added together; the rows show
 * each one instead.
 */
export function bestPartners(
  data: Refdata,
  pool: readonly string[],
  wants: readonly Want[],
  limit: number,
): PartnerRow[] {
  const rows: PartnerRow[] = []
  for (const id of pool) {
    const effects = matchedEffects(data, id, wants)
    if (effects.length > 0) rows.push({ id, effects })
  }
  return rows
    .sort(
      (a, b) =>
        b.effects.length - a.effects.length ||
        Math.abs(b.effects[0]!.value) - Math.abs(a.effects[0]!.value) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
}

export interface OwnedPartner extends OwnedRow {
  effects: PassiveEffect[]
}

/** The player's pals of those species, the one to hand first. */
export function ownedPartners(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  wants: readonly Want[],
  spec: SideSpec,
  limit: number,
): OwnedPartner[] {
  const rows: OwnedPartner[] = []
  for (const pal of pals) {
    const effects = matchedEffects(data, pal.characterId.toLowerCase(), wants)
    if (effects.length === 0) continue
    rows.push({
      pal,
      effects,
      where: where(pal),
      passiveScore: palPassiveScore(pal, data.passives, spec),
    })
  }
  const order: Record<Where, number> = {
    party: 0,
    base: 1,
    palbox: 2,
    unknown: 3,
  }
  return rows
    .sort(
      (a, b) =>
        b.effects.length - a.effects.length ||
        order[a.where] - order[b.where] ||
        b.pal.rank - a.pal.rank ||
        b.pal.level - a.pal.level,
    )
    .slice(0, limit)
}

/**
 * Species that drop an item when they work a Ranch.
 *
 * Ranked as ranch workers — Ranching level, then work speed, then how cheaply
 * they eat — since a drop only happens while the pal is working the Ranch.
 */
export function ranchProducers(
  data: Refdata,
  pool: readonly string[],
  itemId: string,
  limit: number,
): WorkerRow[] {
  const key = itemId.toLowerCase()
  const droppers = pool.filter((id) =>
    data.species[id]?.ranchDrops?.includes(key),
  )
  return bestWorkers(data, droppers, 'MonsterFarm', limit)
}

/** The player's pals that drop it, ranked as ranch workers. */
export function ownedProducers(
  data: Refdata,
  pals: readonly Pal[],
  where: (pal: Pal) => Where,
  itemId: string,
  spec: SideSpec,
  limit: number,
): OwnedWorker[] {
  const key = itemId.toLowerCase()
  return ownedWorkers(
    data,
    pals.filter((p) =>
      data.species[p.characterId.toLowerCase()]?.ranchDrops?.includes(key),
    ),
    where,
    'MonsterFarm',
    spec,
    limit,
  )
}

/**
 * Every item any pal in the pool drops at a Ranch, with who drops it.
 *
 * `food` picks the food drops (for the food base) or everything else (for the
 * ranch base).
 */
export function ranchDropItems(
  data: Refdata,
  pool: readonly string[],
  food: boolean,
): { item: string; species: string[] }[] {
  const by = new Map<string, string[]>()
  for (const id of pool) {
    for (const item of data.species[id]?.ranchDrops ?? []) {
      if (Boolean(data.items[item]?.food) !== food) continue
      by.set(item, [...(by.get(item) ?? []), id])
    }
  }
  return [...by]
    .map(([item, species]) => ({ item, species }))
    .sort(
      (a, b) =>
        b.species.length - a.species.length ||
        (data.items[a.item]?.name ?? a.item).localeCompare(
          data.items[b.item]?.name ?? b.item,
        ),
    )
}
