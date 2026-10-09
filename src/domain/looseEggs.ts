/**
 * Eggs laid at a Breeding Farm and not yet collected.
 *
 * The game does not keep these in the farm. Each one is saved as a map object
 * of its own — a `PalEgg_Dark`, say — with a one-slot container holding the
 * egg, sitting on the farm that laid it. Read as written, a farm with fourteen
 * eggs on it is a farm holding a cake and fourteen "structures" called Pal Egg,
 * listed apart from it and counted as things somebody built.
 *
 * Nothing in an egg's record names its farm. What it has is the base it is in
 * and where it is, and that is enough: in the reference saves every one of 78
 * eggs is within three metres of a farm in its own base, and a farm holds at
 * most twenty. So an egg belongs to the nearest farm in its base, if one is
 * within reach, and an egg with no farm in reach is left as it was found.
 *
 * This only decides who belongs to whom. `buildSaveIndex` is what folds them
 * together, and only in its derived lookups: the payload still holds every egg
 * as its own structure, because that is what the save says.
 */

import type { Guid, Structure } from './types.ts'

/** Unreal units are centimetres. Five metres: the farthest measured is 2.83. */
export const EGG_REACH = 500

const EGG_MODEL = 'PalMapObjectPalEggModel'
const FARM_MODEL = 'PalMapObjectBreedFarmModel'

/**
 * By model, or by name where the save records no model — which it does not
 * for `PalEgg_MutationPal`.
 */
export function isLooseEgg(s: Structure): boolean {
  return s.concreteModelType === EGG_MODEL || /^palegg/i.test(s.mapObjectId)
}

function isBreedingFarm(s: Structure): boolean {
  return (
    s.concreteModelType === FARM_MODEL || /^breedfarm$/i.test(s.mapObjectId)
  )
}

/** Each farm with eggs waiting on it, and those eggs in the save's order. */
export function looseEggsByFarm(
  structures: readonly Structure[],
): Map<Guid, Structure[]> {
  const farmsByBase = new Map<Guid, Structure[]>()
  for (const s of structures) {
    // A farm with no container has nowhere to show what is on it.
    if (!s.baseCampId || !s.containerId || !isBreedingFarm(s)) continue
    const at = farmsByBase.get(s.baseCampId)
    if (at) at.push(s)
    else farmsByBase.set(s.baseCampId, [s])
  }

  const out = new Map<Guid, Structure[]>()
  if (farmsByBase.size === 0) return out
  for (const egg of structures) {
    if (!egg.baseCampId || !egg.containerId || !isLooseEgg(egg)) continue
    let nearest: Structure | undefined
    let best = EGG_REACH
    for (const farm of farmsByBase.get(egg.baseCampId) ?? []) {
      const d = Math.hypot(
        egg.pos.x - farm.pos.x,
        egg.pos.y - farm.pos.y,
        egg.pos.z - farm.pos.z,
      )
      if (d <= best) {
        best = d
        nearest = farm
      }
    }
    if (!nearest) continue
    const eggs = out.get(nearest.instanceId)
    if (eggs) eggs.push(egg)
    else out.set(nearest.instanceId, [egg])
  }
  return out
}
