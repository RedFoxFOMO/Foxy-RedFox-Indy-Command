// Browser-native OAuth2 PKCE helpers for EVE Online SSO (login.eveonline.com)

export const EVE_SSO_SCOPES = [
  'esi-characters.read_blueprints.v1',
  'esi-corporations.read_blueprints.v1',
  'esi-skills.read_skills.v1',
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-wallet.read_character_wallet.v1',
  'esi-markets.read_character_orders.v1',
  'esi-assets.read_assets.v1',
  'esi-ui.write_waypoint.v1',
  'esi-ui.open_window.v1',
];

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, 96);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateStateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function buildEveAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
}): Promise<{ authUrl: string; codeVerifier: string; state: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateStateToken();

  const qs = new URLSearchParams({
    response_type: 'code',
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    scope: EVE_SSO_SCOPES.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    authUrl: `https://login.eveonline.com/v2/oauth/authorize/?${qs.toString()}`,
    codeVerifier,
    state,
  };
}
