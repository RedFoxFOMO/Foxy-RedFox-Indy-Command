// Browser storage helpers for zero-terminal "Bring Your Own Keys" setup.
// Environment variables always take precedence over localStorage fallbacks.

export const CUSTOM_EVE_CLIENT_ID_KEY = 'foxy_custom_eve_client_id';
export const CUSTOM_GEMINI_KEY_KEY = 'foxy_custom_gemini_key';
const LEGACY_EVE_CLIENT_ID_KEY = 'new_eden_eve_client_id';

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
