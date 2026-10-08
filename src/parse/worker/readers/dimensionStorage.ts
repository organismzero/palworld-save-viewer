/**
 * Reads `Players/<uid>_dps.sav` — one player's Dimensional Pal Storage.
 *
 * The file is a `PalDimensionPalStorageSaveGame` holding one array,
 * `SaveParameterArray`, of 9,600 slots. Every slot is written
 * whether or not anything is in it, which is why a file holding 17 pals
 * decodes to a quarter of a gigabyte of tree. A filled slot carries the same
 * `PalIndividualCharacterSaveParameter` a pal in `Level.sav` does, so it is
 * read by the same function.
 *
 * Three things in that record are not what they look like, each checked
 * against the reference save's two storage files:
 *
 * - **`SlotId` is stale.** It names the container and slot the pal was in
 *   before it was put away — every one of them resolves to a container in the
 *   level save, and two pals in one file share a slot index. Read as a
 *   location it would put a stored pal back in its owner's palbox. A pal's
 *   place in storage is its position in the array, and that is what
 *   `slotIndex` is set to here.
 * - **`LastJumpedLocation` is stale too**, for the same reason, so a stored pal
 *   gets no position and stays off the map.
 * - **Nothing here links a pal to a guild.** In the level save that link is a
 *   sibling of the parameter inside `RawData`; this file has no such sibling.
 *   The caller gives each pal its owner's guild.
 *
 * None of the 31 stored pals in the reference files is also in `Level.sav`:
 * putting a pal away removes it from the world. The caller still drops any
 * whose instance id the level already has, so a pal can never be counted twice.
 */

import { arr, guid, str, type Node } from '../../gvas.ts'
import { nonZero, type Guid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type { Pal } from '../../../domain/types.ts'
import { readPal } from './characters.ts'

const SAVE_CLASS = 'PalDimensionPalStorageSaveGame'

export interface DimensionStorage {
  /** Every filled slot, in slot order. */
  pals: Pal[]
  /** How many slots the file has, filled or not. */
  slots: number
}

export function readDimensionStorage(
  raw: Node,
  fileName: string,
  warn: Warnings,
): DimensionStorage {
  const array = raw?.properties?.SaveParameterArray
  const cls: unknown = raw?.header?.save_game_class_name
  if (!array || (typeof cls === 'string' && !cls.includes(SAVE_CLASS))) {
    throw new Error(
      `${fileName} does not look like a Dimensional Pal Storage file: expected a ${SAVE_CLASS} with a SaveParameterArray.`,
    )
  }

  const slots = arr<Node>(array)
  const pals: Pal[] = []
  for (const [i, entry] of slots.entries()) {
    const sp = entry?.SaveParameter?.value
    const species = str(sp?.CharacterID)
    // An empty slot is a whole record of defaults, not an absent one.
    if (!sp || !species || species === 'None') continue

    const instanceId = nonZero(guid(entry?.InstanceId?.value?.InstanceId))
    if (!instanceId) {
      warn.add('unreadable-entry', 'stored pal without an InstanceId')
      continue
    }

    pals.push({
      ...readPal(undefined, sp, instanceId),
      containerId: undefined,
      slotIndex: i,
      pos: undefined,
      storage: 'dimensional',
    })
  }

  return { pals, slots: slots.length }
}

/**
 * Whose storage a file is, from the pals in it.
 *
 * The file names nobody, and its name is only a convention. Every stored pal
 * carries its owner, though, so a file that is not empty says whose it is —
 * when they all agree. Used when the name does not, and to notice when a file
 * has been renamed to someone else's.
 */
export function storageOwner(pals: readonly Pal[]): Guid | undefined {
  const owners = new Set(pals.map((p) => p.ownerPlayerUid))
  const [only] = owners
  return owners.size === 1 ? only : undefined
}
