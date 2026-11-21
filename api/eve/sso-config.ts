interface ServerlessReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

export default function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  const protoHeader = Array.isArray(req.headers['x-forwarded-proto'])
    ? req.headers['x-forwarded-proto'][0]
    : req.headers['x-forwarded-proto'];
  const proto = protoHeader || 'https';

  const baseUrl = (process.env.APP_URL || (hostHeader ? `${proto}://${hostHeader}` : '')).replace(
    /\/+$/,
    ''
  );
  const envEveClientId = (process.env.EVE_CLIENT_ID || '').trim();
  const envGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const hasEnvGeminiKey = Boolean(envGeminiKey && envGeminiKey !== 'MY_GEMINI_API_KEY');

  res.status(200).json({
    callbackUrl: baseUrl ? `${baseUrl}/` : '/',
    serverClientId: envEveClientId,
    hasEnvEveClientId: Boolean(envEveClientId),
    hasEnvGeminiKey,
  });
}
