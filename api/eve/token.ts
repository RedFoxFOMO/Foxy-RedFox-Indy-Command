interface ServerlessReq {
  method?: string;
  body?: unknown;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const parsed =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : ((req.body ?? {}) as Record<string, unknown>);

    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    const codeVerifier = typeof parsed.codeVerifier === 'string' ? parsed.codeVerifier.trim() : '';
    const customClientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    const envClientId = (process.env.EVE_CLIENT_ID || '').trim();
    const resolvedClientId = envClientId || customClientId;

    if (!code || !codeVerifier || !resolvedClientId) {
      res.status(400).json({ error: 'Missing authorization code, PKCE verifier, or EVE Client ID.' });
      return;
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: resolvedClientId,
      code_verifier: codeVerifier,
    });

    const tokenRes = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent':
          'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)',
      },
      body: form.toString(),
    });

    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok || !tokenJson.access_token) {
      res.status(tokenRes.status || 400).json({
        error: String(tokenJson.error_description || tokenJson.error || 'EVE SSO token exchange failed.'),
      });
      return;
    }

    const accessToken = String(tokenJson.access_token);
    const jwt = decodeJwtPayload(accessToken);
    const sub = String(jwt?.sub || '');
    const charIdMatch = sub.match(/CHARACTER:EVE:(\d+)/);
    const characterId = charIdMatch ? Number(charIdMatch[1]) : 0;
    const characterName = String(jwt?.name || 'EVE Capsuleer');

    res.status(200).json({
      accessToken,
      refreshToken: tokenJson.refresh_token ? String(tokenJson.refresh_token) : undefined,
      expiresIn: Number(tokenJson.expires_in || 1199),
      characterId,
      characterName,
    });
  } catch (err) {
    console.error('Vercel EVE token exchange error:', err);
    res.status(500).json({ error: 'Failed to contact EVE Online SSO token server.' });
  }
}
