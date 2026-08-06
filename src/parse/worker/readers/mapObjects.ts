/**
 * Reads `MapObjectSaveData` — every placed thing in the world, from a player's
 * chest to an ore node.
 *
 * Two details matter and are easy to get wrong:
 *
 * 1. Position lives at `Model.RawData.initital_transform_cache`. The
 *    misspelling is in the game data; `WorldLocation` also exists but
 *    PalworldSaveTools deliberately skips decoding it, and so do we.
 *
 * 2. The chest → inventory link is in `ConcreteModel.ModuleMap`, keyed
 *    `...::ItemContainer`, not in `ConcreteModel.RawData`. See
 *    `module()` in `src/parse/gvas.ts`.
 */

import { arr, guid, module, str, translation, type Node } from '../../gvas.ts'
import { nonZero, normGuid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type { Structure } from '../../../domain/types.ts'

export function readMapObjects(
  mapObjectArray: Node,
  warn: Warnings,
): Structure[] {
  const structures: Structure[] = []

  for (const entry of arr<Node>(mapObjectArray)) {
    const raw = entry?.Model?.value?.RawData?.value
    const instanceId = normGuid(raw?.instance_id)
    if (!raw || !instanceId) {
      warn.add('unreadable-entry', 'map object without a Model instance_id')
      continue
    }

    const pos = translation(raw.initital_transform_cache)
    if (!pos) {
      warn.add('unreadable-entry', `map object ${instanceId} has no transform`)
      continue
    }

    const concreteModel = entry?.ConcreteModel
    const containerModule = module(concreteModel, 'ItemContainer')
    const lockModule = module(concreteModel, 'PasswordLock')
    const workModule = module(concreteModel, 'Workee')
    const baseCampId = nonZero(normGuid(raw.base_camp_id_belong_to))

    structures.push({
      instanceId,
      mapObjectId: str(entry?.MapObjectId) ?? '',
      concreteModelType:
        typeof concreteModel?.value?.RawData?.value?.concrete_model_type ===
        'string'
          ? concreteModel.value.RawData.value.concrete_model_type
          : undefined,
      pos,
      hpCurrent:
        typeof raw.hp?.current === 'number' ? raw.hp.current : undefined,
      hpMax: typeof raw.hp?.max === 'number' ? raw.hp.max : undefined,
      baseCampId,
      groupId: nonZero(normGuid(raw.group_id_belong_to)),
      buildPlayerUid: nonZero(normGuid(raw.build_player_uid)),
      containerId: nonZero(guid(containerModule?.target_container_id)),
      workId: nonZero(guid(workModule?.work_id ?? workModule?.id)),
      /**
       * A non-empty `password` is the only trustworthy signal.
       *
       * `lock_state` looks like the obvious one and is not: in the reference
       * save, 42 objects carry a `PasswordLock` module and 37 of them have
       * `lock_state: 1` with no password set, so treating it as a boolean
       * marks nearly every chest in the world "locked". It does not even
       * correlate the other way — of the 5 objects that *do* have a password,
       * four read `lock_state: 0` and one reads `1`. `player_infos` (who has
       * been told the password) moves with the password string, not with
       * `lock_state`, which is the tell.
       */
      locked:
        typeof lockModule?.password === 'string' &&
        lockModule.password.length > 0,
      isBuilt: baseCampId !== undefined,
    })
  }

  return structures
}
