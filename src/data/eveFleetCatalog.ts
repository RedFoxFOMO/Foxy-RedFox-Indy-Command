import type {
  CargoBucket,
  GankRiskAssessment,
  HangarHull,
  HullClass,
  HullFitEvaluation,
  HullRecommendation,
  MarketCategoryId,
  SpecialBaySpec,
} from '../types/eve.ts';

// --- Verified EVE Online Hauling Skill Type IDs ---

export const HAULING_SKILL_IDS = {
  GALLENTE_HAULER: 3340,
  MINMATAR_HAULER: 3341,
  CALDARI_HAULER: 3342,
  AMARR_HAULER: 3343,
  TRANSPORT_SHIPS: 19719,
  INDUSTRIAL_COMMAND_SHIPS: 29637,
  UPWELL_HAULER: 81032,
  ORE_FREIGHTER: 34327,
  AMARR_FREIGHTER: 20524,
  CALDARI_FREIGHTER: 20526,
  GALLENTE_FREIGHTER: 20527,
  MINMATAR_FREIGHTER: 20528,
} as const;

export const ALL_HAULING_SKILL_ID_LIST: number[] = Object.values(HAULING_SKILL_IDS);

export interface HullTemplate {
  typeId: number;
  name: string;
  hullClass: HullClass;
  baseCargoM3: number;
  cargoSkillId?: number;
  cargoSkillBonusPerLevel?: number; // e.g., 0.05 = +5%/lvl
  fleetHangarBaseM3?: number;
  fleetHangarSkillId?: number;
  fleetHangarBonusPerLevel?: number;
  specialBays?: {
    name: string;
    baseM3: number;
    skillId?: number;
    bonusPerLevel?: number;
    acceptedBuckets: CargoBucket[];
  }[];
  canFitCovertCloak?: boolean;
  isFreighter?: boolean;
  untankedSafeIsk: number; // Safe ISK threshold without heavy tank
  tankedSafeIsk: number; // Safe ISK threshold when tanked / cloaky
}

// Verified Tranquility Type IDs & base bay volumes via EVE ESI
export const HAULER_HULL_CATALOG: Record<number, HullTemplate> = {
  // --- Specialized T1 Haulers ---
  654: {
    typeId: 654,
    name: 'Kryos',
    hullClass: 'mineral_hauler',
    baseCargoM3: 550,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Mineral Hold',
        baseM3: 50_000,
        skillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['minerals'],
      },
      {
        name: 'Ice Hold',
        baseM3: 30_000,
        skillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['ice'],
      },
    ],
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },
  656: {
    typeId: 656,
    name: 'Miasmos',
    hullClass: 'ore_hauler',
    baseCargoM3: 550,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Mining Hold',
        baseM3: 42_000,
        skillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['ores', 'ice'],
      },
    ],
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },
  655: {
    typeId: 655,
    name: 'Epithal',
    hullClass: 'pi_hauler',
    baseCargoM3: 550,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Planetary Commodities Hold',
        baseM3: 45_000,
        skillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['pi'],
      },
    ],
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },
  651: {
    typeId: 651,
    name: 'Hoarder',
    hullClass: 'ammo_hauler',
    baseCargoM3: 500,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Ammo Hold',
        baseM3: 41_000,
        skillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['ammo'],
      },
    ],
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },

  // --- Standard T1 Industrials ---
  657: {
    typeId: 657,
    name: 'Iteron Mark V',
    hullClass: 't1_industrial',
    baseCargoM3: 5_800,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 160_000_000,
  },
  650: {
    typeId: 650,
    name: 'Nereus',
    hullClass: 't1_industrial',
    baseCargoM3: 2_700,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 200_000_000,
  },
  649: {
    typeId: 649,
    name: 'Tayra',
    hullClass: 't1_industrial',
    baseCargoM3: 7_300,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 160_000_000,
  },
  648: {
    typeId: 648,
    name: 'Badger',
    hullClass: 't1_industrial',
    baseCargoM3: 3_900,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },
  1944: {
    typeId: 1944,
    name: 'Bestower',
    hullClass: 't1_industrial',
    baseCargoM3: 5_400,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 160_000_000,
  },
  19744: {
    typeId: 19744,
    name: 'Sigil',
    hullClass: 't1_industrial',
    baseCargoM3: 2_100,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },
  652: {
    typeId: 652,
    name: 'Mammoth',
    hullClass: 't1_industrial',
    baseCargoM3: 6_200,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 160_000_000,
  },
  653: {
    typeId: 653,
    name: 'Wreathe',
    hullClass: 't1_industrial',
    baseCargoM3: 3_500,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    untankedSafeIsk: 100_000_000,
    tankedSafeIsk: 180_000_000,
  },

  // --- Upwell Equinox Haulers (PI / Fuel / Infrastructure) ---
  81008: {
    typeId: 81008,
    name: 'Squall',
    hullClass: 'upwell_hauler',
    baseCargoM3: 3_000,
    cargoSkillId: HAULING_SKILL_IDS.UPWELL_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Infrastructure Hold',
        baseM3: 45_000,
        skillId: HAULING_SKILL_IDS.UPWELL_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['pi', 'infrastructure'],
      },
    ],
    untankedSafeIsk: 150_000_000,
    tankedSafeIsk: 300_000_000,
  },
  81046: {
    typeId: 81046,
    name: 'Deluge',
    hullClass: 'blockade_runner',
    baseCargoM3: 4_000,
    cargoSkillId: HAULING_SKILL_IDS.UPWELL_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Infrastructure Hold',
        baseM3: 30_000,
        skillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
        bonusPerLevel: 0.05,
        acceptedBuckets: ['pi', 'infrastructure'],
      },
    ],
    canFitCovertCloak: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 4_500_000_000,
  },
  81047: {
    typeId: 81047,
    name: 'Torrent',
    hullClass: 'dst',
    baseCargoM3: 3_000,
    cargoSkillId: HAULING_SKILL_IDS.UPWELL_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 30_000,
    fleetHangarSkillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
    fleetHangarBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Infrastructure Hold',
        baseM3: 60_000,
        skillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
        bonusPerLevel: 0.05,
        acceptedBuckets: ['pi', 'infrastructure'],
      },
    ],
    untankedSafeIsk: 750_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  81040: {
    typeId: 81040,
    name: 'Avalanche',
    hullClass: 'freighter',
    baseCargoM3: 205_000,
    cargoSkillId: HAULING_SKILL_IDS.UPWELL_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    specialBays: [
      {
        name: 'Infrastructure Hold',
        baseM3: 2_000_000,
        skillId: HAULING_SKILL_IDS.UPWELL_HAULER,
        bonusPerLevel: 0.1,
        acceptedBuckets: ['pi', 'infrastructure'],
      },
    ],
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_200_000_000,
  },

  // --- Blockade Runners ---
  12729: {
    typeId: 12729,
    name: 'Crane',
    hullClass: 'blockade_runner',
    baseCargoM3: 3_950,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    canFitCovertCloak: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 5_000_000_000,
  },
  12733: {
    typeId: 12733,
    name: 'Prorator',
    hullClass: 'blockade_runner',
    baseCargoM3: 3_400,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    canFitCovertCloak: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 5_000_000_000,
  },
  12743: {
    typeId: 12743,
    name: 'Viator',
    hullClass: 'blockade_runner',
    baseCargoM3: 3_600,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    canFitCovertCloak: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 5_000_000_000,
  },
  12735: {
    typeId: 12735,
    name: 'Prowler',
    hullClass: 'blockade_runner',
    baseCargoM3: 3_200,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    canFitCovertCloak: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 5_000_000_000,
  },

  // --- Deep Space Transports (DSTs) ---
  12731: {
    typeId: 12731,
    name: 'Bustard',
    hullClass: 'dst',
    baseCargoM3: 4_000,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 50_000,
    fleetHangarSkillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
    fleetHangarBonusPerLevel: 0.05,
    untankedSafeIsk: 750_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  12753: {
    typeId: 12753,
    name: 'Impel',
    hullClass: 'dst',
    baseCargoM3: 3_800,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 50_000,
    fleetHangarSkillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
    fleetHangarBonusPerLevel: 0.05,
    untankedSafeIsk: 750_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  12745: {
    typeId: 12745,
    name: 'Occator',
    hullClass: 'dst',
    baseCargoM3: 3_900,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 50_000,
    fleetHangarSkillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
    fleetHangarBonusPerLevel: 0.05,
    untankedSafeIsk: 750_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  12747: {
    typeId: 12747,
    name: 'Mastodon',
    hullClass: 'dst',
    baseCargoM3: 4_100,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_HAULER,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 50_000,
    fleetHangarSkillId: HAULING_SKILL_IDS.TRANSPORT_SHIPS,
    fleetHangarBonusPerLevel: 0.05,
    untankedSafeIsk: 750_000_000,
    tankedSafeIsk: 2_500_000_000,
  },

  // --- ORE Industrial Command & Ship Maintenance ---
  28606: {
    typeId: 28606,
    name: 'Orca',
    hullClass: 'orca',
    baseCargoM3: 30_000,
    cargoSkillId: HAULING_SKILL_IDS.INDUSTRIAL_COMMAND_SHIPS,
    cargoSkillBonusPerLevel: 0.05,
    fleetHangarBaseM3: 40_000,
    specialBays: [
      {
        name: 'Mining Hold',
        baseM3: 150_000,
        skillId: HAULING_SKILL_IDS.INDUSTRIAL_COMMAND_SHIPS,
        bonusPerLevel: 0.05,
        acceptedBuckets: ['ores', 'ice'],
      },
      {
        name: 'Ship Maintenance Bay',
        baseM3: 400_000,
        acceptedBuckets: ['ships'],
      },
    ],
    untankedSafeIsk: 900_000_000,
    tankedSafeIsk: 1_800_000_000,
  },
  42244: {
    typeId: 42244,
    name: 'Porpoise',
    hullClass: 'orca',
    baseCargoM3: 500,
    fleetHangarBaseM3: 5_000,
    specialBays: [
      {
        name: 'Mining Hold',
        baseM3: 50_000,
        skillId: HAULING_SKILL_IDS.INDUSTRIAL_COMMAND_SHIPS,
        bonusPerLevel: 0.05,
        acceptedBuckets: ['ores', 'ice'],
      },
    ],
    untankedSafeIsk: 400_000_000,
    tankedSafeIsk: 800_000_000,
  },
  34328: {
    typeId: 34328,
    name: 'Bowhead',
    hullClass: 'bowhead',
    baseCargoM3: 4_000,
    specialBays: [
      {
        name: 'Ship Maintenance Bay',
        baseM3: 1_600_000,
        skillId: HAULING_SKILL_IDS.ORE_FREIGHTER,
        bonusPerLevel: 0.05,
        acceptedBuckets: ['ships'],
      },
    ],
    isFreighter: true,
    untankedSafeIsk: 1_200_000_000,
    tankedSafeIsk: 2_000_000_000,
  },

  // --- Standard & Jump Freighters ---
  20185: {
    typeId: 20185,
    name: 'Charon',
    hullClass: 'freighter',
    baseCargoM3: 465_000,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_200_000_000,
  },
  20187: {
    typeId: 20187,
    name: 'Obelisk',
    hullClass: 'freighter',
    baseCargoM3: 440_000,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_200_000_000,
  },
  20183: {
    typeId: 20183,
    name: 'Providence',
    hullClass: 'freighter',
    baseCargoM3: 435_000,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_200_000_000,
  },
  20189: {
    typeId: 20189,
    name: 'Fenrir',
    hullClass: 'freighter',
    baseCargoM3: 435_000,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_200_000_000,
  },
  28844: {
    typeId: 28844,
    name: 'Rhea',
    hullClass: 'freighter',
    baseCargoM3: 158_000,
    cargoSkillId: HAULING_SKILL_IDS.CALDARI_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  28848: {
    typeId: 28848,
    name: 'Anshar',
    hullClass: 'freighter',
    baseCargoM3: 145_000,
    cargoSkillId: HAULING_SKILL_IDS.GALLENTE_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  28850: {
    typeId: 28850,
    name: 'Ark',
    hullClass: 'freighter',
    baseCargoM3: 141_000,
    cargoSkillId: HAULING_SKILL_IDS.AMARR_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
  28846: {
    typeId: 28846,
    name: 'Nomad',
    hullClass: 'freighter',
    baseCargoM3: 138_000,
    cargoSkillId: HAULING_SKILL_IDS.MINMATAR_FREIGHTER,
    cargoSkillBonusPerLevel: 0.05,
    isFreighter: true,
    untankedSafeIsk: 1_500_000_000,
    tankedSafeIsk: 2_500_000_000,
  },
};

// --- Low-Slot Modules & Rigs Affecting Cargo Capacity / Tank / Cloak ---

export interface FittedModSpec {
  typeId: number;
  name: string;
  slot: 'low' | 'rig' | 'mid' | 'high';
  cargoMultiplier?: number; // e.g., 1.275 for +27.5% Expanded Cargohold II; 0.80 for -20% Reinforced Bulkheads II
  isStackingPenalized?: boolean; // Expanded Cargoholds & Cargo Rigs DO NOT suffer EVE stacking penalties on cargo capacity!
  addsTank?: boolean;
  isCovertCloak?: boolean;
}

export const FITTED_MOD_CATALOG: Record<number, FittedModSpec> = {
  // Expanded Cargoholds (Low Slot)
  1317: { typeId: 1317, name: 'Expanded Cargohold I', slot: 'low', cargoMultiplier: 1.175 },
  1319: { typeId: 1319, name: 'Expanded Cargohold II', slot: 'low', cargoMultiplier: 1.275 },
  5493: { typeId: 5493, name: 'Type-D Restrained Expanded Cargo', slot: 'low', cargoMultiplier: 1.225 },
  5495: { typeId: 5495, name: 'Mark I Compact Expanded Cargo', slot: 'low', cargoMultiplier: 1.20 },
  1315: { typeId: 1315, name: 'Basic Expanded Cargohold', slot: 'low', cargoMultiplier: 1.125 },
  // Faction Expanded Cargoholds
  15806: { typeId: 15806, name: 'Imperial Navy Expanded Cargohold', slot: 'low', cargoMultiplier: 1.275 },
  15808: { typeId: 15808, name: 'Caldari Navy Expanded Cargohold', slot: 'low', cargoMultiplier: 1.275 },
  15810: { typeId: 15810, name: 'Federation Navy Expanded Cargohold', slot: 'low', cargoMultiplier: 1.275 },
  15812: { typeId: 15812, name: 'Republic Fleet Expanded Cargohold', slot: 'low', cargoMultiplier: 1.275 },
  15814: { typeId: 15814, name: 'ORE Expanded Cargohold', slot: 'low', cargoMultiplier: 1.275 },

  // Reinforced Bulkheads (Low Slot — REDUCES cargo m3 while adding hull EHP!)
  1333: { typeId: 1333, name: 'Reinforced Bulkheads I', slot: 'low', cargoMultiplier: 0.85, addsTank: true },
  1335: { typeId: 1335, name: 'Reinforced Bulkheads II', slot: 'low', cargoMultiplier: 0.80, addsTank: true },
  5647: { typeId: 5647, name: 'Type-D Restrained Reinforced Bulkheads', slot: 'low', cargoMultiplier: 0.85, addsTank: true },
  5649: { typeId: 5649, name: 'Mark I Compact Reinforced Bulkheads', slot: 'low', cargoMultiplier: 0.85, addsTank: true },

  // Cargohold Optimization Rigs (Small / Medium / Large I & II)
  31117: { typeId: 31117, name: 'Small Cargohold Optimization I', slot: 'rig', cargoMultiplier: 1.15 },
  31123: { typeId: 31123, name: 'Small Cargohold Optimization II', slot: 'rig', cargoMultiplier: 1.20 },
  31119: { typeId: 31119, name: 'Medium Cargohold Optimization I', slot: 'rig', cargoMultiplier: 1.15 },
  31125: { typeId: 31125, name: 'Medium Cargohold Optimization II', slot: 'rig', cargoMultiplier: 1.20 },
  26072: { typeId: 26072, name: 'Large Cargohold Optimization I', slot: 'rig', cargoMultiplier: 1.15 },
  26304: { typeId: 26304, name: 'Large Cargohold Optimization II', slot: 'rig', cargoMultiplier: 1.20 },

  // Transverse Bulkhead Rigs (reduces cargo by 10% while heavily tanking hull)
  33890: { typeId: 33890, name: 'Small Transverse Bulkhead I', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },
  33892: { typeId: 33892, name: 'Small Transverse Bulkhead II', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },
  33894: { typeId: 33894, name: 'Medium Transverse Bulkhead I', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },
  33896: { typeId: 33896, name: 'Medium Transverse Bulkhead II', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },
  33898: { typeId: 33898, name: 'Large Transverse Bulkhead I', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },
  33900: { typeId: 33900, name: 'Large Transverse Bulkhead II', slot: 'rig', cargoMultiplier: 0.90, addsTank: true },

  // Common Tank / Cloak Modules for Gank-Risk Classification
  2048: { typeId: 2048, name: 'Damage Control II', slot: 'low', addsTank: true },
  2046: { typeId: 2046, name: 'Damage Control I', slot: 'low', addsTank: true },
  11269: { typeId: 11269, name: 'Multispectrum Energized Membrane II', slot: 'low', addsTank: true },
  33076: { typeId: 33076, name: 'Assault Damage Control II', slot: 'low', addsTank: true },
  4405: { typeId: 4405, name: 'Reactive Armor Hardener', slot: 'low', addsTank: true },
  2281: { typeId: 2281, name: 'Multispectrum Shield Hardener II', slot: 'mid', addsTank: true },
  3841: { typeId: 3841, name: 'Large Shield Extender II', slot: 'mid', addsTank: true },
  3831: { typeId: 3831, name: 'Medium Shield Extender II', slot: 'mid', addsTank: true },
  11578: { typeId: 11578, name: 'Covert Ops Cloaking Device II', slot: 'high', isCovertCloak: true },
  11370: { typeId: 11370, name: 'Prototype Cloaking Device I', slot: 'high' },
  11577: { typeId: 11577, name: 'Improved Cloaking Device II', slot: 'high' },
};

/**
 * Computes exact fitted general cargo, fleet hangar, specialized bay volumes,
 * tank/cloak classification, and safe ISK gank threshold for an EVE hull.
 */
export function calculateFittedHull(params: {
  id: string;
  itemId?: number;
  typeId: number;
  customName?: string;
  location: string;
  stationId?: number;
  systemId?: number;
  systemName?: string;
  isActiveShip?: boolean;
  fittedTypeIds: number[];
  haulingSkills: Record<number, number>;
  notes?: string;
}): HangarHull | null {
  const template = HAULER_HULL_CATALOG[params.typeId];
  if (!template) return null;

  const getSkillLvl = (skillId?: number): number => {
    if (!skillId) return 0;
    const val = params.haulingSkills[skillId];
    return typeof val === 'number' ? Math.max(0, Math.min(5, val)) : 5;
  };

  // 1. Base general cargo + hull skill bonus
  const cargoSkillLvl = getSkillLvl(template.cargoSkillId);
  let generalCargo =
    template.baseCargoM3 * (1 + cargoSkillLvl * (template.cargoSkillBonusPerLevel ?? 0));

  // 2. Apply fitted Low-Slot modules & Rigs (Expanded Cargohold / Reinforced Bulkheads / Cargo Rigs)
  const fittedModules: string[] = [];
  const fittedRigs: string[] = [];
  let tankModuleCount = 0;
  let hasCovertCloak = false;
  let expanderCount = 0;
  let bulkheadCount = 0;

  for (const modTypeId of params.fittedTypeIds) {
    const mod = FITTED_MOD_CATALOG[modTypeId];
    if (!mod) continue;

    if (mod.slot === 'rig') {
      fittedRigs.push(mod.name);
    } else {
      fittedModules.push(mod.name);
    }

    if (typeof mod.cargoMultiplier === 'number') {
      generalCargo *= mod.cargoMultiplier;
      if (mod.cargoMultiplier > 1) expanderCount += 1;
      if (mod.cargoMultiplier < 1) bulkheadCount += 1;
    }

    if (mod.addsTank) tankModuleCount += 1;
    if (mod.isCovertCloak) hasCovertCloak = true;
  }

  const fittedCargoM3 = Math.round(generalCargo);

  // 3. Fleet Hangar (general-purpose cargo on DSTs, Orca, Torrent)
  let fleetHangarM3 = 0;
  if (template.fleetHangarBaseM3) {
    const fhLvl = getSkillLvl(template.fleetHangarSkillId);
    fleetHangarM3 = Math.round(
      template.fleetHangarBaseM3 * (1 + fhLvl * (template.fleetHangarBonusPerLevel ?? 0))
    );
  }

  // 4. Specialized Bays (Mineral, Ice, Ore, PI, Ammo, Infrastructure, Ship Maintenance Bay)
  const specialBays: SpecialBaySpec[] = (template.specialBays || []).map((bay) => {
    const bayLvl = getSkillLvl(bay.skillId);
    const cap = Math.round(bay.baseM3 * (1 + bayLvl * (bay.bonusPerLevel ?? 0)));
    return {
      name: bay.name,
      capacityM3: cap,
      acceptedBuckets: bay.acceptedBuckets,
    };
  });

  // 5. Tank & Cloak classification -> determines Safe ISK Gank Threshold
  const isCloaky = Boolean(template.canFitCovertCloak && hasCovertCloak);
  const isTanked =
    tankModuleCount >= 2 ||
    bulkheadCount >= 1 ||
    (template.isFreighter && bulkheadCount >= 1 && expanderCount === 0);

  // Untanked DST with Expanders or no tank modules stays at 750M threshold; tanked DST -> 2.5B
  const safeIskThreshold =
    isCloaky || isTanked ? template.tankedSafeIsk : template.untankedSafeIsk;

  // Primary display capacity: general + fleet hangar (or largest special bay if specialized hauler)
  const generalPlusFleet = fittedCargoM3 + fleetHangarM3;
  const maxSpecialBay = specialBays.reduce((m, b) => Math.max(m, b.capacityM3), 0);
  const capacityM3 =
    generalPlusFleet >= maxSpecialBay ? generalPlusFleet : maxSpecialBay;

  const displayName =
    params.customName &&
    params.customName.trim() &&
    params.customName.trim().toLowerCase() !== template.name.toLowerCase()
      ? `${params.customName.trim()} (${template.name})`
      : template.name;

  const fitSummaryParts: string[] = [];
  if (isCloaky) fitSummaryParts.push('CovOps Cloak');
  if (isTanked) fitSummaryParts.push('Tanked');
  else if (template.hullClass === 'dst') fitSummaryParts.push('Untanked DST');
  if (expanderCount > 0) fitSummaryParts.push(`${expanderCount}× Cargo Exp`);
  if (bulkheadCount > 0) fitSummaryParts.push(`${bulkheadCount}× Bulkheads`);
  if (specialBays.length > 0) {
    fitSummaryParts.push(
      specialBays.map((b) => `${b.name} ${(b.capacityM3 / 1000).toFixed(1)}k`).join(' · ')
    );
  }

  return {
    id: params.id,
    itemId: params.itemId,
    typeId: params.typeId,
    name: displayName,
    shipTypeName: template.name,
    customName: params.customName,
    hullClass: template.hullClass,
    capacityM3,
    baseCargoM3: template.baseCargoM3,
    fittedCargoM3,
    fleetHangarM3: fleetHangarM3 > 0 ? fleetHangarM3 : undefined,
    specialBays: specialBays.length > 0 ? specialBays : undefined,
    location: params.location,
    stationId: params.stationId,
    systemId: params.systemId,
    systemName: params.systemName,
    isActiveShip: params.isActiveShip,
    fittedModules,
    fittedRigs,
    isTanked,
    isCloaky,
    safeIskThreshold,
    notes: params.notes || fitSummaryParts.join(' · ') || 'Fitted ESI Hull',
  };
}

// --- Cargo Bucket Classification ---

export function createEmptyCargoBuckets(): Record<CargoBucket, number> {
  return {
    general: 0,
    minerals: 0,
    ice: 0,
    ores: 0,
    pi: 0,
    ammo: 0,
    infrastructure: 0,
    ships: 0,
  };
}

export function classifyCategoryToCargoBucket(category?: MarketCategoryId | 'indy_support'): CargoBucket {
  switch (category) {
    case 'minerals':
      return 'minerals';
    case 'ice':
      return 'ice';
    case 'ores':
      return 'ores';
    case 'pi_p0_p1':
    case 'pi_p2_p4':
      return 'pi';
    case 't1_ammo':
    case 't2_ammo':
    case 'bombs':
    case 'probes':
    case 'scripts':
      return 'ammo';
    case 'fuel_blocks':
      return 'infrastructure';
    case 'shuttles':
      return 'ships';
    default:
      return 'general';
  }
}

export function getDominantCargoBucket(buckets: Record<CargoBucket, number>): CargoBucket {
  let best: CargoBucket = 'general';
  let maxVol = 0;
  (Object.keys(buckets) as CargoBucket[]).forEach((k) => {
    if (buckets[k] > maxVol) {
      maxVol = buckets[k];
      best = k;
    }
  });
  return best;
}

// --- Hull Capacity Fit Evaluator (Specialized Bays + Fleet Hangar + Fitted General Cargo) ---

export function evaluateHullForCargo(
  hull: HangarHull,
  cargoByBucket: Record<CargoBucket, number>
): HullFitEvaluation {
  const generalCap =
    (hull.fittedCargoM3 ?? hull.capacityM3) + (hull.fleetHangarM3 ?? 0);
  const specialBays = hull.specialBays ?? [];

  // Track remaining capacity of each specialized bay
  const bayRemaining = specialBays.map((b) => ({
    ...b,
    remaining: b.capacityM3,
    used: 0,
  }));

  let generalUsed = 0;
  let specialUsed = 0;
  const matchedSet = new Set<string>();

  // Pack specialized cargo buckets into matching specialized bays first; overflow spills to general/fleet cargo
  (Object.keys(cargoByBucket) as CargoBucket[]).forEach((bucket) => {
    let vol = Math.max(0, cargoByBucket[bucket] || 0);
    if (vol <= 0) return;

    for (const bay of bayRemaining) {
      if (vol <= 0) break;
      if (bay.acceptedBuckets.includes(bucket) && bay.remaining > 0) {
        const take = Math.min(vol, bay.remaining);
        bay.remaining -= take;
        bay.used += take;
        specialUsed += take;
        vol -= take;
        matchedSet.add(bay.name);
      }
    }

    if (vol > 0) {
      generalUsed += vol;
    }
  });

  const specialCap = specialBays.reduce((s, b) => s + b.capacityM3, 0);
  const overflowM3 = Math.max(0, generalUsed - generalCap);
  const totalUsed = generalUsed + specialUsed;

  // Effective capacity for the current cargo mix = generalCap + relevant matched special bay capacities
  const relevantSpecialCap = specialBays
    .filter((b) =>
      b.acceptedBuckets.some((bucket) => (cargoByBucket[bucket] || 0) > 0)
    )
    .reduce((s, b) => s + b.capacityM3, 0);

  const effectiveCapacityM3 =
    relevantSpecialCap > 0 ? generalCap + relevantSpecialCap : Math.max(generalCap, hull.capacityM3);

  return {
    fits: overflowM3 <= 0.01 && totalUsed <= effectiveCapacityM3 + 0.01,
    generalUsedM3: generalUsed,
    generalCapacityM3: generalCap,
    specialUsedM3: specialUsed,
    specialCapacityM3: specialCap,
    effectiveCapacityM3,
    matchedSpecialBays: Array.from(matchedSet),
    overflowM3,
  };
}

// --- ISK Gank-Risk Threshold Engine ---

export function getHullSafeIskThreshold(hull?: HangarHull | null): number {
  if (!hull) return 750_000_000;
  if (typeof hull.safeIskThreshold === 'number' && hull.safeIskThreshold > 0) {
    return hull.safeIskThreshold;
  }
  switch (hull.hullClass) {
    case 't1_industrial':
    case 'mineral_hauler':
    case 'ore_hauler':
    case 'pi_hauler':
    case 'ammo_hauler':
      return 100_000_000;
    case 'upwell_hauler':
      return 150_000_000;
    case 'dst':
      return hull.isTanked ? 2_500_000_000 : 750_000_000;
    case 'blockade_runner':
      return hull.isCloaky !== false ? 5_000_000_000 : 1_500_000_000;
    case 'orca':
      return hull.isTanked ? 1_800_000_000 : 900_000_000;
    case 'bowhead':
    case 'freighter':
      return hull.isTanked ? 2_200_000_000 : 1_500_000_000;
    default:
      return 750_000_000;
  }
}

export function assessGankRisk(
  cargoIskValue: number,
  hull?: HangarHull | null
): GankRiskAssessment {
  const threshold = getHullSafeIskThreshold(hull);
  const hullLabel = hull?.name || 'Selected Hauler';
  const ratio = threshold > 0 ? cargoIskValue / threshold : 0;

  if (cargoIskValue <= 0 || ratio < 0.75) {
    return {
      level: 'safe',
      cargoIskValue,
      thresholdIsk: threshold,
      hullLabel,
      headline: 'Within Safe Gank Threshold',
      recommendation: `Cargo ISK value is safely below the ${(threshold / 1e6).toFixed(0)}M ISK gank threshold for ${hullLabel}.`,
    };
  }

  const isT1 =
    hull?.hullClass === 't1_industrial' ||
    hull?.hullClass === 'mineral_hauler' ||
    hull?.hullClass === 'ore_hauler' ||
    hull?.hullClass === 'pi_hauler' ||
    hull?.hullClass === 'ammo_hauler' ||
    hull?.hullClass === 'upwell_hauler';

  const isUntankedDst = hull?.hullClass === 'dst' && !hull.isTanked;
  const isFreighter = hull?.hullClass === 'freighter' || hull?.hullClass === 'bowhead';

  let recommendation = 'Split the cargo into smaller loads or switch to a cloaky Blockade Runner.';
  if (isT1) {
    recommendation =
      'Upgrade to a tanked DST (62.5k m³ fleet hangar), a cloaky Blockade Runner, or split load below 100M ISK.';
  } else if (isUntankedDst) {
    recommendation =
      'Refit this DST with tank modules (Damage Control II + Multispectrum Hardeners / MWD+Cloak), switch to a Blockade Runner, or cap load under 750M ISK.';
  } else if (isFreighter) {
    recommendation =
      'High-value Freighter gank magnet (>1.5B ISK). Split across multiple trips, fit Reinforced Bulkheads II, or move high-value SKUs in a cloaky Blockade Runner / tanked DST.';
  }

  if (ratio >= 1.0) {
    return {
      level: 'critical',
      cargoIskValue,
      thresholdIsk: threshold,
      hullLabel,
      headline: `Gank Target Risk (${(cargoIskValue / 1e6).toFixed(0)}M / ${(threshold / 1e6).toFixed(0)}M ISK limit)`,
      recommendation,
    };
  }

  return {
    level: 'warning',
    cargoIskValue,
    thresholdIsk: threshold,
    hullLabel,
    headline: `Approaching Gank Limit (${Math.round(ratio * 100)}% of ${(threshold / 1e6).toFixed(0)}M ISK)`,
    recommendation,
  };
}

// --- Cargo-Type Matcher & Best Fleet Hull Recommender ---

export function recommendBestHullFromFleet(params: {
  hulls: HangarHull[];
  cargoByBucket: Record<CargoBucket, number>;
  peakCargoM3: number;
  peakCargoIsk: number;
  originSystemId: number;
  originStationName?: string;
  jumpMatrix: Record<string, number>;
}): HullRecommendation | null {
  const {
    hulls,
    cargoByBucket,
    peakCargoM3,
    peakCargoIsk,
    originSystemId,
    originStationName,
    jumpMatrix,
  } = params;

  if (hulls.length === 0) return null;

  const dominantBucket = getDominantCargoBucket(cargoByBucket);

  const scored = hulls.map((hull) => {
    const fit = evaluateHullForCargo(hull, cargoByBucket);
    const gankRisk = assessGankRisk(peakCargoIsk, hull);

    const hullSystemId = hull.systemId ?? originSystemId;
    const pairKey = `${originSystemId}:${hullSystemId}`;
    const pickupJumps =
      hullSystemId === originSystemId ? 0 : jumpMatrix[pairKey] ?? 3;

    const sameStation =
      hull.isActiveShip ||
      (hullSystemId === originSystemId &&
        (!originStationName ||
          !hull.location ||
          hull.location.toLowerCase().includes(originStationName.slice(0, 14).toLowerCase()) ||
          originStationName.toLowerCase().includes(hull.location.slice(0, 14).toLowerCase())));

    const requiresPickup = !hull.isActiveShip && (pickupJumps > 0 || !sameStation);

    // Composite score (higher is better)
    let score = 0;

    // 1. Capacity fit is top priority
    if (fit.fits) score += 1000;
    else score -= fit.overflowM3 * 0.02;

    // 2. Gank-risk safety is second highest priority
    if (gankRisk.level === 'safe') score += 500;
    else if (gankRisk.level === 'warning') score += 150;
    else score -= 450;

    // 3. Specialized bay match bonus when cargo matches that specialty & stays safe
    if (fit.matchedSpecialBays.length > 0 && gankRisk.level !== 'critical') {
      score += 180;
    }

    // 4. Agility & Cloak preference when load fits comfortably
    if (hull.hullClass === 'blockade_runner' && fit.fits) score += 160;
    if (hull.hullClass === 'dst' && fit.fits) score += 110;
    if (hull.hullClass === 'orca' && fit.fits && dominantBucket !== 'ores' && dominantBucket !== 'ice') {
      score -= 40; // Avoid slow Orca if BR/DST fits general cargo
    }
    if (hull.hullClass === 'freighter' && peakCargoM3 < 65_000) {
      score -= 120; // Don't bring a Freighter for small loads
    }

    // 5. Proximity penalty for parked hulls several jumps away
    score -= pickupJumps * 25;
    if (!requiresPickup) score += 35;

    return {
      hull,
      fit,
      gankRisk,
      requiresPickup,
      pickupJumps,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  // Build concise human-readable reason
  const reasons: string[] = [];
  if (winner.fit.matchedSpecialBays.length > 0) {
    reasons.push(`Matches ${winner.fit.matchedSpecialBays.join(' + ')}`);
  } else if (winner.hull.hullClass === 'blockade_runner') {
    reasons.push('Cloaky fast transit for high-value compact load');
  } else if (winner.hull.hullClass === 'dst') {
    reasons.push('High-EHP Fleet Hangar fits mixed multi-stop volume');
  } else if (winner.hull.hullClass === 'orca') {
    reasons.push('Heavy Ore/Fleet capacity covers bulk volume');
  } else {
    reasons.push('Best cargo-to-risk match in your fleet');
  }

  if (winner.gankRisk.level === 'safe') {
    reasons.push('safe ISK profile');
  } else {
    reasons.push(winner.gankRisk.headline);
  }

  let alternativeHint: string | undefined;
  if (!winner.fit.fits) {
    alternativeHint = `Peak load (${Math.round(peakCargoM3).toLocaleString()} m³) exceeds your largest hull — split into 2 trips or untick bulky ore/ice cards.`;
  } else if (winner.gankRisk.level === 'critical') {
    alternativeHint = winner.gankRisk.recommendation;
  }

  const pickupDestinationId =
    winner.hull.stationId ?? winner.hull.systemId ?? originSystemId;

  return {
    hull: winner.hull,
    reason: reasons.join(' · '),
    fit: winner.fit,
    gankRisk: winner.gankRisk,
    requiresPickup: winner.requiresPickup,
    pickupJumps: winner.pickupJumps,
    pickupDestinationId,
    pickupStationName: winner.hull.location,
    pickupSystemName: winner.hull.systemName || 'Hangar System',
    alternativeHint,
  };
}
