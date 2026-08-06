/**
 * Accessors for the GVAS property tree that `palworld-save-tools` emits.
 *
 * Two properties of that tree make naive access wrong in ways that are easy to
 * miss and hard to debug, and this module exists to absorb both:
 *
 * 1. **The wrapper double-nests inconsistently.** `ByteProperty` and
 *    `EnumProperty` put their payload at `.value.value`; everything else puts
 *    it at `.value`. `Level` and all three `Talent_*` IVs are ByteProperties,
 *    so the obvious `sp.Level.value` yields `{type:'None', value:42}` rather
 *    than `42` — a bug that reads as "levels are objects now" three files
 *    downstream.
 *
 * 2. **Fields are extremely sparse.** Measured across 1,098 pals in a real
 *    save: `CharacterID` 1098, `Talent_HP` 1088, `Level` 1064,
 *    `PassiveSkillList` 999, `FullStomach` 596, `Rank` 16, `IsRarePal` 7,
 *    `WorkerSick` 1. Every accessor therefore returns `undefined` rather than
 *    throwing, and callers are expected to supply defaults.
 *
 * These are plain functions rather than a fluent wrapper so they tree-shake
 * and inline.
 */

import { normGuid, type Guid } from './guid.ts'

/** An untyped node of the GVAS tree. This is where `any` stops. */
export type Node = any

/* -------------------------------------------------------------------------
   Scalars
   ------------------------------------------------------------------------- */

/** Int/Int64/Float/String-less scalar: payload at `.value`. */
export function int(n: Node): number | undefined {
  return typeof n?.value === 'number' ? n.value : undefined
}

/** ByteProperty: payload at `.value.value`. */
export function byte(n: Node): number | undefined {
  return typeof n?.value?.value === 'number' ? n.value.value : undefined
}

/** Tolerant numeric read — handles Int, Int64, Float, Byte and scalar structs. */
export function num(n: Node): number | undefined {
  return int(n) ?? byte(n)
}

export function str(n: Node): string | undefined {
  return typeof n?.value === 'string' ? n.value : undefined
}

export function bool(n: Node): boolean | undefined {
  return typeof n?.value === 'boolean' ? n.value : undefined
}

/* -------------------------------------------------------------------------
   Enums
   ------------------------------------------------------------------------- */

/** Full enum token, e.g. `"EPalGenderType::Female"`. */
export function enumRaw(n: Node): string | undefined {
  return typeof n?.value?.value === 'string' ? n.value.value : undefined
}

/** Enum tail only, e.g. `"Female"`. */
export function enumTail(n: Node): string | undefined {
  return tail(enumRaw(n))
}

/** Strips a `Namespace::` prefix from an enum token. */
export function tail(s: string | undefined): string | undefined {
  if (s === undefined) return undefined
  const i = s.lastIndexOf('::')
  return i === -1 ? s : s.slice(i + 2)
}

/* -------------------------------------------------------------------------
   Structs
   ------------------------------------------------------------------------- */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Object-struct body, e.g. a `Vector`'s `{x,y,z}` or a nested property bag. */
export function struct(n: Node): Node {
  return n?.value
}

export function vec3(n: Node): Vec3 | undefined {
  const v = n?.value
  return typeof v?.x === 'number' &&
    typeof v?.y === 'number' &&
    typeof v?.z === 'number'
    ? { x: v.x, y: v.y, z: v.z }
    : undefined
}

/** Reads a `Transform`'s translation, tolerating a bare `{x,y,z}`. */
export function translation(n: Node): Vec3 | undefined {
  const t = n?.translation ?? n?.value?.translation
  if (typeof t?.x === 'number') return { x: t.x, y: t.y, z: t.z }
  return vec3(n)
}

/**
 * Scalar-struct GUID. Accepts a bare string too, since arrays of GUIDs come
 * through as plain strings rather than wrapped nodes.
 */
export function guid(n: Node): Guid | undefined {
  return normGuid(typeof n === 'string' ? n : n?.value)
}

/**
 * `FixedPoint64` — used for `Hp` and `ShieldHP`, and stored multiplied by
 * 1000. Returns the raw stored integer; use {@link hp} for real HP.
 */
export function fixed64(n: Node): number | undefined {
  const v = n?.value?.Value?.value
  return typeof v === 'number' ? v : undefined
}

/** `FixedPoint64` scaled back to real HP. */
export function hp(n: Node): number | undefined {
  const v = fixed64(n)
  return v === undefined ? undefined : v / 1000
}

/* -------------------------------------------------------------------------
   Arrays and maps
   ------------------------------------------------------------------------- */

/**
 * Array read that copes with all three shapes in the tree: `ArrayProperty`
 * (`.value.values`), `MapProperty` (`.value` is already the array), and a bare
 * array. Always returns an array, never `undefined`.
 */
export function arr<T = any>(n: Node): T[] {
  if (Array.isArray(n?.value?.values)) return n.value.values as T[]
  if (Array.isArray(n?.value)) return n.value as T[]
  if (Array.isArray(n)) return n as T[]
  return []
}

/** Array of enum tokens, reduced to their tails. */
export function enumArr(n: Node): string[] {
  return arr<string>(n)
    .map((s) => tail(s))
    .filter((s): s is string => typeof s === 'string')
}

/** Array of `NameProperty`/`StrProperty` values. */
export function strArr(n: Node): string[] {
  return arr<unknown>(n).filter((s): s is string => typeof s === 'string')
}

/** Array of GUIDs, normalised and with zero GUIDs preserved (filter yourself). */
export function guidArr(n: Node): Guid[] {
  return arr<unknown>(n)
    .map((g) => guid(g))
    .filter((g): g is Guid => g !== undefined)
}

/* -------------------------------------------------------------------------
   Palworld-specific paths
   ------------------------------------------------------------------------- */

/**
 * The one path everything about a character hangs off.
 *
 * Note that `group_id` — the guild link — is a *sibling* of `object`, not a
 * field inside `SaveParameter`. See {@link characterGroupId}.
 */
export function saveParameter(entry: Node): Node {
  return entry?.value?.RawData?.value?.object?.SaveParameter?.value
}

/** The guild GUID for a character entry. Lives beside `object`, not under it. */
export function characterGroupId(entry: Node): Guid | undefined {
  return normGuid(entry?.value?.RawData?.value?.group_id)
}

/**
 * Looks up a module on a map object's `ConcreteModel` by its short type name.
 *
 * This is where the chest → inventory link actually lives:
 * `module(cm, 'ItemContainer')?.target_container_id`. It is *not* in
 * `ConcreteModel.RawData`, which is a common and costly assumption — measured
 * over a real save, all 967 storage objects carry the id here and none carry
 * it there.
 *
 * Observed module types: ItemContainer (967), StatusObserver (237),
 * Workee (80), Energy (51), PasswordLock (42), GuildSecurity (42),
 * Switch (14), RequireElementalAction (1).
 */
export function module(concreteModel: Node, type: string): Node {
  const found = arr<Node>(concreteModel?.value?.ModuleMap).find(
    (m) => typeof m?.key === 'string' && m.key.endsWith('::' + type),
  )
  return found?.value?.RawData?.value
}

/** `PalContainerId` → the container GUID, from a `SlotId`-shaped struct. */
export function containerIdOf(n: Node): Guid | undefined {
  return normGuid(n?.value?.ContainerId?.value?.ID?.value)
}

/**
 * A bare `PalContainerId` struct → its GUID, i.e. `{value: {ID: {value}}}`.
 *
 * Distinct from {@link containerIdOf}, which expects the extra `ContainerId`
 * level that a pal's `SlotId` wraps around it. Player saves use this shorter
 * form for all eight of their container references.
 */
export function palContainerId(n: Node): Guid | undefined {
  return normGuid(n?.value?.ID?.value)
}

/**
 * A `MapProperty` with `NameProperty` keys → a plain record.
 *
 * Skips entries whose key is not a string: `RelicPossessNumMap` uses
 * `EnumProperty` keys, which arrive as objects and would otherwise stringify
 * to `"[object Object]"`.
 */
export function nameMap<T = unknown>(n: Node): Record<string, T> {
  const out: Record<string, T> = {}
  for (const entry of arr<Node>(n)) {
    if (typeof entry?.key === 'string') out[entry.key] = entry.value as T
  }
  return out
}
