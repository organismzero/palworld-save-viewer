/**
 * Map-object id → concrete model class.
 *
 * Save-format metadata rather than game content: the class name is not stored
 * in the save, it is looked up from the object's id, and it is what
 * `Structure.concreteModelType` reports.
 *
 * Stored inverted — 824 ids collapse to 65 classes —
 * and flattened once at module load. An unknown id is not an error: a game
 * update adds objects faster than a table like this gets refreshed, and the
 * reader simply leaves `concrete_model_type` unset for those.
 *
 * Generated from PalworldSaveTools `rawdata/map_concrete_model.py` (MIT) by
 * `scripts/gen-sav-tables.ts`. Do not edit by hand.
 */

const BY_CLASS: Record<string, string> = {
  DEFAULT_UNKNOWN_PalMapObjectConcreteModelBase:
    'defenseminigun trap_leghold trap_leghold_big trap_mineattack' +
    ' trap_mineelecshock trap_minefreeze trap_movingpanel trap_noose',
  PalBuildObject:
    'andon banyan_big barrel01_iron barrel02_iron barrel03_iron' +
    ' bathtub_stone believer_banner believer_flag bonsai box01_stone byobu' +
    ' cablecoil01_iron clock01_stone clock01_wall_iron' +
    ' conservationgroupbannera conservationgroupbannerb counter_wood' +
    ' curtain01_wall_stone decal_palsticker_pinkcat defensewall' +
    ' defensewall_metal defensewall_wood desk01_iron desk01_stone' +
    ' enemycamp_andon enemycamp_banyan_big enemycamp_barrel01_iron' +
    ' enemycamp_barrel02_iron enemycamp_barrel03_iron' +
    ' enemycamp_barrel_wood enemycamp_basecampitemdispenser' +
    ' enemycamp_basecampworkhard enemycamp_bathtub_stone' +
    ' enemycamp_believer_banner enemycamp_believer_flag' +
    ' enemycamp_bench_wood enemycamp_blastfurnace enemycamp_blastfurnace2' +
    ' enemycamp_blastfurnace3 enemycamp_blastfurnace4 enemycamp_bonsai' +
    ' enemycamp_box01_iron enemycamp_box01_stone enemycamp_box02_iron' +
    ' enemycamp_box_wood enemycamp_buildablegoddessstatue enemycamp_byobu' +
    ' enemycamp_cablecoil01_iron enemycamp_campfire enemycamp_cauldron' +
    ' enemycamp_ceilinglamp enemycamp_chair01_iron enemycamp_chair01_pal' +
    ' enemycamp_chair01_stone enemycamp_chair01_wood' +
    ' enemycamp_chair02_iron enemycamp_chair02_stone' +
    ' enemycamp_characterrankup enemycamp_clock01_stone' +
    ' enemycamp_clock01_wall_iron enemycamp_compositedesk' +
    ' enemycamp_conservationgroupbannera' +
    ' enemycamp_conservationgroupbannerb enemycamp_container01_iron' +
    ' enemycamp_cookingstove enemycamp_cooler enemycamp_coolerbox' +
    ' enemycamp_coolerpalfoodbox enemycamp_copperpit enemycamp_copperpit_2' +
    ' enemycamp_counter_wood enemycamp_crusher' +
    ' enemycamp_curtain01_wall_stone enemycamp_damagedscarecrow' +
    ' enemycamp_defensebowgun enemycamp_defensemachinegun' +
    ' enemycamp_defensemissile enemycamp_defensewait enemycamp_defensewall' +
    ' enemycamp_defensewall_metal enemycamp_defensewall_wood' +
    ' enemycamp_desk01_iron enemycamp_desk01_stone' +
    ' enemycamp_dimensionpalstorage enemycamp_dismantlingconveyor' +
    ' enemycamp_displaycharacter enemycamp_electriccooler' +
    ' enemycamp_electricgenerator enemycamp_electricgenerator_large' +
    ' enemycamp_electrichatchingpalegg enemycamp_electricheater' +
    ' enemycamp_electrickitchen enemycamp_energystorage_electric' +
    ' enemycamp_factory_hard_01 enemycamp_factory_hard_02' +
    ' enemycamp_factory_hard_03 enemycamp_factory_money' +
    ' enemycamp_farmblockv2_berries enemycamp_farmblockv2_carrot' +
    ' enemycamp_farmblockv2_lettuce enemycamp_farmblockv2_onion' +
    ' enemycamp_farmblockv2_potato enemycamp_farmblockv2_tomato' +
    ' enemycamp_farmblockv2_wheet enemycamp_firecult_banner' +
    ' enemycamp_firecult_flag enemycamp_flourmill enemycamp_flowerbed' +
    ' enemycamp_fountain enemycamp_fudukue enemycamp_garbagebag_iron' +
    ' enemycamp_glass_fence enemycamp_glass_foundation' +
    ' enemycamp_glass_pillars enemycamp_glass_roof' +
    ' enemycamp_glass_slantedroof enemycamp_glass_stair' +
    ' enemycamp_glass_trianglewall enemycamp_glass_wall' +
    ' enemycamp_glass_wall_destructable enemycamp_glass_windowwall' +
    ' enemycamp_globalpalstorage enemycamp_globe01_stone' +
    ' enemycamp_goalsoccer_iron enemycamp_guardiandogstatue' +
    ' enemycamp_guildchest enemycamp_hatchingpalegg enemycamp_headstone' +
    ' enemycamp_heater enemycamp_hugekitchen enemycamp_hunter_banner' +
    ' enemycamp_hunter_flag enemycamp_hunter_gangflag enemycamp_icecrusher' +
    ' enemycamp_iron_fence enemycamp_irori enemycamp_itembooth' +
    ' enemycamp_itemchest enemycamp_itemchest_02 enemycamp_itemchest_03' +
    ' enemycamp_itemchest_04 enemycamp_ivy01 enemycamp_ivy02' +
    ' enemycamp_ivy03 enemycamp_japanesestyle_fence' +
    ' enemycamp_japanesestyle_foundation enemycamp_japanesestyle_pillar' +
    ' enemycamp_japanesestyle_roof_01 enemycamp_japanesestyle_roof_02' +
    ' enemycamp_japanesestyle_slantedroof enemycamp_japanesestyle_stair' +
    ' enemycamp_japanesestyle_trianglewall enemycamp_japanesestyle_wall_01' +
    ' enemycamp_japanesestyle_wall_01_destructable' +
    ' enemycamp_japanesestyle_windowwall enemycamp_kakejiku enemycamp_koro' +
    ' enemycamp_lab enemycamp_lamp enemycamp_largeceilinglamp' +
    ' enemycamp_largelamp enemycamp_light_candlesticks_top' +
    ' enemycamp_light_candlesticks_wall enemycamp_light_fireplace01' +
    ' enemycamp_light_fireplace02 enemycamp_light_floorlamp01' +
    ' enemycamp_light_floorlamp02 enemycamp_light_lightpole01' +
    ' enemycamp_light_lightpole02 enemycamp_light_lightpole03' +
    ' enemycamp_light_lightpole04 enemycamp_lilyqueenstatue' +
    ' enemycamp_machinegame01_iron enemycamp_machinevending01_iron' +
    ' enemycamp_manualelectricgenerator enemycamp_medicalpalbed_02' +
    ' enemycamp_medicalpalbed_03 enemycamp_medicalpalbed_04' +
    ' enemycamp_medicalpalbed_05 enemycamp_medicinefacility_01' +
    ' enemycamp_medicinefacility_02 enemycamp_medicinefacility_03' +
    ' enemycamp_metal_foundation enemycamp_metal_pillars' +
    ' enemycamp_metal_roof enemycamp_metal_slantedroof' +
    ' enemycamp_metal_stair enemycamp_metal_trianglewall' +
    ' enemycamp_metal_wall enemycamp_metal_wall_destructable' +
    ' enemycamp_metal_windowwall enemycamp_miningtool' +
    ' enemycamp_mirror01_stone enemycamp_mirror01_wall_stone' +
    ' enemycamp_mirror02_stone enemycamp_multielectrichatchingpalegg' +
    ' enemycamp_ninja_banner enemycamp_ninja_flag enemycamp_oilpump' +
    ' enemycamp_olympiccauldron enemycamp_operatingtable' +
    ' enemycamp_palbooth enemycamp_palcage enemycamp_palfoodbox' +
    ' enemycamp_palmedicinebox enemycamp_partition_stone' +
    ' enemycamp_piano01_stone enemycamp_piano02_stone' +
    ' enemycamp_pipeclay01_iron enemycamp_plant01_plant' +
    ' enemycamp_plant02_plant enemycamp_plant03_plant' +
    ' enemycamp_plant04_plant enemycamp_playerbed_02' +
    ' enemycamp_playerbed_03 enemycamp_police_banner enemycamp_police_flag' +
    ' enemycamp_refrigerator enemycamp_repairbench enemycamp_rug01_stone' +
    ' enemycamp_rug02_stone enemycamp_rug03_stone enemycamp_rug04_stone' +
    ' enemycamp_sanitydecrease1 enemycamp_scientist_banner' +
    ' enemycamp_scientist_flag enemycamp_seika enemycamp_sf_fence' +
    ' enemycamp_sf_foundation enemycamp_sf_pillars enemycamp_sf_roof' +
    ' enemycamp_sf_slantedroof enemycamp_sf_stair' +
    ' enemycamp_sf_trianglewall enemycamp_sf_wall' +
    ' enemycamp_sf_wall_destructable enemycamp_sf_windowwall' +
    ' enemycamp_shelf01_iron enemycamp_shelf01_stone' +
    ' enemycamp_shelf01_wall_iron enemycamp_shelf01_wall_stone' +
    ' enemycamp_shelf02_iron enemycamp_shelf02_stone' +
    ' enemycamp_shelf03_iron enemycamp_shelf03_stone' +
    ' enemycamp_shelf04_iron enemycamp_shelf04_stone' +
    ' enemycamp_shelf05_stone enemycamp_shelf06_stone' +
    ' enemycamp_shelf07_stone enemycamp_shelf_cask_wood' +
    ' enemycamp_shelf_hang01_wood enemycamp_shelf_hang02_wood' +
    ' enemycamp_shelf_wood enemycamp_shishiodoshi' +
    ' enemycamp_signexit_ceiling_iron enemycamp_signexit_wall_iron' +
    ' enemycamp_silo enemycamp_skinchange enemycamp_snowman' +
    ' enemycamp_sofa01_iron enemycamp_sofa01_stone enemycamp_sofa02_iron' +
    ' enemycamp_sofa02_stone enemycamp_sofa03_stone enemycamp_spa' +
    ' enemycamp_spa2 enemycamp_spherefactory_black_01' +
    ' enemycamp_spherefactory_black_02 enemycamp_spherefactory_black_03' +
    ' enemycamp_spherefactory_black_04 enemycamp_stationdeforest2' +
    ' enemycamp_stone_fence enemycamp_stone_foundation' +
    ' enemycamp_stone_pillar enemycamp_stone_roof' +
    ' enemycamp_stone_slantedroof enemycamp_stone_stair' +
    ' enemycamp_stone_trianglewall enemycamp_stone_wall' +
    ' enemycamp_stone_wall_destructable enemycamp_stone_windowwall' +
    ' enemycamp_stonepit enemycamp_stool01_iron enemycamp_stool01_stone' +
    ' enemycamp_stool_high_wood enemycamp_stool_wood' +
    ' enemycamp_stove01_stone enemycamp_stump' +
    ' enemycamp_tablecircular01_iron enemycamp_tablecircular01_stone' +
    ' enemycamp_tablecircular_wood enemycamp_tabledresser01_stone' +
    ' enemycamp_tableside01_iron enemycamp_tablesink01_stone' +
    ' enemycamp_tablesquare01_iron enemycamp_tablesquare02_iron' +
    ' enemycamp_tablesquare_wood enemycamp_tansu' +
    ' enemycamp_television01_iron enemycamp_tire01_iron' +
    ' enemycamp_toilet01_stone enemycamp_toiletholder01_stone' +
    ' enemycamp_toolboxv1 enemycamp_torch enemycamp_toro' +
    ' enemycamp_towlrack01_stone enemycamp_trafficbarricade01_iron' +
    ' enemycamp_trafficbarricade02_iron enemycamp_trafficbarricade03_iron' +
    ' enemycamp_trafficbarricade04_iron enemycamp_trafficbarricade05_iron' +
    ' enemycamp_trafficcone01_iron enemycamp_trafficcone02_iron' +
    ' enemycamp_trafficcone03_iron enemycamp_trafficsign01_iron' +
    ' enemycamp_trafficsign02_iron enemycamp_trafficsign03_iron' +
    ' enemycamp_trafficsign04_iron enemycamp_transmissiontower' +
    ' enemycamp_trap_noose enemycamp_wallsignboard_no101' +
    ' enemycamp_wallsignboard_no102 enemycamp_wallsignboard_no103' +
    ' enemycamp_wallsignboard_no104 enemycamp_wallsignboard_no105' +
    ' enemycamp_wallsignboard_no106 enemycamp_wallsignboard_no107' +
    ' enemycamp_wallsignboard_no108 enemycamp_wallsignboard_no109' +
    ' enemycamp_wallsignboard_no110 enemycamp_walltorch' +
    ' enemycamp_weaponfactory_dirty_01 enemycamp_weaponfactory_dirty_02' +
    ' enemycamp_weaponfactory_dirty_03 enemycamp_wire_fence' +
    ' enemycamp_wood_fence enemycamp_wood_slantedroof' +
    ' enemycamp_wood_trianglewall enemycamp_wood_windowwall' +
    ' enemycamp_wooden_foundation enemycamp_wooden_ladder' +
    ' enemycamp_wooden_pillar enemycamp_wooden_roof enemycamp_wooden_stair' +
    ' enemycamp_wooden_wall enemycamp_wooden_wall_destructable' +
    ' enemycamp_woodenbarricade enemycamp_workbench' +
    ' enemycamp_workbench_skillunlock enemycamp_workspeedincrease1' +
    ' enemycamp_zabuton enemycamp_zaisu firecult_banner firecult_flag' +
    ' fudukue garbagebag_iron glass_fence glass_foundation glass_pillars' +
    ' glass_roof glass_slantedroof glass_stair glass_trianglewall' +
    ' glass_wall glass_windowwall globe01_stone goalsoccer_iron' +
    ' guardiandogstatue hunter_banner hunter_flag hunter_gangflag' +
    ' iron_fence irori ivy01 ivy02 ivy03 japanesestyle_fence' +
    ' japanesestyle_foundation japanesestyle_pillar japanesestyle_roof_01' +
    ' japanesestyle_roof_02 japanesestyle_slantedroof japanesestyle_stair' +
    ' japanesestyle_trianglewall japanesestyle_wall_01' +
    ' japanesestyle_windowwall kakejiku koro lilyqueenstatue' +
    ' machinegame01_iron machinevending01_iron metal_foundation' +
    ' metal_pillars metal_roof metal_slantedroof metal_stair' +
    ' metal_trianglewall metal_wall metal_windowwall mirror01_stone' +
    ' mirror01_wall_stone mirror02_stone ninja_banner ninja_flag palcage' +
    ' partition_stone piano01_stone piano02_stone pipeclay01_iron' +
    ' plant01_plant plant02_plant plant03_plant plant04_plant' +
    ' police_banner police_flag rug01_stone rug02_stone rug03_stone' +
    ' rug04_stone rug_wood scientist_banner scientist_flag seika sf_desk' +
    ' sf_fence sf_foundation sf_pillars sf_roof sf_slantedroof sf_stair' +
    ' sf_trianglewall sf_wall sf_windowwall shelf_hang02_wood shishiodoshi' +
    ' signexit_ceiling_iron signexit_wall_iron sofa03_stone stone_fence' +
    ' stone_foundation stone_pillar stone_roof stone_slantedroof' +
    ' stone_stair stone_trianglewall stone_wall stone_windowwall' +
    ' stonehouse1 stove01_stone strawhouse1 table1 tablecircular01_iron' +
    ' tablecircular01_stone tablecircular_wood tableside01_iron' +
    ' tablesink01_stone tablesquare01_iron tablesquare02_iron' +
    ' tablesquare_wood television01_iron tire01_iron toiletholder01_stone' +
    ' toro towlrack01_stone trafficbarricade01_iron' +
    ' trafficbarricade02_iron trafficbarricade03_iron' +
    ' trafficbarricade04_iron trafficbarricade05_iron trafficcone01_iron' +
    ' trafficcone02_iron trafficcone03_iron trafficlight01_iron' +
    ' trafficsign01_iron trafficsign02_iron trafficsign03_iron' +
    ' trafficsign04_iron wire_fence wood_fence wood_slantedroof' +
    ' wood_trianglewall wood_windowwall wooden_foundation wooden_ladder' +
    ' wooden_pillar wooden_roof wooden_stair wooden_wall woodenbarricade' +
    ' woodhouse1',
  PalBuildObjectBreedFarm: 'enemycamp_breedfarm',
  PalBuildObjectConvertCharacterToItem: 'dismantlingconveyor',
  PalBuildObjectMonsterFarm: 'enemycamp_monsterfarm',
  PalBuildObjectRaidBossSummon: 'altar enemycamp_altar',
  PalMapObjectAmusementModel: 'spa spa2 spa3',
  PalMapObjectBaseCampItemDispenserModel: 'basecampitemdispenser',
  PalMapObjectBaseCampPassiveEffectModel:
    'cauldron flowerbed fountain miningtool olympiccauldron' +
    ' sanitydecrease1 silo snowman stump toolboxv1 toolboxv2' +
    ' transmissiontower workspeedincrease1',
  PalMapObjectBaseCampPassiveWorkHardModel: 'basecampworkhard',
  PalMapObjectBaseCampPoint: 'palboxv2',
  PalMapObjectBaseCampWorkerDirectorModel:
    'basecampbattledirector enemycamp_basecampbattledirector',
  PalMapObjectBaseCampWorkerExtraStationModel: 'basecampworkerextrastation',
  PalMapObjectBreedFarmModel: 'breedfarm',
  PalMapObjectCharacterMakeModel: 'tabledresser01_stone',
  PalMapObjectCharacterStatusOperatorModel: 'buildablegoddessstatue',
  PalMapObjectCharacterTeamMissionModel: 'expedition',
  PalMapObjectConvertItemModel:
    'blastfurnace blastfurnace2 blastfurnace3 blastfurnace4 blastfurnace5' +
    ' campfire compositedesk cookingstove crusher electrickitchen' +
    ' factory_comfortable_01 factory_comfortable_02 factory_hard_01' +
    ' factory_hard_02 factory_hard_03 factory_hard_04 factory_money' +
    ' flourmill hightechkitchen hugekitchen icecrusher medicinefacility_01' +
    ' medicinefacility_02 medicinefacility_03 spherefactory_black_01' +
    ' spherefactory_black_02 spherefactory_black_03 spherefactory_black_04' +
    ' spherefactory_white_01 spherefactory_white_02 spherefactory_white_03' +
    ' weaponfactory_clean_01 weaponfactory_clean_02 weaponfactory_clean_03' +
    ' weaponfactory_dirty_01 weaponfactory_dirty_02 weaponfactory_dirty_03' +
    ' weaponfactory_dirty_04 woodcrusher workbench workbench_skillcard' +
    ' workbench_skillunlock',
  PalMapObjectDamagedScarecrowModel: 'damagedscarecrow',
  PalMapObjectDeathDroppedCharacterModel: 'droppedcharacter',
  PalMapObjectDeathPenaltyStorageModel: 'deathpenaltychest',
  PalMapObjectDefenseBulletLauncherModel:
    'defensebowgun defensegatlinggun defensemachinegun defensemissile',
  PalMapObjectDefenseWaitModel: 'defensewait',
  PalMapObjectDimensionPalStorageModel: 'dimensionpalstorage',
  PalMapObjectDisplayCharacterModel: 'displaycharacter',
  PalMapObjectDoorModel:
    'enemycamp_glass_doorwall enemycamp_japanesestyle_doorwall_01' +
    ' enemycamp_japanesestyle_doorwall_02' +
    ' enemycamp_japanesestyle_doorwall_03 enemycamp_metal_doorwall' +
    ' enemycamp_metal_gate enemycamp_sf_doorwall enemycamp_stone_doorwall' +
    ' enemycamp_stone_gate enemycamp_wood_gate enemycamp_wooden_doorwall' +
    ' glass_doorwall japanesestyle_doorwall_01 japanesestyle_doorwall_02' +
    ' japanesestyle_doorwall_03 metal_doorwall metal_gate sf_doorwall' +
    ' stone_doorwall stone_gate wood_gate wooden_doorwall',
  PalMapObjectDropItemModel: 'commondropitem3d commondropitem3d_sk',
  PalMapObjectEnergyStorageModel: 'energystorage_electric',
  PalMapObjectFarmBlockV2Model:
    'farmblockv2_berries farmblockv2_carrot farmblockv2_grade01' +
    ' farmblockv2_grade02 farmblockv2_grade03 farmblockv2_lettuce' +
    ' farmblockv2_onion farmblockv2_potato farmblockv2_tomato' +
    ' farmblockv2_wheet',
  PalMapObjectFarmSkillFruitsModel: 'farm_skillfruits',
  PalMapObjectFastTravelPointModel: 'fasttravelpoint',
  PalMapObjectFishPondModel: 'fishingpond1 fishingpond2',
  PalMapObjectGenerateEnergyModel:
    'electricgenerator electricgenerator2 electricgenerator3' +
    ' electricgenerator_large electricgenerator_slave' +
    ' manualelectricgenerator',
  PalMapObjectGlobalPalStorageModel: 'globalpalstorage',
  PalMapObjectGuildChestModel: 'guildchest',
  PalMapObjectHatchingEggModel: 'electrichatchingpalegg hatchingpalegg',
  PalMapObjectHeatSourceModel: 'cooler electriccooler electricheater heater',
  PalMapObjectInstantEffectModel: 'yakushima_healheart',
  PalMapObjectItemBoothModel: 'itembooth',
  PalMapObjectItemChestModel:
    'barrel_wood box01_iron box02_iron box_wood container01_iron' +
    ' dev_itemchest itemchest itemchest_02 itemchest_03 itemchest_04' +
    ' shelf01_iron shelf01_stone shelf01_wall_iron shelf01_wall_stone' +
    ' shelf02_iron shelf02_stone shelf03_iron shelf03_stone shelf04_iron' +
    ' shelf04_stone shelf05_stone shelf06_stone shelf07_stone' +
    ' shelf_cask_wood shelf_hang01_wood shelf_wood tansu',
  PalMapObjectItemChest_AffectCorruption: 'coolerbox refrigerator',
  PalMapObjectItemDropOnDamagModel:
    'damagablerock0001 damagablerock0002 damagablerock0003' +
    ' damagablerock0004 damagablerock0005 damagablerock0006' +
    ' damagablerock0007 damagablerock0008 damagablerock0009' +
    ' damagablerock0010 damagablerock0011 damagablerock0012' +
    ' damagablerock0013 damagablerock0014 damagablerock0015' +
    ' damagablerock0016 damagablerock0017 damagablerock0018' +
    ' damagablerock0019 damagablerock_pv damagabletree_yakushima001' +
    ' damagabletree_yakushima002 damagabletree_yakushima003' +
    ' destroyablewall_rock01 destroyablewall_rock02 meteordrop_damagable' +
    ' yakushima_crystal yakushima_pot',
  PalMapObjectLabModel: 'lab',
  PalMapObjectLampModel:
    'ceilinglamp enemycamp_lanterntop enemycamp_shrine_lantern lamp' +
    ' lanterntop largeceilinglamp largelamp light_candlesticks_top' +
    ' light_candlesticks_wall light_floorlamp01 light_floorlamp02' +
    ' light_lightpole01 light_lightpole02 light_lightpole03' +
    ' light_lightpole04 shrine_lantern',
  PalMapObjectMedicalPalBedModel:
    'medicalpalbed medicalpalbed_02 medicalpalbed_03 medicalpalbed_04' +
    ' medicalpalbed_05',
  PalMapObjectMonsterFarmModel: 'monsterfarm',
  PalMapObjectMultiHatchingEggModel:
    'multielectrichatchingpalegg multihatchingpalegg',
  PalMapObjectOperatingTableModel: 'operatingtable',
  PalMapObjectPalBoothModel: 'palbooth',
  PalMapObjectPalEggModel:
    'palegg palegg_dark palegg_dragon palegg_earth palegg_electricity' +
    ' palegg_fire palegg_ice palegg_leaf palegg_water',
  PalMapObjectPalFoodBoxModel: 'coolerpalfoodbox palfoodbox',
  PalMapObjectPalMedicineBoxModel: 'palmedicinebox',
  PalMapObjectPickupItemOnLevelModel:
    'meteordrop_pickup pickupitem_affectionfruit pickupitem_cavemushroom' +
    ' pickupitem_dogcoin pickupitem_flint pickupitem_log' +
    ' pickupitem_lotus_attack_01 pickupitem_lotus_attack_02' +
    ' pickupitem_lotus_hp_01 pickupitem_lotus_hp_02' +
    ' pickupitem_lotus_stamina_01 pickupitem_lotus_stamina_02' +
    ' pickupitem_lotus_weight_01 pickupitem_lotus_weight_02' +
    ' pickupitem_lotus_workspeed_01 pickupitem_lotus_workspeed_02' +
    ' pickupitem_mushroom pickupitem_nightstone pickupitem_poppy' +
    ' pickupitem_potato pickupitem_redberry pickupitem_stone' +
    ' pickupitem_yakushimamushroom_01 pickupitem_yakushimamushroom_02' +
    ' pickupitem_yakushimamushroom_03 skillfruit_test' +
    ' treasurebox_visiblecontent treasurebox_visiblecontent_skillfruits',
  PalMapObjectPlayerBedModel: 'playerbed playerbed_02 playerbed_03',
  PalMapObjectPlayerSitModel:
    'bench_wood chair01_iron chair01_pal chair01_stone chair01_wood' +
    ' chair02_iron chair02_stone sf_chair sofa01_iron sofa01_stone' +
    ' sofa02_iron sofa02_stone stool01_iron stool01_stone stool_high_wood' +
    ' stool_wood toilet01_stone zabuton zaisu',
  PalMapObjectProductItemModel:
    'coalpit copperpit copperpit_2 crystalpit oilpump quartzpit' +
    ' stationdeforest2 stonepit sulfurpit well woodcreator',
  PalMapObjectRankUpCharacterModel: 'characterrankup',
  PalMapObjectRecoverOtomoModel: 'recoverotomo',
  PalMapObjectRepairItemModel: 'repairbench',
  PalMapObjectShippingItemModel: 'shippingitembox',
  PalMapObjectSignboardModel: 'headstone signboard wallsignboard',
  PalMapObjectSkinChangeModel: 'skinchange',
  PalMapObjectSupplyStorageModel: 'supplydrop',
  PalMapObjectTorchModel:
    'candlestand enemycamp_candlestand enemycamp_firestand' +
    ' enemycamp_walltorch02 firestand light_fireplace01 light_fireplace02' +
    ' torch walltorch walltorch02',
  PalMapObjectTreasureBoxModel:
    'treasurebox treasurebox_electric treasurebox_enemycamp' +
    ' treasurebox_enemycampgoal treasurebox_fire' +
    ' treasurebox_fishingjunk_requiredlonghold' +
    ' treasurebox_fishingjunk_requiredlonghold2 treasurebox_oilrig' +
    ' treasurebox_requiredlonghold treasurebox_water treasurebox_yakushima',
}

/** Keyed by lowercased map object id, as the source table is. */
export const CONCRETE_MODEL_CLASS: ReadonlyMap<string, string> = new Map(
  Object.entries(BY_CLASS).flatMap(([cls, ids]) =>
    ids.split(' ').map((id) => [id, cls] as const),
  ),
)
