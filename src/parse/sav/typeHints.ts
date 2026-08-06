/**
 * Struct types the archive format cannot infer.
 *
 * Unreal writes a map's key/value struct type only sometimes; where it does
 * not, the reader has to be told. Every entry here is a path whose struct type
 * is otherwise ambiguous — get one wrong and the reader desynchronises and
 * every subsequent property is garbage.
 *
 * Generated from PalworldSaveTools `paltypes.py` (MIT) by
 * `scripts/gen-sav-tables.ts`. Do not edit by hand.
 */

export const TYPE_HINTS: Readonly<Record<string, string>> = {
  '.SaveData.Local_MaxFriendshipPalIds.Key': 'StructProperty',
  '.SaveData.Local_MaxFriendshipPalIds.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Key': 'Guid',
  '.worldSaveData.BaseCampSaveData.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Value.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.CharacterContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.CharacterContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value':
    'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value':
    'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.RewardSaveDataMap.Key':
    'Guid',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.RewardSaveDataMap.Value':
    'StructProperty',
  '.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value': 'StructProperty',
  '.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value.TreasureBoxInfoMapBySpawnerName.Value':
    'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Key': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value':
    'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Key':
    'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Value':
    'StructProperty',
  '.worldSaveData.GroupSaveDataMap.Key': 'Guid',
  '.worldSaveData.GroupSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.GuildExtraSaveDataMap.Key': 'Guid',
  '.worldSaveData.GuildExtraSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.InvaderDeclarationSaveData.ValidatedStartPointIds.StructProperty':
    'Guid',
  '.worldSaveData.InvaderSaveData.Key': 'Guid',
  '.worldSaveData.InvaderSaveData.Value': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value':
    'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value':
    'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Key': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Key':
    'Guid',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value':
    'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value.ItemMap.Value':
    'StructProperty',
  '.worldSaveData.OilrigSaveData.OilrigMap.Value': 'StructProperty',
  '.worldSaveData.SupplySaveData.SupplyInfos.Key': 'Guid',
  '.worldSaveData.SupplySaveData.SupplyInfos.Value': 'StructProperty',
  '.worldSaveData.WorkSaveData.WorkSaveData.WorkAssignMap.Value':
    'StructProperty',
}
