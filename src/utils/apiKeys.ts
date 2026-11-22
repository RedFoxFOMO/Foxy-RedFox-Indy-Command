// Browser storage helpers for zero-terminal "Bring Your Own Keys" setup
// and unified v2.2.0 workspace settings, route lifecycle records, and overrides.

import type { AppSettingsV22, SavedRouteRecord } from '../types/eve.ts';

export const CUSTOM_EVE_CLIENT_ID_KEY = 'foxy_custom_eve_client_id';
export const CUSTOM_GEMINI_KEY_KEY = 'foxy_custom_gemini_key';
const LEGACY_EVE_CLIENT_ID_KEY = 'new_eden_eve_client_id';

export const AI_COMMENTARY_ENABLED_KEY = 'foxy_ai_commentary_enabled_v21';
export const AI_COMMENTARY_PROVIDER_KEY = 'foxy_ai_commentary_provider_v21';
export const CUSTOM_OPENAI_KEY_KEY = 'foxy_custom_openai_key_v21';

export const APP_SETTINGS_V22_KEY = 'foxy_app_settings_v22';
export const SAVED_ROUTES_V22_KEY = 'foxy_saved_routes_v22';
export const CARD_TRANSPORT_MAP_V22_KEY = 'foxy_card_transport_v22';

export const DEFAULT_APP_SETTINGS_V22: AppSettingsV22 = {
  tooltipsEnabled: true,
  priceTrendPeriod: '7d',
  discordWebhookUrl: '',
  sharePasteUrl: '',
  maintainerContactName: 'Reccemaster',
  maintainerCorpName: 'RedFox Industrial Command',
  manualJumpCadenceSec: 12,
  defaultRoutingPreference: 'Safer',
  useCustomUpwellBroker: false,
  customUpwellBrokerPct: 1.0,
  includeSccSurcharge: true,
  refiningLocationRule: 'same_station',
  refiningMaxJumps: 2,
  refiningHubId: 'jita',
  refiningSellRule: 'same_as_refine',
  refiningSellMaxJumps: 2,
};

export function getCurrentCallbackUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

export function loadCustomEveClientId(): string {
  try {
    const primary = localStorage.getItem(CUSTOM_EVE_CLIENT_ID_KEY);
    if (primary && primary.trim()) return primary.trim();
    const legacy = localStorage.getItem(LEGACY_EVE_CLIENT_ID_KEY);
    if (legacy && legacy.trim()) {
      localStorage.setItem(CUSTOM_EVE_CLIENT_ID_KEY, legacy.trim());
      return legacy.trim();
    }
    return '';
  } catch {
    return '';
  }
}

export function saveCustomEveClientId(value: string): void {
  const trimmed = value.trim();
  try {
    if (trimmed) {
      localStorage.setItem(CUSTOM_EVE_CLIENT_ID_KEY, trimmed);
      localStorage.setItem(LEGACY_EVE_CLIENT_ID_KEY, trimmed);
    } else {
      localStorage.removeItem(CUSTOM_EVE_CLIENT_ID_KEY);
      localStorage.removeItem(LEGACY_EVE_CLIENT_ID_KEY);
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function loadCustomGeminiKey(): string {
  try {
    return (localStorage.getItem(CUSTOM_GEMINI_KEY_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveCustomGeminiKey(value: string): void {
  const trimmed = value.trim();
  try {
    if (trimmed) {
      localStorage.setItem(CUSTOM_GEMINI_KEY_KEY, trimmed);
    } else {
      localStorage.removeItem(CUSTOM_GEMINI_KEY_KEY);
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function loadAiCommentarySettings(): {
  enabled: boolean;
  provider: 'gemini' | 'openai';
  geminiKey: string;
  openaiKey: string;
} {
  try {
    const enabled = localStorage.getItem(AI_COMMENTARY_ENABLED_KEY) === 'true';
    const rawProv = localStorage.getItem(AI_COMMENTARY_PROVIDER_KEY);
    const provider: 'gemini' | 'openai' = rawProv === 'openai' ? 'openai' : 'gemini';
    const geminiKey = loadCustomGeminiKey();
    const openaiKey = (localStorage.getItem(CUSTOM_OPENAI_KEY_KEY) || '').trim();
    return { enabled, provider, geminiKey, openaiKey };
  } catch {
    return { enabled: false, provider: 'gemini', geminiKey: '', openaiKey: '' };
  }
}

export function saveAiCommentarySettings(settings: {
  enabled: boolean;
  provider: 'gemini' | 'openai';
  geminiKey: string;
  openaiKey: string;
}): void {
  try {
    localStorage.setItem(AI_COMMENTARY_ENABLED_KEY, String(settings.enabled));
    localStorage.setItem(AI_COMMENTARY_PROVIDER_KEY, settings.provider);
    saveCustomGeminiKey(settings.geminiKey);
    const trimmedOpenAi = settings.openaiKey.trim();
    if (trimmedOpenAi) {
      localStorage.setItem(CUSTOM_OPENAI_KEY_KEY, trimmedOpenAi);
    } else {
      localStorage.removeItem(CUSTOM_OPENAI_KEY_KEY);
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function loadAppSettingsV22(): AppSettingsV22 {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_V22_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS_V22 };
    const parsed = JSON.parse(raw) as Partial<AppSettingsV22>;
    return {
      ...DEFAULT_APP_SETTINGS_V22,
      ...parsed,
      manualJumpCadenceSec: Math.max(
        3,
        Math.min(120, Number(parsed.manualJumpCadenceSec ?? DEFAULT_APP_SETTINGS_V22.manualJumpCadenceSec))
      ),
      refiningMaxJumps: Math.max(
        0,
        Math.min(20, Number(parsed.refiningMaxJumps ?? DEFAULT_APP_SETTINGS_V22.refiningMaxJumps))
      ),
      refiningSellMaxJumps: Math.max(
        0,
        Math.min(20, Number(parsed.refiningSellMaxJumps ?? DEFAULT_APP_SETTINGS_V22.refiningSellMaxJumps))
      ),
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS_V22 };
  }
}

export function saveAppSettingsV22(next: AppSettingsV22): void {
  try {
    localStorage.setItem(APP_SETTINGS_V22_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedRoutesV22(): SavedRouteRecord[] {
  try {
    const raw = localStorage.getItem(SAVED_ROUTES_V22_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedRouteRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedRoutesV22(routes: SavedRouteRecord[]): void {
  try {
    localStorage.setItem(SAVED_ROUTES_V22_KEY, JSON.stringify(routes.slice(0, 60)));
  } catch {
    // Ignore
  }
}

export interface CardTransportEntry {
  transportIsk: number;
  minDesiredProfitIsk: number;
}

export function loadCardTransportMap(): Record<string, CardTransportEntry> {
  try {
    const raw = localStorage.getItem(CARD_TRANSPORT_MAP_V22_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CardTransportEntry | number>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, CardTransportEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') {
        out[k] = { transportIsk: Math.max(0, v), minDesiredProfitIsk: 0 };
      } else if (v && typeof v === 'object') {
        out[k] = {
          transportIsk: Math.max(0, Number(v.transportIsk) || 0),
          minDesiredProfitIsk: Math.max(0, Number(v.minDesiredProfitIsk) || 0),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCardTransportMap(map: Record<string, CardTransportEntry>): void {
  try {
    localStorage.setItem(CARD_TRANSPORT_MAP_V22_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}
