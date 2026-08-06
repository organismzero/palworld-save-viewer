/**
 * The element palette.
 *
 * These are **data colours** — they encode a pal's element and nothing else.
 * UI chrome (focus, active, selection) uses `--color-signal` exclusively. That
 * separation is what stops a nine-hue palette reading as a clown car.
 *
 * ## Why the values are hardcoded rather than read from `skills.json`
 *
 * Two reasons. First, the source values are raw Tailwind v3 defaults with
 * wildly uneven perceptual lightness — `Dark #6B21A8` sits at L≈0.38 and
 * disappears against a dark ground, while `Ice #67E8F9` at L≈0.86 shouts over
 * everything. They are normalised here to near-equal lightness in OKLCH,
 * preserving hue.
 *
 * Second, reading them at runtime would let an upstream PalworldSaveTools edit
 * silently restyle the app. The source hex is recorded per entry so the
 * provenance stays visible.
 *
 * Dragon and Earth are only ~18° apart at source and are genuinely hard to
 * tell apart; Earth is nudged toward magenta, and both must also be
 * distinguished by icon so colour is never the only channel.
 */

/** Internal element names as they appear in the save and reference data. */
export type ElementName =
  | 'Normal'
  | 'Fire'
  | 'Water'
  | 'Electricity'
  | 'Leaf'
  | 'Dark'
  | 'Dragon'
  | 'Earth'
  | 'Ice'

export interface ElementDef {
  name: ElementName
  /** Player-facing name; differs from the internal one for three elements. */
  display: string
  index: number
  /** Tailwind theme token defined in `src/index.css`. */
  token: string
  /** Normalised OKLCH, for canvas/Pixi where a CSS var will not do. */
  oklch: string
  /** The unmodified value from `skills.json`, kept for provenance only. */
  sourceHex: string
}

export const ELEMENTS: readonly ElementDef[] = [
  {
    name: 'Normal',
    display: 'Neutral',
    index: 0,
    token: '--color-el-neutral',
    oklch: 'oklch(0.72 0.02 260)',
    sourceHex: '#9CA3AF',
  },
  {
    name: 'Fire',
    display: 'Fire',
    index: 1,
    token: '--color-el-fire',
    oklch: 'oklch(0.72 0.16 28)',
    sourceHex: '#EF4444',
  },
  {
    name: 'Water',
    display: 'Water',
    index: 2,
    token: '--color-el-water',
    oklch: 'oklch(0.72 0.15 250)',
    sourceHex: '#3B82F6',
  },
  {
    name: 'Electricity',
    display: 'Electric',
    index: 3,
    token: '--color-el-electric',
    // Yellow needs the extra lightness or it reads as olive.
    oklch: 'oklch(0.80 0.15 85)',
    sourceHex: '#FBBF24',
  },
  {
    name: 'Leaf',
    display: 'Grass',
    index: 4,
    token: '--color-el-grass',
    oklch: 'oklch(0.78 0.16 150)',
    sourceHex: '#4ADE80',
  },
  {
    name: 'Dark',
    display: 'Dark',
    index: 5,
    token: '--color-el-dark',
    // Lifted hard from L≈0.38; the source value is invisible on this ground.
    oklch: 'oklch(0.62 0.16 305)',
    sourceHex: '#6B21A8',
  },
  {
    name: 'Dragon',
    display: 'Dragon',
    index: 6,
    token: '--color-el-dragon',
    oklch: 'oklch(0.72 0.14 282)',
    sourceHex: '#818CF8',
  },
  {
    name: 'Earth',
    display: 'Earth',
    index: 7,
    token: '--color-el-earth',
    // Hue pushed away from Dragon; still pair with a distinct icon.
    oklch: 'oklch(0.74 0.13 300)',
    sourceHex: '#A78BFA',
  },
  {
    name: 'Ice',
    display: 'Ice',
    index: 8,
    token: '--color-el-ice',
    oklch: 'oklch(0.82 0.12 205)',
    sourceHex: '#67E8F9',
  },
] as const

const BY_NAME = new Map<string, ElementDef>(
  ELEMENTS.map((e) => [e.name.toLowerCase(), e]),
)

/**
 * Resolves an element from any of the forms the data uses: the bare internal
 * name (`"Leaf"`), an enum token (`"EPalElementType::Leaf"`), or the display
 * name (`"Grass"`). Returns `undefined` for `"None"` and anything unknown.
 */
export function element(raw: string | undefined): ElementDef | undefined {
  if (!raw) return undefined
  const sep = raw.lastIndexOf('::')
  const bare = (sep === -1 ? raw : raw.slice(sep + 2)).toLowerCase()
  if (bare === 'none' || bare === '') return undefined
  return (
    BY_NAME.get(bare) ?? ELEMENTS.find((e) => e.display.toLowerCase() === bare)
  )
}

export function elementColor(raw: string | undefined): string {
  return element(raw)?.oklch ?? 'oklch(0.62 0.02 250)'
}

/* -------------------------------------------------------------------------
   Work suitability
   ------------------------------------------------------------------------- */

/** The 13 work types, keyed as they appear in a pal's `work_suitabilities`. */
export const WORK_TYPES: readonly { id: string; display: string }[] = [
  { id: 'EmitFlame', display: 'Kindling' },
  { id: 'Watering', display: 'Watering' },
  { id: 'Seeding', display: 'Planting' },
  { id: 'GenerateElectricity', display: 'Generating Electricity' },
  { id: 'Handcraft', display: 'Handiwork' },
  { id: 'Collection', display: 'Gathering' },
  { id: 'Deforest', display: 'Lumbering' },
  { id: 'Mining', display: 'Mining' },
  { id: 'Transport', display: 'Transporting' },
  { id: 'MonsterFarm', display: 'Ranching' },
  { id: 'ProductMedicine', display: 'Medicine Production' },
  { id: 'OilExtraction', display: 'Oil Extraction' },
  { id: 'Cool', display: 'Cooling' },
] as const

/* -------------------------------------------------------------------------
   Passive skill ranks
   ------------------------------------------------------------------------- */

/**
 * Passives are styled by their numeric `rank`, not by name — which is why a
 * wall of pal cards stays readable without any per-skill art. Observed ranks in
 * real data run −3…9; negatives are detrimental traits.
 */
export type PassiveTier = 'detrimental' | 'common' | 'good' | 'legendary'

export function passiveTier(rank: number | undefined): PassiveTier {
  if (rank === undefined) return 'common'
  if (rank < 0) return 'detrimental'
  if (rank >= 4) return 'legendary'
  if (rank >= 2) return 'good'
  return 'common'
}
