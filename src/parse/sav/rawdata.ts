/**
 * Palworld's `RawData` decoders.
 *
 * Several properties in a Palworld save are declared as a plain
 * `ArrayProperty` of bytes and then given their own private layout — the game
 * serialises structs it did not want to describe through Unreal's property
 * system. Each entry here reads one of those blobs.
 *
 * Ported from PalworldSaveTools `src/palsav/palsav/rawdata/*.py`.
 *
 * ## Which blobs are decoded
 *
 * The ones the domain model reads, and no others. PalworldSaveTools decodes
 * every blob because its job is a lossless round-trip; this project's job is
 * to produce a `SaveIndex`, and blobs nothing reads are left as bytes rather
 * than given hundreds of lines of per-object-type layout code that could only
 * ever be wrong in silence. {@link DECODED_PATHS} is the explicit list, and
 * `test/golden/savPipeline.golden.test.ts` proves the result is identical to
 * the JSON path's.
 *
 * The notable omissions are the foliage grid, the guild lab and item storage,
 * work assignments, and the per-object-type bodies of concrete models beyond
 * their class name.
 */

import { CONCRETE_MODEL_CLASS } from './concreteModels.ts'
import type { FArchiveReader, Json } from './farchive.ts'

type Dict = Record<string, Json>

/** A decoder over the bytes of one blob. */
type BytesDecoder = (r: FArchiveReader) => Json

/**
 * Wraps a bytes-decoder as a custom property.
 *
 * Every one of these follows the same three steps: read the underlying
 * `ArrayProperty` normally (passing `path` as the nested caller so the custom
 * lookup does not recurse into itself), take its bytes, and replace `value`
 * with the decoded object.
 */
function overBytes(decode: BytesDecoder) {
  return (
    reader: FArchiveReader,
    typeName: string,
    size: number,
    path: string,
  ): Dict => {
    if (typeName !== 'ArrayProperty') {
      throw new Error(`Expected ArrayProperty at ${path}, got ${typeName}`)
    }
    const value = reader.property(typeName, size, path, path)
    const bytes = (value['value'] as { values: Uint8Array }).values
    value['value'] = bytes.length === 0 ? null : decode(reader.sub(bytes))
    return value
  }
}

/* -------------------------------------------------------------------------
   The blobs
   ------------------------------------------------------------------------- */

/** A pal or player. `object.SaveParameter` holds everything about them. */
const character: BytesDecoder = (r) => {
  const data: Dict = {
    object: r.propertiesUntilEnd(),
    unknown_bytes: r.byteList(4),
    // The link to the owning guild, and a sibling of `object` rather than a
    // property inside it — which is why it needs this decoder at all.
    group_id: r.guid(),
  }
  data['trailing_bytes'] = r.byteList(4)
  if (!r.eof()) data['trailing_unknown_bytes'] = r.readToEnd()
  return data
}

/** One stack in a chest. */
const itemContainerSlot: BytesDecoder = (r) => ({
  slot_index: r.i32(),
  count: r.i32(),
  item: {
    static_id: r.fstring(),
    dynamic_id: {
      created_world_id: r.guid(),
      local_id_in_created_world: r.guid(),
    },
  },
  trailing_bytes: r.byteNumbers(r.size - r.offset),
})

/** One pal in a palbox, party or worker roster. */
const characterContainerSlot: BytesDecoder = (r) => {
  const data: Dict = {
    player_uid: r.guid(),
    instance_id: r.guid(),
    permission_tribe_id: r.byte(),
  }
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

/**
 * A pal egg, if these bytes are one.
 *
 * Speculative by necessity — see {@link dynamicItem}. Rewinds and returns
 * `null` when the layout does not fit, which is the common case.
 */
function tryReadEgg(r: FArchiveReader): Dict | null {
  const at = r.offset
  try {
    const data: Dict = { type: 'egg' }
    data['leading_bytes'] = r.byteList(4)
    data['character_id'] = r.fstring()
    data['object'] = r.propertiesUntilEnd()
    data['trailing_bytes'] = r.byteList(28)
    if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
    return data
  } catch {
    r.offset = at
    return null
  }
}

/**
 * Durability, ammo and per-item passives for one specific item instance.
 *
 * **The item's kind is not in the blob.** After the id there is just a body,
 * and which of three layouts it is has to be worked out from how the bytes
 * fit: an egg is tried first and rewound if it does not parse, exactly twelve
 * remaining bytes means armour, and anything else is read as a weapon — itself
 * rewound to an opaque trailer if that fails too.
 *
 * Guessing a type string here instead (the obvious-looking implementation)
 * yields `kind: ""` and no durability at all, which is how this was caught.
 */
const dynamicItem: BytesDecoder = (r) => {
  const data: Dict = { type: 'unknown' }
  data['id'] = {
    created_world_id: r.guid(),
    local_id_in_created_world: r.guid(),
    static_id: r.fstring(),
  }

  const egg = tryReadEgg(r)
  if (egg) {
    Object.assign(data, egg)
    return data
  }

  // Armour is leading(4) + durability(4) + trailing(4) and nothing else, so
  // the remaining length identifies it outright.
  if (r.size - r.offset === 12) {
    data['type'] = 'armor'
    data['leading_bytes'] = r.byteList(4)
    data['durability'] = r.float()
    data['trailing_bytes'] = r.byteList(4)
    if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
    return data
  }

  const at = r.offset
  try {
    const weapon: Dict = { type: 'weapon' }
    weapon['leading_bytes'] = r.byteList(4)
    weapon['durability'] = r.float()
    weapon['remaining_bullets'] = r.i32()
    weapon['passive_skill_list'] = r.tarray((x) => x.fstring())
    weapon['trailing_bytes'] = r.byteList(4)
    if (!r.eof()) weapon['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
    Object.assign(data, weapon)
  } catch {
    r.offset = at
    data['trailer'] = r.byteNumbers(r.size - r.offset)
  }
  return data
}

/** A base camp: where it is, how big, and which guild owns it. */
const baseCamp: BytesDecoder = (r) => {
  const data: Dict = {
    id: r.guid(),
    // Always the Japanese placeholder; the UI names bases by landmark instead.
    name: r.fstring(),
    state: r.byte(),
    transform: r.ftransform(),
    area_range: r.float(),
    group_id_belong_to: r.guid(),
    fast_travel_local_transform: r.ftransform(),
    owner_map_object_instance_id: r.guid(),
  }
  data['trailing_bytes'] = r.byteList(4)
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

/** A base's worker roster — `container_id` points at a character container. */
const workerDirector: BytesDecoder = (r) => {
  const data: Dict = {
    id: r.guid(),
    spawn_transform: r.ftransform(),
    current_order_type: r.byte(),
    current_battle_type: r.byte(),
    container_id: r.guid(),
  }
  data['trailing_bytes'] = r.byteList(4)
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

const workCollection: BytesDecoder = (r) => {
  const data: Dict = {
    id: r.guid(),
    work_ids: r.tarray((x) => x.guid()),
  }
  data['trailing_bytes'] = r.byteList(4)
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

/* -------------------------------------------------------------------------
   Groups
   ------------------------------------------------------------------------- */

const GUILD_LIKE = new Set([
  'EPalGroupType::Guild',
  'EPalGroupType::IndependentGuild',
  'EPalGroupType::Organization',
])

function playerInfo(r: FArchiveReader): Dict {
  return {
    player_uid: r.guid(),
    player_info: {
      last_online_real_time: r.i64(),
      player_name: r.fstring(),
    },
  }
}

function guildPlayerInfo(r: FArchiveReader): Dict {
  const p = playerInfo(r)
  p['role'] = r.byte()
  return p
}

function guildMarker(r: FArchiveReader): Dict {
  return {
    marker_id: r.guid(),
    icon_location: r.vectorDict(),
    icon_type: r.i32(),
    owner_player_uid: r.guid(),
  }
}

function rolePermission(r: FArchiveReader): Dict {
  return { role: r.byte(), permissions: r.tarray((x) => x.byte()) }
}

/**
 * The guild tail, in one of two layouts.
 *
 * The 2026-07 update added per-role permissions and a chest-access list, and
 * left **no version flag in the blob**. The two are told apart by trial:
 * whichever layout consumes the bytes exactly is the right one. A v2 read that
 * over- or under-runs is rejected and v1 is tried instead.
 */
function guildTail(r: FArchiveReader): Dict {
  const start = r.offset
  try {
    const tail: Dict = {
      guild_chest_allowed_roles: r.tarray((x) => x.byte()),
      unknown_i32: r.i32(),
      admin_player_uid: r.guid(),
      players: r.tarray(guildPlayerInfo),
      role_permissions: r.tarray(rolePermission),
      trailing_bytes: r.byteList(4),
    }
    if (r.eof()) return tail
  } catch {
    // Not v2 — fall through to the pre-update layout.
  }
  r.offset = start
  return {
    admin_player_uid: r.guid(),
    players: r.tarray(playerInfo),
    trailing_bytes: r.byteList(4),
  }
}

function groupBytes(r: FArchiveReader, groupType: string): Dict {
  const data: Dict = {
    group_type: groupType,
    group_id: r.guid(),
    group_name: r.fstring(),
    individual_character_handle_ids: r.tarray((x) => ({
      guid: x.guid(),
      instance_id: x.guid(),
    })),
  }

  if (GUILD_LIKE.has(groupType)) data['org_type'] = r.byte()
  if (groupType === 'EPalGroupType::Organization') {
    data['trailing_bytes'] = r.byteList(12)
  }

  if (groupType === 'EPalGroupType::Guild') {
    data['leading_bytes'] = r.byteList(4)
    data['base_ids'] = r.tarray((x) => x.guid())
    data['unknown_1'] = r.i32()
    data['base_camp_level'] = r.i32()
    data['map_object_instance_ids_base_camp_points'] = r.tarray((x) => x.guid())
    data['guild_name'] = r.fstring()
    data['last_guild_name_modifier_player_uid'] = r.guid()
    data['guild_markers'] = r.tarray(guildMarker)
    Object.assign(data, guildTail(r))
  }

  if (groupType === 'EPalGroupType::IndependentGuild') {
    data['base_camp_level'] = r.i32()
    data['map_object_instance_ids_base_camp_points'] = r.tarray((x) => x.guid())
    data['guild_name'] = r.fstring()
    data['player_uid'] = r.guid()
    data['guild_name_2'] = r.fstring()
    data['player_info'] = {
      last_online_real_time: r.i64(),
      player_name: r.fstring(),
    }
  }

  return data
}

/** `GroupSaveDataMap` is a map whose values each hold a typed blob. */
function decodeGroupMap(
  reader: FArchiveReader,
  typeName: string,
  size: number,
  path: string,
): Dict {
  if (typeName !== 'MapProperty') {
    throw new Error(`Expected MapProperty at ${path}, got ${typeName}`)
  }
  const value = reader.property(typeName, size, path, path)
  for (const group of value['value'] as { value: Dict }[]) {
    const inner = group.value
    const groupType = ((inner['GroupType'] as Dict)['value'] as Dict)[
      'value'
    ] as string
    const rawData = inner['RawData'] as Dict
    const bytes = (rawData['value'] as { values: Uint8Array }).values
    rawData['value'] = groupBytes(reader.sub(bytes), groupType)
  }
  return value
}

/* -------------------------------------------------------------------------
   Map objects
   ------------------------------------------------------------------------- */

/** Position, HP, and the base and guild a structure belongs to. */
const mapModel: BytesDecoder = (r) => {
  const data: Dict = {
    instance_id: r.guid(),
    concrete_model_instance_id: r.guid(),
    base_camp_id_belong_to: r.guid(),
    group_id_belong_to: r.guid(),
    hp: { current: r.i32(), max: r.i32() },
    initital_transform_cache: r.ftransform(),
    repair_work_id: r.guid(),
    owner_spawner_level_object_instance_id: r.guid(),
    owner_instance_id: r.guid(),
    build_player_uid: r.guid(),
    interact_restrict_type: r.byte(),
    deterioration_damage: r.float(),
    stage_instance_id_belong_to: { id: r.guid(), valid: r.u32() },
  }
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

/**
 * A concrete model's header, and its class name.
 *
 * Only the two leading GUIDs and the looked-up class are read. The remaining
 * bytes have a different layout for each of 65 classes and nothing in the
 * domain model reads them, so they are kept whole under `unparsed_bytes`
 * rather than decoded speculatively.
 */
function concreteModel(r: FArchiveReader, mapObjectId: string): Json {
  const cls = CONCRETE_MODEL_CLASS.get(mapObjectId.toLowerCase())
  if (cls === undefined) return { values: r.readToEnd() }
  return {
    instance_id: r.guid(),
    model_instance_id: r.guid(),
    concrete_model_type: cls,
    unparsed_bytes: r.readToEnd(),
  }
}

function concreteModelModule(r: FArchiveReader, moduleType: string): Json {
  const data: Dict = {}
  switch (moduleType) {
    case 'EPalMapObjectConcreteModelModuleType::ItemContainer':
      // The chest → inventory link.
      data['target_container_id'] = r.guid()
      data['slot_attribute_indexes'] = r.tarray((x) => ({
        attribute: x.byte(),
        indexes: x.tarray((y) => y.i32()),
      }))
      data['all_slot_attribute'] = r.tarray((x) => x.byte())
      data['drop_item_at_disposed'] = r.u32() > 0
      data['usage_type'] = r.byte()
      data['trailing_bytes'] = r.byteList(4)
      break
    case 'EPalMapObjectConcreteModelModuleType::CharacterContainer':
      data['target_container_id'] = r.guid()
      data['trailing_bytes'] = r.byteList(4)
      break
    case 'EPalMapObjectConcreteModelModuleType::Workee':
      data['target_work_id'] = r.guid()
      data['trailing_bytes'] = r.byteList(4)
      break
    case 'EPalMapObjectConcreteModelModuleType::Switch':
      data['switch_state'] = r.byte()
      data['trailing_bytes'] = r.byteList(4)
      break
    case 'EPalMapObjectConcreteModelModuleType::PasswordLock':
      // `password` being non-empty is the only reliable "is locked" signal;
      // see the note in `readers/mapObjects.ts`.
      data['lock_state'] = r.byte()
      data['password'] = r.fstring()
      data['player_infos'] = r.tarray((x) => ({
        player_uid: x.guid(),
        player_name: x.fstring(),
      }))
      data['trailing_bytes'] = r.byteList(4)
      break
    case 'EPalMapObjectConcreteModelModuleType::RequireElementalAction':
      data['unlock_item'] = r.fstring()
      data['trailing_bytes'] = r.byteList(12)
      break
    default:
      // Energy, StatusObserver, ItemStack, PlayerRecord, BaseCampPassiveEffect
      // and anything a patch adds: no payload we read.
      break
  }
  if (!r.eof()) data['unknown_bytes'] = r.byteNumbers(r.size - r.offset)
  return data
}

/**
 * `MapObjectSaveData` is an array of structs, each holding several blobs.
 *
 * `Model.RawData` and the concrete model's modules are decoded because the
 * structure reader needs them; `Connector` and `BuildProcess` are left as
 * bytes.
 */
function decodeMapObjects(
  reader: FArchiveReader,
  typeName: string,
  size: number,
  path: string,
): Dict {
  if (typeName !== 'ArrayProperty') {
    throw new Error(`Expected ArrayProperty at ${path}, got ${typeName}`)
  }
  const value = reader.property(typeName, size, path, path)
  const objects = (value['value'] as { values: Dict[] }).values

  for (const obj of objects) {
    const model = (obj['Model'] as Dict)['value'] as Dict
    const modelRaw = model['RawData'] as Dict
    const modelBytes = (modelRaw['value'] as { values: Uint8Array }).values
    modelRaw['value'] =
      modelBytes.length === 0 ? null : mapModel(reader.sub(modelBytes))

    const mapObjectId = (obj['MapObjectId'] as Dict)['value'] as string
    const concrete = (obj['ConcreteModel'] as Dict)['value'] as Dict
    const concreteRaw = concrete['RawData'] as Dict
    const concreteBytes = (concreteRaw['value'] as { values: Uint8Array })
      .values
    concreteRaw['value'] =
      concreteBytes.length === 0
        ? { values: [] }
        : concreteModel(reader.sub(concreteBytes), mapObjectId)

    const moduleMap = concrete['ModuleMap'] as Dict | undefined
    for (const mod of (moduleMap?.['value'] as {
      key: string
      value: Dict
    }[]) ?? []) {
      const raw = mod.value['RawData'] as Dict
      const bytes = (raw['value'] as { values: Uint8Array }).values
      raw['value'] =
        bytes.length === 0
          ? { values: [] }
          : concreteModelModule(reader.sub(bytes), mod.key)
    }
  }
  return value
}

/* -------------------------------------------------------------------------
   Registry
   ------------------------------------------------------------------------- */

export const CUSTOM_PROPERTIES: Readonly<
  Record<
    string,
    (r: FArchiveReader, type: string, size: number, path: string) => Dict
  >
> = {
  '.worldSaveData.GroupSaveDataMap': decodeGroupMap,
  '.worldSaveData.MapObjectSaveData': decodeMapObjects,
  '.worldSaveData.CharacterSaveParameterMap.Value.RawData':
    overBytes(character),
  '.worldSaveData.ItemContainerSaveData.Value.Slots.Slots.RawData':
    overBytes(itemContainerSlot),
  '.worldSaveData.CharacterContainerSaveData.Value.Slots.Slots.RawData':
    overBytes(characterContainerSlot),
  '.worldSaveData.DynamicItemSaveData.DynamicItemSaveData.RawData':
    overBytes(dynamicItem),
  '.worldSaveData.BaseCampSaveData.Value.RawData': overBytes(baseCamp),
  '.worldSaveData.BaseCampSaveData.Value.WorkerDirector.RawData':
    overBytes(workerDirector),
  '.worldSaveData.BaseCampSaveData.Value.WorkCollection.RawData':
    overBytes(workCollection),
}

/** The blobs this reader decodes, for the docs and the golden test. */
export const DECODED_PATHS = Object.keys(CUSTOM_PROPERTIES)
