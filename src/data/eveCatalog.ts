import type {
  EmpireHubDef,
  EveItem,
  IndustryStructureConfig,
  MarketCategoryDef,
  MarketCategoryId,
  PilotProfile,
  TradeHubId,
} from '../types/eve.ts';

// --- Canonical New Eden Stations, Regions, and Systems ---

export const EVE_ANCHORS = {
  JITA_STATION_ID: 60003760,
  JITA_STATION_NAME: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
  JITA_SYSTEM_ID: 30000142,
  THE_FORGE_REGION_ID: 10000002,

  AMARR_STATION_ID: 60008494,
  AMARR_STATION_NAME: 'Amarr VIII (Oris) - Emperor Family Academy',
  AMARR_SYSTEM_ID: 30002187,
  DOMAIN_REGION_ID: 10000043,

  DODIXIE_STATION_ID: 60011866,
  DODIXIE_STATION_NAME: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
  DODIXIE_SYSTEM_ID: 30002659,
  SINQ_LAISON_REGION_ID: 10000032,

  RENS_STATION_ID: 60004588,
  RENS_STATION_NAME: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
  RENS_SYSTEM_ID: 30002510,
  HEIMATAR_REGION_ID: 10000030,

  HEK_STATION_ID: 60005686,
  HEK_STATION_NAME: 'Hek VIII - Moon 12 - Boundless Creation Factory',
  HEK_SYSTEM_ID: 30002053,
  METROPOLIS_REGION_ID: 10000042,

  ISHISOMO_SYSTEM_ID: 30000137,
  ISHISOMO_SYSTEM_NAME: 'Ishisomo',
  ISHISOMO_MFG_STATION_ID: 60014713,
  ISHISOMO_MFG_STATION_NAME: 'Ishisomo VIII - Moon 11 - State War Academy',
  ISHISOMO_RES_STATION_ID: 60004318,
  ISHISOMO_RES_STATION_NAME: 'Ishisomo VII - Moon 14 - Propel Dynamics Factory',
} as const;

export const EMPIRE_HUBS: EmpireHubDef[] = [
  {
    id: 'jita',
    shortName: 'Jita',
    shortLabel: 'Jita',
    systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
    systemName: 'Jita',
    stationId: EVE_ANCHORS.JITA_STATION_ID,
    stationName: EVE_ANCHORS.JITA_STATION_NAME,
    regionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
    regionName: 'The Forge',
    priceMultiplierFallback: 1.0,
    volMultiplierFallback: 1.0,
  },
  {
    id: 'amarr',
    shortName: 'Amarr',
    shortLabel: 'Amarr',
    systemId: EVE_ANCHORS.AMARR_SYSTEM_ID,
    systemName: 'Amarr',
    stationId: EVE_ANCHORS.AMARR_STATION_ID,
    stationName: EVE_ANCHORS.AMARR_STATION_NAME,
    regionId: EVE_ANCHORS.DOMAIN_REGION_ID,
    regionName: 'Domain',
    priceMultiplierFallback: 1.09,
    volMultiplierFallback: 0.34,
  },
  {
    id: 'dodixie',
    shortName: 'Dodixie',
    shortLabel: 'Dodixie',
    systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID,
    systemName: 'Dodixie',
    stationId: EVE_ANCHORS.DODIXIE_STATION_ID,
    stationName: EVE_ANCHORS.DODIXIE_STATION_NAME,
    regionId: EVE_ANCHORS.SINQ_LAISON_REGION_ID,
    regionName: 'Sinq Laison',
    priceMultiplierFallback: 1.13,
    volMultiplierFallback: 0.22,
  },
  {
    id: 'rens',
    shortName: 'Rens',
    shortLabel: 'Rens',
    systemId: EVE_ANCHORS.RENS_SYSTEM_ID,
    systemName: 'Rens',
    stationId: EVE_ANCHORS.RENS_STATION_ID,
    stationName: EVE_ANCHORS.RENS_STATION_NAME,
    regionId: EVE_ANCHORS.HEIMATAR_REGION_ID,
    regionName: 'Heimatar',
    priceMultiplierFallback: 1.16,
    volMultiplierFallback: 0.14,
  },
  {
    id: 'hek',
    shortName: 'Hek',
    shortLabel: 'Hek',
    systemId: EVE_ANCHORS.HEK_SYSTEM_ID,
    systemName: 'Hek',
    stationId: EVE_ANCHORS.HEK_STATION_ID,
    stationName: EVE_ANCHORS.HEK_STATION_NAME,
    regionId: EVE_ANCHORS.METROPOLIS_REGION_ID,
    regionName: 'Metropolis',
    priceMultiplierFallback: 1.19,
    volMultiplierFallback: 0.11,
  },
];

export const EMPIRE_HUB_MAP: Record<TradeHubId, EmpireHubDef> = Object.fromEntries(
  EMPIRE_HUBS.map((h) => [h.id, h])
) as Record<TradeHubId, EmpireHubDef>;

export const DEFAULT_INDUSTRY_STRUCTURE_CONFIG: IndustryStructureConfig = {
  systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
  systemName: EVE_ANCHORS.ISHISOMO_SYSTEM_NAME,
  structureType: 'npc_station',
  meRig: 'none',
  teRig: 'none',
  costRig: 'none',
  facilityTaxPct: 0.25,
};

export const INDUSTRY_PRESET_SYSTEMS: { systemId: number; systemName: string; note: string }[] = [
  { systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID, systemName: 'Ishisomo', note: 'Home Indy Hub (3j Jita)' },
  { systemId: EVE_ANCHORS.JITA_SYSTEM_ID, systemName: 'Jita', note: 'The Forge Trade Hub' },
  { systemId: 30000144, systemName: 'Perimeter', note: '1j Jita Engineering Hub' },
  { systemId: 30000143, systemName: 'Ikuchi', note: '1j Jita Indy Overflow' },
  { systemId: EVE_ANCHORS.AMARR_SYSTEM_ID, systemName: 'Amarr', note: 'Domain Trade Hub' },
  { systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID, systemName: 'Dodixie', note: 'Sinq Laison Hub' },
  { systemId: EVE_ANCHORS.RENS_SYSTEM_ID, systemName: 'Rens', note: 'Heimatar Hub' },
  { systemId: EVE_ANCHORS.HEK_SYSTEM_ID, systemName: 'Hek', note: 'Metropolis Hub' },
];

export interface CorridorSystem {
  systemId: number;
  name: string;
  security: number;
  jumpsFromJita: number;
  jumpsFromIshisomo: number;
  role: string;
}

// Systems along or within 2 jumps of the Ishisomo <-> Jita high-sec pipeline
export const CORRIDOR_SYSTEMS: CorridorSystem[] = [
  { systemId: 30000144, name: 'Perimeter', security: 1.0, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j Jita Market Satellite' },
  { systemId: 30000140, name: 'Maurasi', security: 0.9, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j Jita Corridor Transit' },
  { systemId: 30000145, name: 'New Caldari', security: 1.0, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j Caldari Sub-Hub' },
  { systemId: 30000143, name: 'Ikuchi', security: 1.0, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j Jita Industry Overflow' },
  { systemId: 30001363, name: 'Sobaseki', security: 0.8, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j Pipeline Gateway' },
  { systemId: 30000139, name: 'Urlen', security: 1.0, jumpsFromJita: 2, jumpsFromIshisomo: 1, role: '2j Trade Conduit' },
  { systemId: 30000138, name: 'Sirppala', security: 0.9, jumpsFromJita: 2, jumpsFromIshisomo: 1, role: '2j Sub-Hub Pocket' },
  { systemId: 30000137, name: 'Ishisomo', security: 0.7, jumpsFromJita: 3, jumpsFromIshisomo: 0, role: 'Home Industry Anchor' },
  { systemId: 30000119, name: 'Itamo', security: 0.9, jumpsFromJita: 2, jumpsFromIshisomo: 1, role: '1j Ishisomo Mission Hub' },
  { systemId: 30000141, name: 'Muvolailen', security: 0.9, jumpsFromJita: 1, jumpsFromIshisomo: 2, role: '1j High-Sec Mining Pocket' },
];

export const CORRIDOR_SYSTEM_MAP: Record<number, CorridorSystem> = Object.fromEntries(
  CORRIDOR_SYSTEMS.map((s) => [s.systemId, s])
);

// --- 19 Market Scope Categories ---

export const MARKET_CATEGORIES: MarketCategoryDef[] = [
  // Charges & Fuel
  { id: 't1_ammo', label: 'T1 Ammo', group: 'Charges & Fuel', marketGroupId: 11, description: 'Standard T1 hybrid, projectile, crystal, missile, rocket, torpedo, and cap booster charges' },
  { id: 't2_ammo', label: 'T2 Ammo', group: 'Charges & Fuel', marketGroupId: 11, description: 'Advanced T2 & Faction hybrid, projectile, crystal, missile, rocket, and torpedo charges' },
  { id: 'bombs', label: 'Bombs', group: 'Charges & Fuel', marketGroupId: 1015, description: 'Stealth bomber area-of-effect damage & EWAR bombs' },
  { id: 'probes', label: 'Probes', group: 'Charges & Fuel', marketGroupId: 120, description: 'Scanner probes, survey probes, and interdiction probes' },
  { id: 'scripts', label: 'Scripts', group: 'Charges & Fuel', marketGroupId: 1094, description: 'Sensor, tracking, ECCM, missile guidance, and command burst scripts' },
  { id: 'fuel_blocks', label: 'Fuel Blocks', group: 'Charges & Fuel', marketGroupId: 1870, description: 'All 4 racial fuel blocks plus isotope & liquid ozone fuel products' },

  // Rigs, Drones & Hulls
  { id: 't1_rigs', label: 'T1 Rigs', group: 'Rigs, Drones & Hulls', marketGroupId: 1111, description: 'All Tech I ship & drone rigs across Small, Medium, Large, and Capital' },
  { id: 't2_rigs', label: 'T2 Rigs', group: 'Rigs, Drones & Hulls', marketGroupId: 1111, description: 'All Tech II ship & drone rigs across Small, Medium, Large, and Capital' },
  { id: 't1_drones', label: 'T1 Drones', group: 'Rigs, Drones & Hulls', marketGroupId: 157, description: 'All Tech I combat, mining, logistic, EWAR, and sentry drones' },
  { id: 't2_drones', label: 'T2 Drones', group: 'Rigs, Drones & Hulls', marketGroupId: 157, description: 'All Tech II & Faction/Augmented combat, mining, logistic, EWAR, and sentry drones' },
  { id: 'shuttles', label: 'Shuttles', group: 'Rigs, Drones & Hulls', marketGroupId: 391, description: 'All racial & special/faction travel shuttles' },
  { id: 'implants', label: 'Implants', group: 'Rigs, Drones & Hulls', marketGroupId: 27, description: 'Attribute enhancers and skill hardwiring implants' },
  { id: 'scrap_loot', label: 'Scrap / Meta Loot Modules', group: 'Rigs, Drones & Hulls', marketGroupId: 9, description: 'Published Meta 1-4 ship modules & weapons traded for reprocessing or fitting' },

  // Resources & PI
  { id: 'ores', label: 'Ores', group: 'Resources & PI', marketGroupId: 54, description: 'All standard & compressed raw ores for reprocessing' },
  { id: 'ice', label: 'Ice', group: 'Resources & PI', marketGroupId: 1855, description: 'All raw & compressed ice blocks plus ice products & isotopes' },
  { id: 'minerals', label: 'Minerals', group: 'Resources & PI', marketGroupId: 1857, description: 'All standard & moon/Triglavian refined minerals' },
  { id: 'salvaged', label: 'Salvaged', group: 'Resources & PI', marketGroupId: 1861, description: 'All T1 & T2 salvaged rig manufacturing materials' },
  { id: 'pi_p0_p1', label: 'PI (P0–P1)', group: 'Resources & PI', marketGroupId: 1332, description: 'All raw planetary resources (P0) and basic processed materials (P1)' },
  { id: 'pi_p2_p4', label: 'PI (P2–P4)', group: 'Resources & PI', marketGroupId: 1332, description: 'All refined (P2), specialized (P3), and advanced (P4) planetary commodities' },
];

export const SCOPE_PRESETS: Record<string, MarketCategoryId[]> = {
  all: MARKET_CATEGORIES.map((c) => c.id),
  blockade_runner: ['t2_ammo', 'bombs', 'probes', 'scripts', 't2_rigs', 't2_drones', 'implants', 'salvaged', 'pi_p2_p4'],
  refine_indy: ['ores', 'ice', 'minerals', 'salvaged', 'scrap_loot', 'fuel_blocks', 't1_ammo', 't1_rigs', 't1_drones', 'shuttles'],
  clear: [],
};

// --- Real EVE Online Type IDs & SDE Attributes ---

export const EVE_ITEMS: EveItem[] = [
  // T1 Ammo
  { typeId: 222, name: 'Antimatter Charge S', category: 't1_ammo', volume: 0.0025, baseJitaSell: 34.5, baseJitaBuy: 28.2, baseDodixieSell: 43.0, baseDodixieBuy: 32.0, estDailyJitaVol: 4800000, estDailyDodixieVol: 820000 },
  { typeId: 230, name: 'Antimatter Charge M', category: 't1_ammo', volume: 0.0125, baseJitaSell: 112.0, baseJitaBuy: 96.0, baseDodixieSell: 141.0, baseDodixieBuy: 108.0, estDailyJitaVol: 3200000, estDailyDodixieVol: 540000 },
  { typeId: 209, name: 'Scourge Heavy Missile', category: 't1_ammo', volume: 0.03, baseJitaSell: 148.0, baseJitaBuy: 129.0, baseDodixieSell: 182.0, baseDodixieBuy: 145.0, estDailyJitaVol: 4100000, estDailyDodixieVol: 610000 },
  { typeId: 210, name: 'Scourge Light Missile', category: 't1_ammo', volume: 0.015, baseJitaSell: 58.0, baseJitaBuy: 49.0, baseDodixieSell: 74.0, baseDodixieBuy: 55.0, estDailyJitaVol: 3900000, estDailyDodixieVol: 580000 },
  { typeId: 193, name: 'EMP M', category: 't1_ammo', volume: 0.0125, baseJitaSell: 118.0, baseJitaBuy: 101.0, baseDodixieSell: 149.0, baseDodixieBuy: 112.0, estDailyJitaVol: 2100000, estDailyDodixieVol: 340000 },
  { typeId: 246, name: 'Multifrequency M', category: 't1_ammo', volume: 1.0, baseJitaSell: 6200, baseJitaBuy: 4800, baseDodixieSell: 8100, baseDodixieBuy: 5900, estDailyJitaVol: 42000, estDailyDodixieVol: 8500 },

  // T2 Ammo
  { typeId: 2629, name: 'Scourge Fury Heavy Missile', category: 't2_ammo', volume: 0.03, baseJitaSell: 515.0, baseJitaBuy: 465.0, baseDodixieSell: 635.0, baseDodixieBuy: 510.0, estDailyJitaVol: 5400000, estDailyDodixieVol: 720000 },
  { typeId: 12785, name: 'Void M', category: 't2_ammo', volume: 0.0125, baseJitaSell: 445.0, baseJitaBuy: 398.0, baseDodixieSell: 548.0, baseDodixieBuy: 440.0, estDailyJitaVol: 3600000, estDailyDodixieVol: 640000 },
  { typeId: 12787, name: 'Null M', category: 't2_ammo', volume: 0.0125, baseJitaSell: 468.0, baseJitaBuy: 418.0, baseDodixieSell: 585.0, baseDodixieBuy: 462.0, estDailyJitaVol: 2800000, estDailyDodixieVol: 490000 },
  { typeId: 12775, name: 'Hail M', category: 't2_ammo', volume: 0.0125, baseJitaSell: 412.0, baseJitaBuy: 365.0, baseDodixieSell: 512.0, baseDodixieBuy: 405.0, estDailyJitaVol: 2400000, estDailyDodixieVol: 390000 },
  { typeId: 12777, name: 'Barrage M', category: 't2_ammo', volume: 0.0125, baseJitaSell: 495.0, baseJitaBuy: 442.0, baseDodixieSell: 618.0, baseDodixieBuy: 490.0, estDailyJitaVol: 2700000, estDailyDodixieVol: 410000 },
  { typeId: 12818, name: 'Scorch M', category: 't2_ammo', volume: 1.0, baseJitaSell: 318000, baseJitaBuy: 285000, baseDodixieSell: 389000, baseDodixieBuy: 312000, estDailyJitaVol: 14500, estDailyDodixieVol: 2600 },

  // Bombs
  { typeId: 27912, name: 'Electron Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 325000, baseJitaBuy: 288000, baseDodixieSell: 398000, baseDodixieBuy: 312000, estDailyJitaVol: 4800, estDailyDodixieVol: 780 },
  { typeId: 27916, name: 'Concussion Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 312000, baseJitaBuy: 274000, baseDodixieSell: 385000, baseDodixieBuy: 298000, estDailyJitaVol: 3900, estDailyDodixieVol: 620 },
  { typeId: 27918, name: 'Scorch Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 334000, baseJitaBuy: 295000, baseDodixieSell: 412000, baseDodixieBuy: 320000, estDailyJitaVol: 4200, estDailyDodixieVol: 680 },
  { typeId: 27920, name: 'Shrapnel Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 342000, baseJitaBuy: 302000, baseDodixieSell: 424000, baseDodixieBuy: 328000, estDailyJitaVol: 4600, estDailyDodixieVol: 740 },
  { typeId: 27924, name: 'Void Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 358000, baseJitaBuy: 318000, baseDodixieSell: 445000, baseDodixieBuy: 345000, estDailyJitaVol: 3100, estDailyDodixieVol: 490 },
  { typeId: 27922, name: 'Lockbreaker Bomb', category: 'bombs', volume: 75.0, baseJitaSell: 295000, baseJitaBuy: 256000, baseDodixieSell: 368000, baseDodixieBuy: 282000, estDailyJitaVol: 1850, estDailyDodixieVol: 310 },

  // Probes
  { typeId: 30013, name: 'Core Scanner Probe I', category: 'probes', volume: 0.1, baseJitaSell: 11800, baseJitaBuy: 10200, baseDodixieSell: 15200, baseDodixieBuy: 11600, estDailyJitaVol: 165000, estDailyDodixieVol: 38000 },
  { typeId: 30028, name: 'Combat Scanner Probe I', category: 'probes', volume: 0.1, baseJitaSell: 19400, baseJitaBuy: 16900, baseDodixieSell: 24800, baseDodixieBuy: 18900, estDailyJitaVol: 92000, estDailyDodixieVol: 19000 },
  { typeId: 30488, name: 'Sisters Core Scanner Probe', category: 'probes', volume: 0.1, baseJitaSell: 448000, baseJitaBuy: 418000, baseDodixieSell: 528000, baseDodixieBuy: 442000, estDailyJitaVol: 48000, estDailyDodixieVol: 11500 },

  // Scripts
  { typeId: 28999, name: 'Optimal Range Script', category: 'scripts', volume: 1.0, baseJitaSell: 29500, baseJitaBuy: 22400, baseDodixieSell: 42000, baseDodixieBuy: 28000, estDailyJitaVol: 18500, estDailyDodixieVol: 4200 },
  { typeId: 29001, name: 'Tracking Speed Script', category: 'scripts', volume: 1.0, baseJitaSell: 31200, baseJitaBuy: 24500, baseDodixieSell: 45500, baseDodixieBuy: 30500, estDailyJitaVol: 22000, estDailyDodixieVol: 4800 },
  { typeId: 29011, name: 'Scan Resolution Script', category: 'scripts', volume: 1.0, baseJitaSell: 28400, baseJitaBuy: 21500, baseDodixieSell: 39800, baseDodixieBuy: 27000, estDailyJitaVol: 24000, estDailyDodixieVol: 5100 },
  { typeId: 35790, name: 'Missile Precision Script', category: 'scripts', volume: 1.0, baseJitaSell: 38500, baseJitaBuy: 31200, baseDodixieSell: 53000, baseDodixieBuy: 37500, estDailyJitaVol: 14500, estDailyDodixieVol: 3200 },

  // Fuel Blocks
  { typeId: 4051, name: 'Nitrogen Fuel Block', category: 'fuel_blocks', volume: 5.0, baseJitaSell: 21800, baseJitaBuy: 20700, baseDodixieSell: 24400, baseDodixieBuy: 21500, estDailyJitaVol: 1850000, estDailyDodixieVol: 240000 },
  { typeId: 4246, name: 'Hydrogen Fuel Block', category: 'fuel_blocks', volume: 5.0, baseJitaSell: 20900, baseJitaBuy: 19800, baseDodixieSell: 23600, baseDodixieBuy: 20500, estDailyJitaVol: 1200000, estDailyDodixieVol: 180000 },
  { typeId: 4247, name: 'Helium Fuel Block', category: 'fuel_blocks', volume: 5.0, baseJitaSell: 21400, baseJitaBuy: 20300, baseDodixieSell: 24100, baseDodixieBuy: 21000, estDailyJitaVol: 1100000, estDailyDodixieVol: 160000 },
  { typeId: 4312, name: 'Oxygen Fuel Block', category: 'fuel_blocks', volume: 5.0, baseJitaSell: 22100, baseJitaBuy: 21000, baseDodixieSell: 24800, baseDodixieBuy: 21900, estDailyJitaVol: 980000, estDailyDodixieVol: 260000 },

  // T1 Rigs
  { typeId: 31716, name: 'Small Core Defense Field Extender I', category: 't1_rigs', volume: 5.0, baseJitaSell: 395000, baseJitaBuy: 348000, baseDodixieSell: 492000, baseDodixieBuy: 385000, estDailyJitaVol: 9500, estDailyDodixieVol: 2100 },
  { typeId: 31788, name: 'Medium Core Defense Field Extender I', category: 't1_rigs', volume: 10.0, baseJitaSell: 1180000, baseJitaBuy: 1040000, baseDodixieSell: 1450000, baseDodixieBuy: 1150000, estDailyJitaVol: 8400, estDailyDodixieVol: 1950 },
  { typeId: 31009, name: 'Small Trimark Armor Pump I', category: 't1_rigs', volume: 5.0, baseJitaSell: 485000, baseJitaBuy: 430000, baseDodixieSell: 598000, baseDodixieBuy: 472000, estDailyJitaVol: 7800, estDailyDodixieVol: 1850 },
  { typeId: 31059, name: 'Medium Trimark Armor Pump I', category: 't1_rigs', volume: 10.0, baseJitaSell: 1340000, baseJitaBuy: 1190000, baseDodixieSell: 1640000, baseDodixieBuy: 1310000, estDailyJitaVol: 6200, estDailyDodixieVol: 1600 },
  { typeId: 31153, name: 'Small Hyperspatial Velocity Optimizer I', category: 't1_rigs', volume: 5.0, baseJitaSell: 645000, baseJitaBuy: 575000, baseDodixieSell: 795000, baseDodixieBuy: 630000, estDailyJitaVol: 5400, estDailyDodixieVol: 1250 },

  // T2 Rigs
  { typeId: 31724, name: 'Small Core Defense Field Extender II', category: 't2_rigs', volume: 5.0, baseJitaSell: 4850000, baseJitaBuy: 4380000, baseDodixieSell: 5890000, baseDodixieBuy: 4720000, estDailyJitaVol: 1850, estDailyDodixieVol: 360 },
  { typeId: 31796, name: 'Medium Core Defense Field Extender II', category: 't2_rigs', volume: 10.0, baseJitaSell: 14200000, baseJitaBuy: 12900000, baseDodixieSell: 16900000, baseDodixieBuy: 13800000, estDailyJitaVol: 1420, estDailyDodixieVol: 280 },
  { typeId: 31011, name: 'Small Trimark Armor Pump II', category: 't2_rigs', volume: 5.0, baseJitaSell: 5650000, baseJitaBuy: 5120000, baseDodixieSell: 6780000, baseDodixieBuy: 5500000, estDailyJitaVol: 1580, estDailyDodixieVol: 340 },
  { typeId: 31155, name: 'Small Hyperspatial Velocity Optimizer II', category: 't2_rigs', volume: 5.0, baseJitaSell: 6950000, baseJitaBuy: 6250000, baseDodixieSell: 8350000, baseDodixieBuy: 6750000, estDailyJitaVol: 1120, estDailyDodixieVol: 220 },

  // T1 Drones
  { typeId: 2454, name: 'Hobgoblin I', category: 't1_drones', volume: 5.0, baseJitaSell: 9400, baseJitaBuy: 7900, baseDodixieSell: 12800, baseDodixieBuy: 9200, estDailyJitaVol: 165000, estDailyDodixieVol: 42000 },
  { typeId: 2183, name: 'Hammerhead I', category: 't1_drones', volume: 10.0, baseJitaSell: 32500, baseJitaBuy: 27800, baseDodixieSell: 43500, baseDodixieBuy: 31800, estDailyJitaVol: 74000, estDailyDodixieVol: 19500 },
  { typeId: 2486, name: 'Warrior I', category: 't1_drones', volume: 5.0, baseJitaSell: 8900, baseJitaBuy: 7400, baseDodixieSell: 11900, baseDodixieBuy: 8500, estDailyJitaVol: 118000, estDailyDodixieVol: 28000 },
  { typeId: 23707, name: 'Hornet EC-300', category: 't1_drones', volume: 5.0, baseJitaSell: 34500, baseJitaBuy: 29800, baseDodixieSell: 47200, baseDodixieBuy: 33500, estDailyJitaVol: 42000, estDailyDodixieVol: 8900 },
  { typeId: 2203, name: 'Acolyte I', category: 't1_drones', volume: 5.0, baseJitaSell: 9100, baseJitaBuy: 7600, baseDodixieSell: 12200, baseDodixieBuy: 8800, estDailyJitaVol: 95000, estDailyDodixieVol: 21000 },

  // T2 Drones
  { typeId: 2456, name: 'Hobgoblin II', category: 't2_drones', volume: 5.0, baseJitaSell: 685000, baseJitaBuy: 632000, baseDodixieSell: 815000, baseDodixieBuy: 675000, estDailyJitaVol: 68000, estDailyDodixieVol: 18500 },
  { typeId: 2185, name: 'Hammerhead II', category: 't2_drones', volume: 10.0, baseJitaSell: 1320000, baseJitaBuy: 1220000, baseDodixieSell: 1560000, baseDodixieBuy: 1295000, estDailyJitaVol: 48000, estDailyDodixieVol: 13500 },
  { typeId: 2488, name: 'Warrior II', category: 't2_drones', volume: 5.0, baseJitaSell: 642000, baseJitaBuy: 595000, baseDodixieSell: 765000, baseDodixieBuy: 632000, estDailyJitaVol: 54000, estDailyDodixieVol: 12400 },
  { typeId: 2205, name: 'Acolyte II', category: 't2_drones', volume: 5.0, baseJitaSell: 625000, baseJitaBuy: 578000, baseDodixieSell: 748000, baseDodixieBuy: 615000, estDailyJitaVol: 44000, estDailyDodixieVol: 9800 },
  { typeId: 2446, name: 'Ogre II', category: 't2_drones', volume: 25.0, baseJitaSell: 2480000, baseJitaBuy: 2290000, baseDodixieSell: 2940000, baseDodixieBuy: 2420000, estDailyJitaVol: 22000, estDailyDodixieVol: 5400 },

  // Shuttles
  { typeId: 672, name: 'Caldari Shuttle', category: 'shuttles', volume: 500.0, baseJitaSell: 29500, baseJitaBuy: 25800, baseDodixieSell: 39800, baseDodixieBuy: 28500, estDailyJitaVol: 18500, estDailyDodixieVol: 2400 },
  { typeId: 11129, name: 'Gallente Shuttle', category: 'shuttles', volume: 500.0, baseJitaSell: 31200, baseJitaBuy: 26400, baseDodixieSell: 32500, baseDodixieBuy: 27900, estDailyJitaVol: 6400, estDailyDodixieVol: 8200 },
  { typeId: 11132, name: 'Minmatar Shuttle', category: 'shuttles', volume: 500.0, baseJitaSell: 30800, baseJitaBuy: 26100, baseDodixieSell: 41200, baseDodixieBuy: 29000, estDailyJitaVol: 5200, estDailyDodixieVol: 1900 },
  { typeId: 11134, name: 'Amarr Shuttle', category: 'shuttles', volume: 500.0, baseJitaSell: 31400, baseJitaBuy: 26500, baseDodixieSell: 42500, baseDodixieBuy: 29500, estDailyJitaVol: 4800, estDailyDodixieVol: 1600 },

  // Implants
  { typeId: 10208, name: 'Ocular Filter - Standard', category: 'implants', volume: 1.0, baseJitaSell: 20800000, baseJitaBuy: 19400000, baseDodixieSell: 24200000, baseDodixieBuy: 20100000, estDailyJitaVol: 980, estDailyDodixieVol: 185 },
  { typeId: 10212, name: 'Memory Augmentation - Standard', category: 'implants', volume: 1.0, baseJitaSell: 21400000, baseJitaBuy: 19900000, baseDodixieSell: 24900000, baseDodixieBuy: 20700000, estDailyJitaVol: 920, estDailyDodixieVol: 170 },
  { typeId: 10217, name: 'Cybernetic Subprocessor - Standard', category: 'implants', volume: 1.0, baseJitaSell: 21600000, baseJitaBuy: 20100000, baseDodixieSell: 25100000, baseDodixieBuy: 20900000, estDailyJitaVol: 940, estDailyDodixieVol: 175 },
  { typeId: 10221, name: 'Neural Boost - Standard', category: 'implants', volume: 1.0, baseJitaSell: 20500000, baseJitaBuy: 19100000, baseDodixieSell: 23900000, baseDodixieBuy: 19800000, estDailyJitaVol: 880, estDailyDodixieVol: 165 },
  { typeId: 27180, name: "Zainou 'Gnome' Weapon Upgrades WU-1003", category: 'implants', volume: 1.0, baseJitaSell: 11200000, baseJitaBuy: 9950000, baseDodixieSell: 13800000, baseDodixieBuy: 10800000, estDailyJitaVol: 620, estDailyDodixieVol: 120 },
  { typeId: 27125, name: "Inherent Implants 'Squire' Power Grid Management EG-603", category: 'implants', volume: 1.0, baseJitaSell: 12400000, baseJitaBuy: 11100000, baseDodixieSell: 15100000, baseDodixieBuy: 11900000, estDailyJitaVol: 580, estDailyDodixieVol: 110 },
  { typeId: 19540, name: 'Mid-grade Snake Alpha', category: 'implants', volume: 1.0, baseJitaSell: 24500000, baseJitaBuy: 22100000, baseDodixieSell: 29200000, baseDodixieBuy: 23500000, estDailyJitaVol: 240, estDailyDodixieVol: 42 },

  // Scrap / Meta Loot Modules
  { typeId: 4393, name: '1MN Monopropellant Enduring Afterburner', category: 'scrap_loot', volume: 5.0, baseJitaSell: 118000, baseJitaBuy: 92000, baseDodixieSell: 158000, baseDodixieBuy: 108000, estDailyJitaVol: 12400, estDailyDodixieVol: 2800 },
  { typeId: 5973, name: '5MN Y-T8 Compact Microwarpdrive', category: 'scrap_loot', volume: 5.0, baseJitaSell: 245000, baseJitaBuy: 198000, baseDodixieSell: 315000, baseDodixieBuy: 230000, estDailyJitaVol: 14800, estDailyDodixieVol: 3400 },
  { typeId: 8517, name: 'Medium Azeotropic Restrained Shield Extender', category: 'scrap_loot', volume: 5.0, baseJitaSell: 185000, baseJitaBuy: 148000, baseDodixieSell: 242000, baseDodixieBuy: 175000, estDailyJitaVol: 9600, estDailyDodixieVol: 2100 },
  { typeId: 7839, name: 'Modal Mega Neutron Particle Accelerator I', category: 'scrap_loot', volume: 25.0, baseJitaSell: 162000, baseJitaBuy: 138000, baseDodixieSell: 198000, baseDodixieBuy: 145000, estDailyJitaVol: 4800, estDailyDodixieVol: 920 },
  { typeId: 10631, name: 'Arbalest Compact Light Missile Launcher', category: 'scrap_loot', volume: 5.0, baseJitaSell: 194000, baseJitaBuy: 158000, baseDodixieSell: 256000, baseDodixieBuy: 185000, estDailyJitaVol: 11200, estDailyDodixieVol: 2500 },

  // Ores
  { typeId: 62516, name: 'Compressed Veldspar', category: 'ores', volume: 0.001, baseJitaSell: 15.8, baseJitaBuy: 14.9, baseDodixieSell: 17.6, baseDodixieBuy: 15.1, estDailyJitaVol: 185000000, estDailyDodixieVol: 28000000 },
  { typeId: 62520, name: 'Compressed Scordite', category: 'ores', volume: 0.0015, baseJitaSell: 31.2, baseJitaBuy: 29.4, baseDodixieSell: 35.1, baseDodixieBuy: 29.8, estDailyJitaVol: 95000000, estDailyDodixieVol: 14000000 },
  { typeId: 62524, name: 'Compressed Pyroxeres', category: 'ores', volume: 0.003, baseJitaSell: 82.5, baseJitaBuy: 76.0, baseDodixieSell: 94.0, baseDodixieBuy: 78.5, estDailyJitaVol: 42000000, estDailyDodixieVol: 6500000 },
  { typeId: 62528, name: 'Compressed Plagioclase', category: 'ores', volume: 0.0035, baseJitaSell: 96.0, baseJitaBuy: 89.2, baseDodixieSell: 108.0, baseDodixieBuy: 91.0, estDailyJitaVol: 58000000, estDailyDodixieVol: 8200000 },
  { typeId: 1230, name: 'Veldspar', category: 'ores', volume: 0.1, baseJitaSell: 14.5, baseJitaBuy: 13.6, baseDodixieSell: 16.4, baseDodixieBuy: 13.8, estDailyJitaVol: 62000000, estDailyDodixieVol: 11000000 },

  // Ice
  { typeId: 28433, name: 'Compressed Blue Ice', category: 'ice', volume: 100.0, baseJitaSell: 398000, baseJitaBuy: 378000, baseDodixieSell: 442000, baseDodixieBuy: 382000, estDailyJitaVol: 94000, estDailyDodixieVol: 14000 },
  { typeId: 28434, name: 'Compressed Clear Icicle', category: 'ice', volume: 100.0, baseJitaSell: 386000, baseJitaBuy: 365000, baseDodixieSell: 428000, baseDodixieBuy: 369000, estDailyJitaVol: 82000, estDailyDodixieVol: 12000 },
  { typeId: 28444, name: 'Compressed White Glaze', category: 'ice', volume: 100.0, baseJitaSell: 412000, baseJitaBuy: 390000, baseDodixieSell: 455000, baseDodixieBuy: 395000, estDailyJitaVol: 78000, estDailyDodixieVol: 11500 },
  { typeId: 16272, name: 'Heavy Water', category: 'ice', volume: 0.4, baseJitaSell: 148.0, baseJitaBuy: 138.0, baseDodixieSell: 172.0, baseDodixieBuy: 142.0, estDailyJitaVol: 34000000, estDailyDodixieVol: 5800000 },
  { typeId: 16273, name: 'Liquid Ozone', category: 'ice', volume: 0.4, baseJitaSell: 185.0, baseJitaBuy: 172.0, baseDodixieSell: 215.0, baseDodixieBuy: 178.0, estDailyJitaVol: 22000000, estDailyDodixieVol: 4100000 },
  { typeId: 16275, name: 'Strontium Clathrates', category: 'ice', volume: 3.0, baseJitaSell: 2650, baseJitaBuy: 2450, baseDodixieSell: 3050, baseDodixieBuy: 2520, estDailyJitaVol: 950000, estDailyDodixieVol: 180000 },
  { typeId: 17888, name: 'Nitrogen Isotopes', category: 'ice', volume: 0.03, baseJitaSell: 1020, baseJitaBuy: 965, baseDodixieSell: 1150, baseDodixieBuy: 980, estDailyJitaVol: 14000000, estDailyDodixieVol: 1900000 },
  { typeId: 16274, name: 'Helium Isotopes', category: 'ice', volume: 0.03, baseJitaSell: 985, baseJitaBuy: 932, baseDodixieSell: 1110, baseDodixieBuy: 945, estDailyJitaVol: 11000000, estDailyDodixieVol: 1450000 },
  { typeId: 17887, name: 'Oxygen Isotopes', category: 'ice', volume: 0.03, baseJitaSell: 1045, baseJitaBuy: 990, baseDodixieSell: 1175, baseDodixieBuy: 1015, estDailyJitaVol: 9800000, estDailyDodixieVol: 2100000 },

  // Minerals
  { typeId: 34, name: 'Tritanium', category: 'minerals', volume: 0.01, baseJitaSell: 4.95, baseJitaBuy: 4.72, baseDodixieSell: 5.45, baseDodixieBuy: 4.80, estDailyJitaVol: 18500000000, estDailyDodixieVol: 2400000000 },
  { typeId: 35, name: 'Pyerite', category: 'minerals', volume: 0.01, baseJitaSell: 16.8, baseJitaBuy: 16.1, baseDodixieSell: 18.6, baseDodixieBuy: 16.3, estDailyJitaVol: 4200000000, estDailyDodixieVol: 580000000 },
  { typeId: 36, name: 'Mexallon', category: 'minerals', volume: 0.01, baseJitaSell: 66.5, baseJitaBuy: 63.4, baseDodixieSell: 73.5, baseDodixieBuy: 64.2, estDailyJitaVol: 1650000000, estDailyDodixieVol: 220000000 },
  { typeId: 37, name: 'Isogen', category: 'minerals', volume: 0.01, baseJitaSell: 295.0, baseJitaBuy: 282.0, baseDodixieSell: 328.0, baseDodixieBuy: 288.0, estDailyJitaVol: 340000000, estDailyDodixieVol: 48000000 },
  { typeId: 38, name: 'Nocxium', category: 'minerals', volume: 0.01, baseJitaSell: 1140.0, baseJitaBuy: 1095.0, baseDodixieSell: 1260.0, baseDodixieBuy: 1110.0, estDailyJitaVol: 95000000, estDailyDodixieVol: 12500000 },
  { typeId: 39, name: 'Zydrine', category: 'minerals', volume: 0.01, baseJitaSell: 1980.0, baseJitaBuy: 1890.0, baseDodixieSell: 2180.0, baseDodixieBuy: 1920.0, estDailyJitaVol: 52000000, estDailyDodixieVol: 7200000 },
  { typeId: 40, name: 'Megacyte', category: 'minerals', volume: 0.01, baseJitaSell: 2620.0, baseJitaBuy: 2510.0, baseDodixieSell: 2890.0, baseDodixieBuy: 2540.0, estDailyJitaVol: 28000000, estDailyDodixieVol: 3900000 },
  { typeId: 11399, name: 'Morphite', category: 'minerals', volume: 0.01, baseJitaSell: 24800.0, baseJitaBuy: 23600.0, baseDodixieSell: 27400.0, baseDodixieBuy: 24100.0, estDailyJitaVol: 3200000, estDailyDodixieVol: 410000 },

  // Salvaged Materials
  { typeId: 25605, name: 'Armor Plates', category: 'salvaged', volume: 0.01, baseJitaSell: 24500, baseJitaBuy: 22100, baseDodixieSell: 28800, baseDodixieBuy: 23400, estDailyJitaVol: 420000, estDailyDodixieVol: 68000 },
  { typeId: 25595, name: 'Alloyed Tritanium Bar', category: 'salvaged', volume: 0.01, baseJitaSell: 19800, baseJitaBuy: 17900, baseDodixieSell: 23400, baseDodixieBuy: 18900, estDailyJitaVol: 540000, estDailyDodixieVol: 82000 },
  { typeId: 25600, name: 'Burned Logic Circuit', category: 'salvaged', volume: 0.01, baseJitaSell: 48500, baseJitaBuy: 44200, baseDodixieSell: 56500, baseDodixieBuy: 46200, estDailyJitaVol: 310000, estDailyDodixieVol: 45000 },
  { typeId: 25589, name: 'Malfunctioning Shield Emitter', category: 'salvaged', volume: 0.01, baseJitaSell: 31200, baseJitaBuy: 28400, baseDodixieSell: 36800, baseDodixieBuy: 29800, estDailyJitaVol: 380000, estDailyDodixieVol: 58000 },
  { typeId: 25601, name: 'Fried Interface Circuit', category: 'salvaged', volume: 0.01, baseJitaSell: 41200, baseJitaBuy: 37500, baseDodixieSell: 48500, baseDodixieBuy: 39200, estDailyJitaVol: 260000, estDailyDodixieVol: 39000 },
  { typeId: 25624, name: 'Intact Armor Plates', category: 'salvaged', volume: 0.01, baseJitaSell: 4650000, baseJitaBuy: 4320000, baseDodixieSell: 5380000, baseDodixieBuy: 4510000, estDailyJitaVol: 14500, estDailyDodixieVol: 2200 },
  { typeId: 25625, name: 'Enhanced Ward Console', category: 'salvaged', volume: 0.01, baseJitaSell: 2850000, baseJitaBuy: 2610000, baseDodixieSell: 3340000, baseDodixieBuy: 2740000, estDailyJitaVol: 12800, estDailyDodixieVol: 1950 },
  { typeId: 25616, name: 'Power Circuit', category: 'salvaged', volume: 0.01, baseJitaSell: 940000, baseJitaBuy: 865000, baseDodixieSell: 1120000, baseDodixieBuy: 910000, estDailyJitaVol: 26000, estDailyDodixieVol: 4100 },
  { typeId: 25617, name: 'Logic Circuit', category: 'salvaged', volume: 0.01, baseJitaSell: 1180000, baseJitaBuy: 1090000, baseDodixieSell: 1390000, baseDodixieBuy: 1140000, estDailyJitaVol: 24000, estDailyDodixieVol: 3800 },

  // PI (P0 - P1)
  { typeId: 2268, name: 'Aqueous Liquids', category: 'pi_p0_p1', volume: 0.01, baseJitaSell: 4.8, baseJitaBuy: 4.1, baseDodixieSell: 5.9, baseDodixieBuy: 4.2, estDailyJitaVol: 95000000, estDailyDodixieVol: 14000000, piTier: 0, piBaseValue: 5 },
  { typeId: 2267, name: 'Base Metals', category: 'pi_p0_p1', volume: 0.01, baseJitaSell: 5.1, baseJitaBuy: 4.4, baseDodixieSell: 6.2, baseDodixieBuy: 4.5, estDailyJitaVol: 88000000, estDailyDodixieVol: 12500000, piTier: 0, piBaseValue: 5 },
  { typeId: 2270, name: 'Noble Metals', category: 'pi_p0_p1', volume: 0.01, baseJitaSell: 5.4, baseJitaBuy: 4.6, baseDodixieSell: 6.5, baseDodixieBuy: 4.7, estDailyJitaVol: 72000000, estDailyDodixieVol: 10500000, piTier: 0, piBaseValue: 5 },
  { typeId: 3645, name: 'Water', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 585.0, baseJitaBuy: 540.0, baseDodixieSell: 695.0, baseDodixieBuy: 560.0, estDailyJitaVol: 5800000, estDailyDodixieVol: 890000, piTier: 1, piBaseValue: 400 },
  { typeId: 2398, name: 'Reactive Metals', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 620.0, baseJitaBuy: 575.0, baseDodixieSell: 735.0, baseDodixieBuy: 590.0, estDailyJitaVol: 6200000, estDailyDodixieVol: 950000, piTier: 1, piBaseValue: 400 },
  { typeId: 2399, name: 'Precious Metals', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 660.0, baseJitaBuy: 615.0, baseDodixieSell: 780.0, baseDodixieBuy: 635.0, estDailyJitaVol: 4800000, estDailyDodixieVol: 720000, piTier: 1, piBaseValue: 400 },
  { typeId: 2390, name: 'Electrolytes', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 595.0, baseJitaBuy: 552.0, baseDodixieSell: 710.0, baseDodixieBuy: 570.0, estDailyJitaVol: 4500000, estDailyDodixieVol: 680000, piTier: 1, piBaseValue: 400 },
  { typeId: 2401, name: 'Chiral Structures', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 640.0, baseJitaBuy: 592.0, baseDodixieSell: 760.0, baseDodixieBuy: 612.0, estDailyJitaVol: 4100000, estDailyDodixieVol: 620000, piTier: 1, piBaseValue: 400 },
  { typeId: 2400, name: 'Toxic Metals', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 695.0, baseJitaBuy: 645.0, baseDodixieSell: 825.0, baseDodixieBuy: 665.0, estDailyJitaVol: 3900000, estDailyDodixieVol: 580000, piTier: 1, piBaseValue: 400 },
  { typeId: 2393, name: 'Bacteria', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 575.0, baseJitaBuy: 530.0, baseDodixieSell: 685.0, baseDodixieBuy: 550.0, estDailyJitaVol: 5100000, estDailyDodixieVol: 780000, piTier: 1, piBaseValue: 400 },
  { typeId: 2389, name: 'Plasmoids', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 610.0, baseJitaBuy: 565.0, baseDodixieSell: 725.0, baseDodixieBuy: 582.0, estDailyJitaVol: 4300000, estDailyDodixieVol: 640000, piTier: 1, piBaseValue: 400 },
  { typeId: 3683, name: 'Oxygen', category: 'pi_p0_p1', volume: 0.38, baseJitaSell: 590.0, baseJitaBuy: 545.0, baseDodixieSell: 702.0, baseDodixieBuy: 565.0, estDailyJitaVol: 4900000, estDailyDodixieVol: 740000, piTier: 1, piBaseValue: 400 },

  // PI (P2 - P4)
  { typeId: 9832, name: 'Coolant', category: 'pi_p2_p4', volume: 1.5, baseJitaSell: 11850, baseJitaBuy: 11100, baseDodixieSell: 13800, baseDodixieBuy: 11500, estDailyJitaVol: 1450000, estDailyDodixieVol: 210000, piTier: 2, piBaseValue: 7200 },
  { typeId: 44, name: 'Enriched Uranium', category: 'pi_p2_p4', volume: 1.5, baseJitaSell: 12900, baseJitaBuy: 12150, baseDodixieSell: 14950, baseDodixieBuy: 12500, estDailyJitaVol: 1250000, estDailyDodixieVol: 185000, piTier: 2, piBaseValue: 7200 },
  { typeId: 3689, name: 'Mechanical Parts', category: 'pi_p2_p4', volume: 1.5, baseJitaSell: 12450, baseJitaBuy: 11650, baseDodixieSell: 14450, baseDodixieBuy: 12100, estDailyJitaVol: 1680000, estDailyDodixieVol: 240000, piTier: 2, piBaseValue: 7200 },
  { typeId: 9836, name: 'Consumer Electronics', category: 'pi_p2_p4', volume: 1.5, baseJitaSell: 13100, baseJitaBuy: 12300, baseDodixieSell: 15200, baseDodixieBuy: 12750, estDailyJitaVol: 1180000, estDailyDodixieVol: 175000, piTier: 2, piBaseValue: 7200 },
  { typeId: 9830, name: 'Rocket Fuel', category: 'pi_p2_p4', volume: 1.5, baseJitaSell: 11950, baseJitaBuy: 11200, baseDodixieSell: 13900, baseDodixieBuy: 11600, estDailyJitaVol: 960000, estDailyDodixieVol: 145000, piTier: 2, piBaseValue: 7200 },
  { typeId: 9848, name: 'Robotics', category: 'pi_p2_p4', volume: 6.0, baseJitaSell: 94500, baseJitaBuy: 89200, baseDodixieSell: 112000, baseDodixieBuy: 92500, estDailyJitaVol: 540000, estDailyDodixieVol: 82000, piTier: 3, piBaseValue: 60000 },
  { typeId: 9834, name: 'Guidance Systems', category: 'pi_p2_p4', volume: 6.0, baseJitaSell: 88500, baseJitaBuy: 83400, baseDodixieSell: 105000, baseDodixieBuy: 86500, estDailyJitaVol: 240000, estDailyDodixieVol: 38000, piTier: 3, piBaseValue: 60000 },
  { typeId: 2349, name: 'Supercomputers', category: 'pi_p2_p4', volume: 6.0, baseJitaSell: 102000, baseJitaBuy: 95800, baseDodixieSell: 121000, baseDodixieBuy: 99500, estDailyJitaVol: 195000, estDailyDodixieVol: 29000, piTier: 3, piBaseValue: 60000 },
  { typeId: 12836, name: 'Transcranial Microcontrollers', category: 'pi_p2_p4', volume: 6.0, baseJitaSell: 98500, baseJitaBuy: 92400, baseDodixieSell: 116500, baseDodixieBuy: 96000, estDailyJitaVol: 175000, estDailyDodixieVol: 24000, piTier: 3, piBaseValue: 60000 },
  { typeId: 2869, name: 'Nano-Factory', category: 'pi_p2_p4', volume: 100.0, baseJitaSell: 1595000, baseJitaBuy: 1490000, baseDodixieSell: 1840000, baseDodixieBuy: 1550000, estDailyJitaVol: 18500, estDailyDodixieVol: 2800, piTier: 4, piBaseValue: 1200000 },
  { typeId: 2867, name: 'Broadcast Node', category: 'pi_p2_p4', volume: 100.0, baseJitaSell: 1740000, baseJitaBuy: 1625000, baseDodixieSell: 2010000, baseDodixieBuy: 1690000, estDailyJitaVol: 14200, estDailyDodixieVol: 2100, piTier: 4, piBaseValue: 1200000 },
  { typeId: 2876, name: 'Wetware Mainframe', category: 'pi_p2_p4', volume: 100.0, baseJitaSell: 1890000, baseJitaBuy: 1770000, baseDodixieSell: 2180000, baseDodixieBuy: 1840000, estDailyJitaVol: 12800, estDailyDodixieVol: 1950, piTier: 4, piBaseValue: 1200000 },

  // Supporting Industry Inputs (Datacores, R.A.M., Moon Components)
  { typeId: 20424, name: 'Datacore - Mechanical Engineering', category: 'indy_support', volume: 0.1, baseJitaSell: 108000, baseJitaBuy: 98000, baseDodixieSell: 122000, baseDodixieBuy: 102000, estDailyJitaVol: 85000, estDailyDodixieVol: 12000 },
  { typeId: 20420, name: 'Datacore - Rocket Science', category: 'indy_support', volume: 0.1, baseJitaSell: 124000, baseJitaBuy: 112000, baseDodixieSell: 138000, baseDodixieBuy: 118000, estDailyJitaVol: 62000, estDailyDodixieVol: 9500 },
  { typeId: 20410, name: 'Datacore - Gallentean Starship Engineering', category: 'indy_support', volume: 0.1, baseJitaSell: 115000, baseJitaBuy: 104000, baseDodixieSell: 129000, baseDodixieBuy: 108000, estDailyJitaVol: 72000, estDailyDodixieVol: 11000 },
  { typeId: 20411, name: 'Datacore - High Energy Physics', category: 'indy_support', volume: 0.1, baseJitaSell: 119000, baseJitaBuy: 108000, baseDodixieSell: 134000, baseDodixieBuy: 112000, estDailyJitaVol: 68000, estDailyDodixieVol: 9800 },
  { typeId: 20418, name: 'Datacore - Electronic Engineering', category: 'indy_support', volume: 0.1, baseJitaSell: 112000, baseJitaBuy: 101000, baseDodixieSell: 126000, baseDodixieBuy: 105000, estDailyJitaVol: 74000, estDailyDodixieVol: 10500 },
  { typeId: 11478, name: 'R.A.M.- Ammunition Tech', category: 'indy_support', volume: 0.04, baseJitaSell: 4200, baseJitaBuy: 3600, baseDodixieSell: 5200, baseDodixieBuy: 3900, estDailyJitaVol: 480000, estDailyDodixieVol: 75000 },
  { typeId: 11486, name: 'R.A.M.- Robotics', category: 'indy_support', volume: 0.04, baseJitaSell: 4600, baseJitaBuy: 3900, baseDodixieSell: 5600, baseDodixieBuy: 4200, estDailyJitaVol: 320000, estDailyDodixieVol: 52000 },
  { typeId: 16683, name: 'Ferrogel', category: 'indy_support', volume: 1.0, baseJitaSell: 24500, baseJitaBuy: 22800, baseDodixieSell: 27800, baseDodixieBuy: 23600, estDailyJitaVol: 620000, estDailyDodixieVol: 82000 },
  { typeId: 16679, name: 'Fullerides', category: 'indy_support', volume: 1.0, baseJitaSell: 11200, baseJitaBuy: 10400, baseDodixieSell: 12900, baseDodixieBuy: 10800, estDailyJitaVol: 840000, estDailyDodixieVol: 110000 },
  { typeId: 16682, name: 'Hypersynaptic Fibers', category: 'indy_support', volume: 1.0, baseJitaSell: 39500, baseJitaBuy: 36800, baseDodixieSell: 44800, baseDodixieBuy: 38200, estDailyJitaVol: 480000, estDailyDodixieVol: 64000 },
  { typeId: 16680, name: 'Phenolic Composites', category: 'indy_support', volume: 1.0, baseJitaSell: 13800, baseJitaBuy: 12900, baseDodixieSell: 15900, baseDodixieBuy: 13400, estDailyJitaVol: 720000, estDailyDodixieVol: 95000 },
];

export const ITEM_BY_ID: Record<number, EveItem> = Object.fromEntries(
  EVE_ITEMS.map((item) => [item.typeId, item])
);

export function getItemsForCategories(categories: MarketCategoryId[]): EveItem[] {
  const catSet = new Set(categories);
  return EVE_ITEMS.filter((item) => item.category !== 'indy_support' && catSet.has(item.category));
}

export function getTypeIdsToFetch(categories: MarketCategoryId[]): number[] {
  const catSet = new Set(categories);
  const ids = new Set<number>();

  for (const item of EVE_ITEMS) {
    if (item.category !== 'indy_support' && catSet.has(item.category)) {
      ids.add(item.typeId);
    }
  }

  // Always include minerals + salvaged + indy support materials needed to price recipes
  const needsIndyInputs =
    catSet.has('t1_ammo') ||
    catSet.has('t2_ammo') ||
    catSet.has('bombs') ||
    catSet.has('t1_rigs') ||
    catSet.has('t2_rigs') ||
    catSet.has('t1_drones') ||
    catSet.has('t2_drones') ||
    catSet.has('shuttles') ||
    catSet.has('fuel_blocks') ||
    catSet.has('probes') ||
    catSet.has('scripts') ||
    catSet.has('ores') ||
    catSet.has('ice') ||
    catSet.has('scrap_loot');

  if (needsIndyInputs) {
    for (const item of EVE_ITEMS) {
      if (
        item.category === 'indy_support' ||
        item.category === 'minerals' ||
        item.category === 'salvaged' ||
        item.category === 'ice' ||
        item.category === 'pi_p2_p4'
      ) {
        ids.add(item.typeId);
      }
    }
  }

  return Array.from(ids);
}

// --- Blueprints & Manufacturing / T2 Invention Recipes ---

export interface IndustryRecipe {
  id: string;
  productTypeId: number;
  productName: string;
  category: MarketCategoryId;
  tier: 'T1' | 'T2';
  outputPerRun: number;
  batchRuns: number; // Sensible production batch size for Ishisomo slots
  baseMaterials: { typeId: number; quantity: number }[]; // At ME 0
  jobCostPct: number; // System cost index + NPC facility fee (~0.062 in Ishisomo NPC)
  invention?: {
    t1SourceName: string;
    baseChance: number; // Base chance before skills (e.g. 0.34 or 0.40)
    datacores: { typeId: number; quantity: number }[];
    bpcRunsOutput: number; // Vanilla (no decryptor) T2 BPC runs (e.g. 10)
    t2Me: number; // Vanilla no-decryptor ME = 2
    t2Te: number; // Vanilla no-decryptor TE = 4
    copyTimeHoursPerRun: number;
  };
}

export const INDUSTRY_RECIPES: IndustryRecipe[] = [
  {
    id: 'rec-scourge-fury',
    productTypeId: 2629,
    productName: 'Scourge Fury Heavy Missile',
    category: 't2_ammo',
    tier: 'T2',
    outputPerRun: 5000,
    batchRuns: 100,
    baseMaterials: [
      { typeId: 209, quantity: 5000 }, // Scourge Heavy Missile
      { typeId: 11399, quantity: 6 }, // Morphite
      { typeId: 16683, quantity: 8 }, // Ferrogel
      { typeId: 11478, quantity: 2 }, // R.A.M.- Ammunition Tech
      { typeId: 9830, quantity: 4 }, // Rocket Fuel
    ],
    jobCostPct: 0.062,
    invention: {
      t1SourceName: 'Scourge Heavy Missile Blueprint',
      baseChance: 0.34,
      datacores: [
        { typeId: 20420, quantity: 2 }, // Rocket Science
        { typeId: 20424, quantity: 2 }, // Mechanical Engineering
      ],
      bpcRunsOutput: 10,
      t2Me: 2,
      t2Te: 4,
      copyTimeHoursPerRun: 0.25,
    },
  },
  {
    id: 'rec-void-m',
    productTypeId: 12785,
    productName: 'Void M',
    category: 't2_ammo',
    tier: 'T2',
    outputPerRun: 5000,
    batchRuns: 100,
    baseMaterials: [
      { typeId: 230, quantity: 5000 }, // Antimatter Charge M
      { typeId: 11399, quantity: 5 },
      { typeId: 16680, quantity: 9 }, // Phenolic Composites
      { typeId: 11478, quantity: 2 },
    ],
    jobCostPct: 0.062,
    invention: {
      t1SourceName: 'Antimatter Charge M Blueprint',
      baseChance: 0.34,
      datacores: [
        { typeId: 20411, quantity: 2 }, // High Energy Physics
        { typeId: 20424, quantity: 2 }, // Mechanical Engineering
      ],
      bpcRunsOutput: 10,
      t2Me: 2,
      t2Te: 4,
      copyTimeHoursPerRun: 0.22,
    },
  },
  {
    id: 'rec-hammerhead-ii',
    productTypeId: 2185,
    productName: 'Hammerhead II',
    category: 't2_drones',
    tier: 'T2',
    outputPerRun: 1,
    batchRuns: 240,
    baseMaterials: [
      { typeId: 2183, quantity: 1 }, // Hammerhead I
      { typeId: 11399, quantity: 12 }, // Morphite
      { typeId: 9848, quantity: 2 }, // Robotics
      { typeId: 16682, quantity: 4 }, // Hypersynaptic Fibers
      { typeId: 16679, quantity: 14 }, // Fullerides
      { typeId: 11486, quantity: 1 }, // R.A.M.- Robotics
    ],
    jobCostPct: 0.064,
    invention: {
      t1SourceName: 'Hammerhead I Blueprint',
      baseChance: 0.34,
      datacores: [
        { typeId: 20410, quantity: 2 }, // Gallentean Starship Eng
        { typeId: 20424, quantity: 2 }, // Mechanical Engineering
      ],
      bpcRunsOutput: 10,
      t2Me: 2,
      t2Te: 4,
      copyTimeHoursPerRun: 0.5,
    },
  },
  {
    id: 'rec-hobgoblin-ii',
    productTypeId: 2456,
    productName: 'Hobgoblin II',
    category: 't2_drones',
    tier: 'T2',
    outputPerRun: 1,
    batchRuns: 350,
    baseMaterials: [
      { typeId: 2454, quantity: 1 }, // Hobgoblin I
      { typeId: 11399, quantity: 6 },
      { typeId: 9848, quantity: 1 },
      { typeId: 16682, quantity: 2 },
      { typeId: 16679, quantity: 8 },
      { typeId: 11486, quantity: 1 },
    ],
    jobCostPct: 0.064,
    invention: {
      t1SourceName: 'Hobgoblin I Blueprint',
      baseChance: 0.34,
      datacores: [
        { typeId: 20410, quantity: 2 },
        { typeId: 20424, quantity: 2 },
      ],
      bpcRunsOutput: 10,
      t2Me: 2,
      t2Te: 4,
      copyTimeHoursPerRun: 0.35,
    },
  },
  {
    id: 'rec-hammerhead-i',
    productTypeId: 2183,
    productName: 'Hammerhead I',
    category: 't1_drones',
    tier: 'T1',
    outputPerRun: 1,
    batchRuns: 600,
    baseMaterials: [
      { typeId: 34, quantity: 2400 },
      { typeId: 35, quantity: 650 },
      { typeId: 36, quantity: 145 },
      { typeId: 37, quantity: 18 },
    ],
    jobCostPct: 0.056,
  },
  {
    id: 'rec-electron-bomb',
    productTypeId: 27912,
    productName: 'Electron Bomb',
    category: 'bombs',
    tier: 'T1',
    outputPerRun: 1,
    batchRuns: 300,
    baseMaterials: [
      { typeId: 34, quantity: 24000 },
      { typeId: 35, quantity: 7200 },
      { typeId: 36, quantity: 1350 },
      { typeId: 37, quantity: 140 },
      { typeId: 38, quantity: 26 },
    ],
    jobCostPct: 0.058,
  },
  {
    id: 'rec-med-cdfe-i',
    productTypeId: 31788,
    productName: 'Medium Core Defense Field Extender I',
    category: 't1_rigs',
    tier: 'T1',
    outputPerRun: 1,
    batchRuns: 200,
    baseMaterials: [
      { typeId: 25589, quantity: 14 }, // Malfunctioning Shield Emitter
      { typeId: 25595, quantity: 18 }, // Alloyed Tritanium Bar
      { typeId: 25600, quantity: 4 }, // Burned Logic Circuit
    ],
    jobCostPct: 0.058,
  },
  {
    id: 'rec-small-cdfe-ii',
    productTypeId: 31724,
    productName: 'Small Core Defense Field Extender II',
    category: 't2_rigs',
    tier: 'T2',
    outputPerRun: 1,
    batchRuns: 60,
    baseMaterials: [
      { typeId: 25589, quantity: 22 },
      { typeId: 25600, quantity: 16 },
      { typeId: 25601, quantity: 12 }, // Fried Interface Circuit
      { typeId: 16683, quantity: 28 },
      { typeId: 11399, quantity: 32 },
    ],
    jobCostPct: 0.065,
    invention: {
      t1SourceName: 'Small Core Defense Field Extender I Blueprint',
      baseChance: 0.34,
      datacores: [
        { typeId: 20418, quantity: 2 }, // Electronic Engineering
        { typeId: 20424, quantity: 2 }, // Mechanical Engineering
      ],
      bpcRunsOutput: 10,
      t2Me: 2,
      t2Te: 4,
      copyTimeHoursPerRun: 0.4,
    },
  },
  {
    id: 'rec-nitrogen-fuel',
    productTypeId: 4051,
    productName: 'Nitrogen Fuel Block',
    category: 'fuel_blocks',
    tier: 'T1',
    outputPerRun: 40,
    batchRuns: 600,
    baseMaterials: [
      { typeId: 17888, quantity: 450 }, // Nitrogen Isotopes
      { typeId: 16272, quantity: 170 }, // Heavy Water
      { typeId: 16273, quantity: 350 }, // Liquid Ozone
      { typeId: 16275, quantity: 20 }, // Strontium Clathrates
      { typeId: 9832, quantity: 9 }, // Coolant
      { typeId: 44, quantity: 4 }, // Enriched Uranium
      { typeId: 3689, quantity: 4 }, // Mechanical Parts
      { typeId: 9848, quantity: 1 }, // Robotics
      { typeId: 3683, quantity: 22 }, // Oxygen
    ],
    jobCostPct: 0.056,
  },
  {
    id: 'rec-caldari-shuttle',
    productTypeId: 672,
    productName: 'Caldari Shuttle',
    category: 'shuttles',
    tier: 'T1',
    outputPerRun: 1,
    batchRuns: 350,
    baseMaterials: [
      { typeId: 34, quantity: 2778 }, // Tritanium
      { typeId: 35, quantity: 420 }, // Pyerite
    ],
    jobCostPct: 0.055,
  },
  {
    id: 'rec-core-probe',
    productTypeId: 30013,
    productName: 'Core Scanner Probe I',
    category: 'probes',
    tier: 'T1',
    outputPerRun: 10,
    batchRuns: 500,
    baseMaterials: [
      { typeId: 34, quantity: 5200 },
      { typeId: 35, quantity: 1480 },
      { typeId: 36, quantity: 320 },
      { typeId: 37, quantity: 24 },
    ],
    jobCostPct: 0.056,
  },
  {
    id: 'rec-tracking-script',
    productTypeId: 29001,
    productName: 'Tracking Speed Script',
    category: 'scripts',
    tier: 'T1',
    outputPerRun: 10,
    batchRuns: 300,
    baseMaterials: [
      { typeId: 34, quantity: 8400 },
      { typeId: 35, quantity: 2600 },
      { typeId: 36, quantity: 620 },
      { typeId: 37, quantity: 145 },
    ],
    jobCostPct: 0.056,
  },
  {
    id: 'rec-antimatter-m',
    productTypeId: 230,
    productName: 'Antimatter Charge M',
    category: 't1_ammo',
    tier: 'T1',
    outputPerRun: 100,
    batchRuns: 1200,
    baseMaterials: [
      { typeId: 34, quantity: 360 },
      { typeId: 35, quantity: 185 },
      { typeId: 36, quantity: 48 },
      { typeId: 37, quantity: 6 },
    ],
    jobCostPct: 0.055,
  },
];

// --- Reprocessing Recipes (Ore, Ice, Meta Scrap) ---

export interface ReprocessingEntry {
  id: string;
  inputTypeId: number;
  inputName: string;
  category: 'ores' | 'ice' | 'scrap_loot';
  portionSize: number; // Units required per refine batch (100 for ore, 1 for ice/modules)
  isScrap: boolean;
  baseOutputs: { typeId: number; quantity: number }[]; // At 100% theoretical yield before station/skill factor
}

export const REPROCESSING_CATALOG: ReprocessingEntry[] = [
  {
    id: 'rep-comp-veldspar',
    inputTypeId: 62516,
    inputName: 'Compressed Veldspar',
    category: 'ores',
    portionSize: 100,
    isScrap: false,
    baseOutputs: [{ typeId: 34, quantity: 415 }], // Tritanium
  },
  {
    id: 'rep-comp-scordite',
    inputTypeId: 62520,
    inputName: 'Compressed Scordite',
    category: 'ores',
    portionSize: 100,
    isScrap: false,
    baseOutputs: [
      { typeId: 34, quantity: 150 },
      { typeId: 35, quantity: 225 },
    ],
  },
  {
    id: 'rep-comp-plagioclase',
    inputTypeId: 62528,
    inputName: 'Compressed Plagioclase',
    category: 'ores',
    portionSize: 100,
    isScrap: false,
    baseOutputs: [
      { typeId: 34, quantity: 175 },
      { typeId: 36, quantity: 185 },
    ],
  },
  {
    id: 'rep-comp-pyroxeres',
    inputTypeId: 62524,
    inputName: 'Compressed Pyroxeres',
    category: 'ores',
    portionSize: 100,
    isScrap: false,
    baseOutputs: [
      { typeId: 35, quantity: 90 },
      { typeId: 36, quantity: 65 },
      { typeId: 38, quantity: 5 },
    ],
  },
  {
    id: 'rep-blue-ice',
    inputTypeId: 28433,
    inputName: 'Compressed Blue Ice',
    category: 'ice',
    portionSize: 1,
    isScrap: false,
    baseOutputs: [
      { typeId: 16272, quantity: 69 }, // Heavy Water
      { typeId: 16273, quantity: 35 }, // Liquid Ozone
      { typeId: 16275, quantity: 1 }, // Strontium Clathrates
      { typeId: 17888, quantity: 560 }, // Nitrogen Isotopes
    ],
  },
  {
    id: 'rep-clear-icicle',
    inputTypeId: 28434,
    inputName: 'Compressed Clear Icicle',
    category: 'ice',
    portionSize: 1,
    isScrap: false,
    baseOutputs: [
      { typeId: 16272, quantity: 69 },
      { typeId: 16273, quantity: 35 },
      { typeId: 16275, quantity: 1 },
      { typeId: 16274, quantity: 560 }, // Helium Isotopes
    ],
  },
  {
    id: 'rep-white-glaze',
    inputTypeId: 28444,
    inputName: 'Compressed White Glaze',
    category: 'ice',
    portionSize: 1,
    isScrap: false,
    baseOutputs: [
      { typeId: 16272, quantity: 69 },
      { typeId: 16273, quantity: 35 },
      { typeId: 16275, quantity: 1 },
      { typeId: 17887, quantity: 560 }, // Oxygen Isotopes
    ],
  },
  {
    id: 'rep-modal-neutron',
    inputTypeId: 7839,
    inputName: 'Modal Mega Neutron Particle Accelerator I',
    category: 'scrap_loot',
    portionSize: 1,
    isScrap: true,
    baseOutputs: [
      { typeId: 34, quantity: 16500 },
      { typeId: 35, quantity: 5200 },
      { typeId: 36, quantity: 1650 },
      { typeId: 37, quantity: 295 },
      { typeId: 38, quantity: 42 },
    ],
  },
  {
    id: 'rep-enduring-ab',
    inputTypeId: 4393,
    inputName: '1MN Monopropellant Enduring Afterburner',
    category: 'scrap_loot',
    portionSize: 1,
    isScrap: true,
    baseOutputs: [
      { typeId: 34, quantity: 11200 },
      { typeId: 35, quantity: 3800 },
      { typeId: 36, quantity: 1120 },
      { typeId: 37, quantity: 180 },
    ],
  },
];

// --- PI Factory Schematics (P0->P1, P1->P2, P2->P3, P3->P4) ---

export interface PiSchematic {
  id: string;
  tierStep: 'P0 -> P1' | 'P1 -> P2' | 'P2 -> P3' | 'P3 -> P4';
  outputTypeId: number;
  outputName: string;
  outputQtyPerCycle: number;
  cyclesPerDayPerFactory: number; // Basic = 48/day (30m), Advanced/High-Tech = 24/day (1h)
  factoriesPerPlanet: number; // Realistic single high-sec Command Center V layout
  inputs: { typeId: number; quantity: number }[];
  categories: MarketCategoryId[];
}

export const PI_SCHEMATICS: PiSchematic[] = [
  {
    id: 'pi-water',
    tierStep: 'P0 -> P1',
    outputTypeId: 3645,
    outputName: 'Water',
    outputQtyPerCycle: 20,
    cyclesPerDayPerFactory: 48,
    factoriesPerPlanet: 18,
    inputs: [{ typeId: 2268, quantity: 3000 }], // Aqueous Liquids
    categories: ['pi_p0_p1'],
  },
  {
    id: 'pi-reactive-metals',
    tierStep: 'P0 -> P1',
    outputTypeId: 2398,
    outputName: 'Reactive Metals',
    outputQtyPerCycle: 20,
    cyclesPerDayPerFactory: 48,
    factoriesPerPlanet: 18,
    inputs: [{ typeId: 2267, quantity: 3000 }], // Base Metals
    categories: ['pi_p0_p1'],
  },
  {
    id: 'pi-coolant',
    tierStep: 'P1 -> P2',
    outputTypeId: 9832,
    outputName: 'Coolant',
    outputQtyPerCycle: 5,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 18,
    inputs: [
      { typeId: 3645, quantity: 40 }, // Water
      { typeId: 2390, quantity: 40 }, // Electrolytes
    ],
    categories: ['pi_p0_p1', 'pi_p2_p4'],
  },
  {
    id: 'pi-mechanical-parts',
    tierStep: 'P1 -> P2',
    outputTypeId: 3689,
    outputName: 'Mechanical Parts',
    outputQtyPerCycle: 5,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 18,
    inputs: [
      { typeId: 2398, quantity: 40 }, // Reactive Metals
      { typeId: 2399, quantity: 40 }, // Precious Metals
    ],
    categories: ['pi_p0_p1', 'pi_p2_p4'],
  },
  {
    id: 'pi-consumer-electronics',
    tierStep: 'P1 -> P2',
    outputTypeId: 9836,
    outputName: 'Consumer Electronics',
    outputQtyPerCycle: 5,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 18,
    inputs: [
      { typeId: 2401, quantity: 40 }, // Chiral Structures
      { typeId: 2400, quantity: 40 }, // Toxic Metals
    ],
    categories: ['pi_p0_p1', 'pi_p2_p4'],
  },
  {
    id: 'pi-robotics',
    tierStep: 'P2 -> P3',
    outputTypeId: 9848,
    outputName: 'Robotics',
    outputQtyPerCycle: 3,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 16,
    inputs: [
      { typeId: 3689, quantity: 10 }, // Mechanical Parts
      { typeId: 9836, quantity: 10 }, // Consumer Electronics
    ],
    categories: ['pi_p2_p4'],
  },
  {
    id: 'pi-nano-factory',
    tierStep: 'P3 -> P4',
    outputTypeId: 2869,
    outputName: 'Nano-Factory',
    outputQtyPerCycle: 1,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 8,
    inputs: [
      { typeId: 9848, quantity: 6 }, // Robotics
      { typeId: 2349, quantity: 6 }, // Supercomputers
      { typeId: 2398, quantity: 40 }, // Reactive Metals
    ],
    categories: ['pi_p2_p4'],
  },
  {
    id: 'pi-wetware-mainframe',
    tierStep: 'P3 -> P4',
    outputTypeId: 2876,
    outputName: 'Wetware Mainframe',
    outputQtyPerCycle: 1,
    cyclesPerDayPerFactory: 24,
    factoriesPerPlanet: 8,
    inputs: [
      { typeId: 2349, quantity: 6 }, // Supercomputers
      { typeId: 12836, quantity: 6 }, // Transcranial Microcontrollers
      { typeId: 9832, quantity: 20 }, // Coolant (proxy for biotech input)
    ],
    categories: ['pi_p2_p4'],
  },
];

// --- Default Simulation / Offline Pilot Profile ---

export const DEFAULT_SIMULATION_PROFILE: PilotProfile = {
  mode: 'simulation',
  characterName: 'Ishisomo Industrialist (Sim)',
  totalSp: 187_420_000,
  walletBalance: 1_000_000_000,
  activeCapitalCap: 1_000_000_000,
  orderExecutionMode: 'list_orders',
  currentSystemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
  currentSystemName: 'Ishisomo',
  currentStationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
  currentStationName: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
  activeOrders: [],
  skills: {
    accounting: 5,
    brokerRelations: 5,
    procurement: 4,
    marketing: 4,
    reprocessing: 5,
    reprocessingEfficiency: 5,
    scrapmetalProcessing: 5,
    industry: 5,
    scienceEncryption: 5,
  },
  haulingSkills: {
    3340: 5,
    3341: 5,
    3342: 5,
    3343: 5,
    19719: 5,
    29637: 5,
    81032: 5,
    34327: 5,
    20526: 5,
  },
  pocoImportTaxPct: 10,
  pocoExportTaxPct: 10,
  hulls: [
    {
      id: 'hull-br',
      typeId: 12729,
      shipTypeName: 'Crane',
      customName: 'RedFox Ghost',
      name: 'RedFox Ghost (Crane)',
      hullClass: 'blockade_runner',
      capacityM3: 10209,
      baseCargoM3: 3950,
      fittedCargoM3: 10209,
      location: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      stationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
      systemName: 'Ishisomo',
      isActiveShip: true,
      fittedModules: ['Covert Ops Cloaking Device II', 'Expanded Cargohold II', 'Expanded Cargohold II'],
      fittedRigs: ['Medium Cargohold Optimization I', 'Medium Cargohold Optimization I'],
      isTanked: false,
      isCloaky: true,
      safeIskThreshold: 5_000_000_000,
      notes: 'CovOps Cloak · 2× Expanded Cargohold II · 2× Cargo Opt I',
    },
    {
      id: 'hull-dst',
      typeId: 12731,
      shipTypeName: 'Bustard',
      customName: 'RedFox Vault',
      name: 'RedFox Vault (Bustard)',
      hullClass: 'dst',
      capacityM3: 66500,
      baseCargoM3: 4000,
      fittedCargoM3: 4000,
      fleetHangarM3: 62500,
      location: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      stationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
      systemName: 'Ishisomo',
      fittedModules: ['Damage Control II', 'Multispectrum Shield Hardener II', 'Large Shield Extender II', 'Reinforced Bulkheads II'],
      fittedRigs: ['Medium Core Defense Field Extender II'],
      isTanked: true,
      isCloaky: false,
      safeIskThreshold: 2_500_000_000,
      notes: 'Tanked DST · 62.5k Fleet Hangar + 4.0k Cargo · High-EHP',
    },
    {
      id: 'hull-orca',
      typeId: 28606,
      shipTypeName: 'Orca',
      customName: 'Ishisomo Forge Barge',
      name: 'Ishisomo Forge Barge (Orca)',
      hullClass: 'orca',
      capacityM3: 187500,
      baseCargoM3: 30000,
      fittedCargoM3: 24000,
      fleetHangarM3: 40000,
      specialBays: [
        { name: 'Mining Hold', capacityM3: 187500, acceptedBuckets: ['ores', 'ice'] },
        { name: 'Ship Maintenance Bay', capacityM3: 400000, acceptedBuckets: ['ships'] },
      ],
      location: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      stationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
      systemName: 'Ishisomo',
      fittedModules: ['Damage Control II', 'Reinforced Bulkheads II'],
      fittedRigs: ['Large Transverse Bulkhead II', 'Large Transverse Bulkhead II'],
      isTanked: true,
      isCloaky: false,
      safeIskThreshold: 1_800_000_000,
      notes: 'Tanked Orca · 187.5k Mining Hold · 40k Fleet · 24k Bulkhead Cargo',
    },
    {
      id: 'hull-epithal',
      typeId: 655,
      shipTypeName: 'Epithal',
      customName: 'POCO Runner',
      name: 'POCO Runner (Epithal)',
      hullClass: 'pi_hauler',
      capacityM3: 67500,
      baseCargoM3: 550,
      fittedCargoM3: 688,
      specialBays: [
        { name: 'Planetary Commodities Hold', capacityM3: 67500, acceptedBuckets: ['pi'] },
      ],
      location: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      stationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
      systemName: 'Ishisomo',
      fittedModules: ['Damage Control II', 'Multispectrum Shield Hardener II'],
      fittedRigs: ['Medium Core Defense Field Extender I'],
      isTanked: true,
      isCloaky: false,
      safeIskThreshold: 100_000_000,
      notes: '67.5k Planetary Commodities Hold · Cap under 100M ISK',
    },
    {
      id: 'hull-kryos',
      typeId: 654,
      shipTypeName: 'Kryos',
      customName: 'Jita Mineral Shuttle',
      name: 'Jita Mineral Shuttle (Kryos)',
      hullClass: 'mineral_hauler',
      capacityM3: 75000,
      baseCargoM3: 550,
      fittedCargoM3: 688,
      specialBays: [
        { name: 'Mineral Hold', capacityM3: 75000, acceptedBuckets: ['minerals'] },
        { name: 'Ice Hold', capacityM3: 45000, acceptedBuckets: ['ice'] },
      ],
      location: EVE_ANCHORS.JITA_STATION_NAME,
      stationId: EVE_ANCHORS.JITA_STATION_ID,
      systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
      systemName: 'Jita',
      fittedModules: ['Damage Control II'],
      fittedRigs: [],
      isTanked: false,
      isCloaky: false,
      safeIskThreshold: 100_000_000,
      notes: 'Parked at Jita 4-4 · 75k Mineral Hold + 45k Ice Hold',
    },
    {
      id: 'hull-hoarder',
      typeId: 651,
      shipTypeName: 'Hoarder',
      customName: 'Ordnance Express',
      name: 'Ordnance Express (Hoarder)',
      hullClass: 'ammo_hauler',
      capacityM3: 61500,
      baseCargoM3: 500,
      fittedCargoM3: 625,
      specialBays: [
        { name: 'Ammo Hold', capacityM3: 61500, acceptedBuckets: ['ammo'] },
      ],
      location: EVE_ANCHORS.JITA_STATION_NAME,
      stationId: EVE_ANCHORS.JITA_STATION_ID,
      systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
      systemName: 'Jita',
      fittedModules: ['Damage Control II'],
      fittedRigs: [],
      isTanked: false,
      isCloaky: false,
      safeIskThreshold: 100_000_000,
      notes: 'Parked at Jita 4-4 · 61.5k Ammo Hold',
    },
    {
      id: 'hull-squall',
      typeId: 81008,
      shipTypeName: 'Squall',
      customName: 'Equinox Fuel Tender',
      name: 'Equinox Fuel Tender (Squall)',
      hullClass: 'upwell_hauler',
      capacityM3: 67500,
      baseCargoM3: 3000,
      fittedCargoM3: 3750,
      specialBays: [
        { name: 'Infrastructure Hold', capacityM3: 67500, acceptedBuckets: ['pi', 'infrastructure'] },
      ],
      location: EVE_ANCHORS.JITA_STATION_NAME,
      stationId: EVE_ANCHORS.JITA_STATION_ID,
      systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
      systemName: 'Jita',
      fittedModules: ['Damage Control II', 'Multispectrum Shield Hardener II'],
      fittedRigs: [],
      isTanked: true,
      isCloaky: false,
      safeIskThreshold: 150_000_000,
      notes: 'Parked at Jita 4-4 · 67.5k Upwell Infrastructure/PI Hold',
    },
  ],
  blueprints: [
    { itemId: 1001, typeId: 209, productTypeId: 209, productName: 'Scourge Heavy Missile', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'Propel Dynamics Factory' },
    { itemId: 1002, typeId: 2629, productTypeId: 2629, productName: 'Scourge Fury Heavy Missile', isBpo: false, me: 2, te: 4, runs: 80, locationName: 'State War Academy' },
    { itemId: 1003, typeId: 230, productTypeId: 230, productName: 'Antimatter Charge M', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'Propel Dynamics Factory' },
    { itemId: 1004, typeId: 12785, productTypeId: 12785, productName: 'Void M', isBpo: false, me: 2, te: 4, runs: 60, locationName: 'State War Academy' },
    { itemId: 1005, typeId: 2183, productTypeId: 2183, productName: 'Hammerhead I', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'Propel Dynamics Factory' },
    { itemId: 1006, typeId: 2185, productTypeId: 2185, productName: 'Hammerhead II', isBpo: false, me: 2, te: 4, runs: 40, locationName: 'State War Academy' },
    { itemId: 1007, typeId: 2454, productTypeId: 2454, productName: 'Hobgoblin I', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'Propel Dynamics Factory' },
    { itemId: 1008, typeId: 31788, productTypeId: 31788, productName: 'Medium Core Defense Field Extender I', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'State War Academy' },
    { itemId: 1009, typeId: 31716, productTypeId: 31716, productName: 'Small Core Defense Field Extender I', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'Propel Dynamics Factory' },
    { itemId: 1010, typeId: 4051, productTypeId: 4051, productName: 'Nitrogen Fuel Block', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'State War Academy' },
    { itemId: 1011, typeId: 672, productTypeId: 672, productName: 'Caldari Shuttle', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'State War Academy' },
    { itemId: 1012, typeId: 30013, productTypeId: 30013, productName: 'Core Scanner Probe I', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'State War Academy' },
    { itemId: 1013, typeId: 29001, productTypeId: 29001, productName: 'Tracking Speed Script', isBpo: true, me: 10, te: 20, runs: -1, locationName: 'State War Academy' },
  ],
  hangarStock: {
    34: { typeId: 34, jita: 1850000, ishisomo: 940000, total: 2790000 }, // Tritanium
    35: { typeId: 35, jita: 420000, ishisomo: 260000, total: 680000 }, // Pyerite
    36: { typeId: 36, jita: 95000, ishisomo: 48000, total: 143000 }, // Mexallon
    37: { typeId: 37, jita: 22000, ishisomo: 14500, total: 36500 }, // Isogen
    38: { typeId: 38, jita: 8500, ishisomo: 4200, total: 12700 }, // Nocxium
    39: { typeId: 39, jita: 2400, ishisomo: 1100, total: 3500 }, // Zydrine
    40: { typeId: 40, jita: 1100, ishisomo: 650, total: 1750 }, // Megacyte
    11399: { typeId: 11399, jita: 620, ishisomo: 380, total: 1000 }, // Morphite
    20410: { typeId: 20410, jita: 45, ishisomo: 30, total: 75 }, // Datacore - Rocket Science
    20411: { typeId: 20411, jita: 40, ishisomo: 25, total: 65 }, // Datacore - High Energy Physics
  },
  industryJobs: [
    {
      jobId: 900101,
      activityId: 1,
      activityLabel: 'Manufacturing',
      blueprintId: 1002,
      blueprintTypeId: 2629,
      blueprintName: 'Scourge Fury Heavy Missile Blueprint',
      productTypeId: 2629,
      productName: 'Scourge Fury Heavy Missile',
      runs: 40,
      cost: 2_840_000,
      facilityId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      facilityName: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      status: 'active',
      startDate: new Date(Date.now() - 2 * 3600_000).toISOString(),
      endDate: new Date(Date.now() + 3.4 * 3600_000).toISOString(),
    },
    {
      jobId: 900102,
      activityId: 1,
      activityLabel: 'Manufacturing',
      blueprintId: 1006,
      blueprintTypeId: 2185,
      blueprintName: 'Hammerhead II Blueprint',
      productTypeId: 2185,
      productName: 'Hammerhead II',
      runs: 20,
      cost: 1_920_000,
      facilityId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      facilityName: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
      status: 'active',
      startDate: new Date(Date.now() - 4 * 3600_000).toISOString(),
      endDate: new Date(Date.now() + 1.25 * 3600_000).toISOString(),
    },
    {
      jobId: 900103,
      activityId: 8,
      activityLabel: 'Invention',
      blueprintId: 1003,
      blueprintTypeId: 230,
      blueprintName: 'Antimatter Charge M Blueprint',
      productTypeId: 12785,
      productName: 'Void M',
      runs: 10,
      cost: 410_000,
      facilityId: EVE_ANCHORS.ISHISOMO_RES_STATION_ID,
      facilityName: EVE_ANCHORS.ISHISOMO_RES_STATION_NAME,
      status: 'active',
      startDate: new Date(Date.now() - 1.5 * 3600_000).toISOString(),
      endDate: new Date(Date.now() + 0.45 * 3600_000).toISOString(),
    },
  ],
};
