/**
 * Reads `BaseCampSaveData`.
 *
 * A base's assigned worker pals are not listed here — they are reached via
 * `WorkerDirector.RawData.container_id`, which points into
 * `CharacterContainerSaveData`.
 */

import { arr, translation, type Node } from '../../gvas.ts'
import { nonZero, normGuid, type Guid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type { Base } from '../../../domain/types.ts'

export function readBases(baseMap: Node, warn: Warnings): Base[] {
  const bases: Base[] = []

  for (const entry of arr<Node>(baseMap)) {
    const raw = entry?.value?.RawData?.value
    const baseId = normGuid(raw?.id) ?? normGuid(entry?.key)
    if (!raw || !baseId) {
      warn.add('unreadable-entry', 'base camp without an id')
      continue
    }

    const pos = translation(raw.transform)
    if (!pos) {
      warn.add('unreadable-entry', `base camp ${baseId} has no transform`)
      continue
    }

    bases.push({
      baseId,
      // A Japanese placeholder such as 新規生成拠点テンプレート名1(仮) —
      // "new base template name 1 (provisional)". Never shown as-is; the UI
      // names bases by their nearest landmark instead.
      rawName: typeof raw.name === 'string' ? raw.name : '',
      groupId: nonZero(normGuid(raw.group_id_belong_to)),
      pos,
      areaRange: typeof raw.area_range === 'number' ? raw.area_range : 3500,
      ownerMapObjectInstanceId: nonZero(
        normGuid(raw.owner_map_object_instance_id),
      ),
      workerContainerId: nonZero(
        normGuid(
          entry?.value?.WorkerDirector?.value?.RawData?.value?.container_id,
        ),
      ),
      workIds: arr<unknown>(
        entry?.value?.WorkCollection?.value?.RawData?.value?.work_ids ?? [],
      )
        .map((w) => normGuid(w))
        .filter((g): g is Guid => g !== undefined),
      state: typeof raw.state === 'number' ? raw.state : undefined,
    })
  }

  return bases
}
