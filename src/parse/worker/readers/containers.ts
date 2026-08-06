/**
 * Reads the two container sections.
 *
 * They look alike but are shaped differently, which is a reliable source of
 * bugs:
 *
 * - `ItemContainerSaveData` slots keep `slot_index` and `count` *inside*
 *   `RawData.value`, alongside the item.
 * - `CharacterContainerSaveData` slots keep `SlotIndex` as a sibling GVAS
 *   property *outside* `RawData`.
 */

import { arr, int, type Node } from '../../gvas.ts'
import { nonZero, normGuid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type {
  CharacterContainer,
  Container,
  DynamicItem,
  Dungeon,
  ItemStack,
} from '../../../domain/types.ts'

export function readItemContainers(
  containerMap: Node,
  warn: Warnings,
): Container[] {
  const containers: Container[] = []

  for (const entry of arr<Node>(containerMap)) {
    const containerId = normGuid(entry?.key?.ID?.value)
    if (!containerId) {
      warn.add('unreadable-entry', 'item container without an ID')
      continue
    }

    const slots: ItemStack[] = []
    for (const slot of arr<Node>(entry?.value?.Slots)) {
      const raw = slot?.RawData?.value
      if (!raw) continue
      const staticId = raw.item?.static_id
      // Empty slots are stored as "None" rather than omitted. Keeping the
      // total slot count matters for the inventory grid, so count them here
      // but do not emit a stack.
      if (typeof staticId !== 'string' || staticId === 'None' || !staticId) {
        continue
      }
      slots.push({
        slot:
          typeof raw.slot_index === 'number' ? raw.slot_index : slots.length,
        staticId,
        count: typeof raw.count === 'number' ? raw.count : 1,
        dynamicLocalId: nonZero(
          normGuid(raw.item?.dynamic_id?.local_id_in_created_world),
        ),
      })
    }

    containers.push({
      containerId,
      slots,
      belongGroupId: nonZero(
        normGuid(entry?.value?.BelongInfo?.value?.GroupId?.value),
      ),
      // Ownership is inferred later, once structures are known.
      ownerKind: 'unknown',
      confidence: 'inferred',
      slotCount: arr<Node>(entry?.value?.Slots).length,
      usedSlots: slots.length,
    })
  }

  return containers
}

export function readCharacterContainers(
  containerMap: Node,
  warn: Warnings,
): CharacterContainer[] {
  const containers: CharacterContainer[] = []

  for (const entry of arr<Node>(containerMap)) {
    const containerId = normGuid(entry?.key?.ID?.value)
    if (!containerId) {
      warn.add('unreadable-entry', 'character container without an ID')
      continue
    }

    const slots: CharacterContainer['slots'] = []
    for (const slot of arr<Node>(entry?.value?.Slots)) {
      const instanceId = normGuid(slot?.RawData?.value?.instance_id)
      if (!instanceId || instanceId === '0'.repeat(32)) continue
      slots.push({
        // SlotIndex is a sibling GVAS property here, not part of RawData.
        slot: int(slot?.SlotIndex) ?? slots.length,
        instanceId,
        playerUid: nonZero(normGuid(slot?.RawData?.value?.player_uid)),
      })
    }

    // Ownership is resolved later, once bases and pals are known.
    containers.push({ containerId, slots, confidence: 'inferred' })
  }

  return containers
}

export function readDynamicItems(
  itemArray: Node,
  warn: Warnings,
): DynamicItem[] {
  const items: DynamicItem[] = []

  for (const entry of arr<Node>(itemArray)) {
    const raw = entry?.RawData?.value
    const localId = normGuid(raw?.id?.local_id_in_created_world)
    if (!raw || !localId) {
      warn.add('unreadable-entry', 'dynamic item without a local id')
      continue
    }
    items.push({
      localId,
      staticId:
        typeof raw.id?.static_id === 'string' ? raw.id.static_id : undefined,
      kind: typeof raw.type === 'string' ? raw.type : undefined,
      durability:
        typeof raw.durability === 'number' ? raw.durability : undefined,
      ammo:
        typeof raw.remaining_bullets === 'number'
          ? raw.remaining_bullets
          : undefined,
      passives: Array.isArray(raw.passive_skill_list)
        ? raw.passive_skill_list.filter(
            (p: unknown): p is string => typeof p === 'string',
          )
        : [],
    })
  }

  return items
}

export function readDungeons(dungeonArray: Node): Dungeon[] {
  const dungeons: Dungeon[] = []

  for (const entry of arr<Node>(dungeonArray)) {
    const instanceId = normGuid(entry?.InstanceId?.value)
    if (!instanceId) continue
    dungeons.push({
      instanceId,
      type: tailOf(entry?.DungeonType?.value?.value),
      area: entry?.DungeonSpawnAreaId?.value,
      levelName: entry?.DungeonLevelName?.value,
      bossState: tailOf(entry?.BossState?.value?.value),
      markerPointId: nonZero(normGuid(entry?.MarkerPointId?.value)),
    })
  }

  return dungeons
}

function tailOf(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined
  const sep = s.lastIndexOf('::')
  return sep === -1 ? s : s.slice(sep + 2)
}
