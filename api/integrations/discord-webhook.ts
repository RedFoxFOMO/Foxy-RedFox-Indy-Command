// Vercel Serverless Handler: SSRF-Hardened Discord Webhook Proxy

interface ServerlessReq {
  method?: string;
  body?: unknown;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

const ALLOWED_DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]);

function validateDiscordWebhookUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_DISCORD_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) return null;
    return parsed;
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

    const validUrl = validateDiscordWebhookUrl(String(parsed.webhookUrl || ''));
    if (!validUrl) {
      res.status(400).json({
        error:
          'Invalid Discord Webhook URL. Must be an HTTPS URL matching https://discord.com/api/webhooks/<id>/<token>.',
      });
      return;
    }

    const content = String(parsed.content || '').slice(0, 1900);
    const embeds = Array.isArray(parsed.embeds) ? parsed.embeds.slice(0, 4) : undefined;
    if (!content && (!embeds || embeds.length === 0)) {
      res.status(400).json({ error: 'Message content or embed payload is required.' });
      return;
    }

    const hookRes = await fetch(validUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Foxy-RedFox-Indy-Command/2.2.1 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)',
      },
      body: JSON.stringify({
        username: 'Foxy RedFox Indy Command v2.2.1',
        ...(content ? { content } : {}),
        ...(embeds && embeds.length > 0 ? { embeds } : {}),
      }),
    });

    if (!hookRes.ok) {
      res.status(hookRes.status).json({ error: `Discord Webhook returned HTTP ${hookRes.status}.` });
      return;
    }

    res.status(200).json({ ok: true, sentAt: new Date().toISOString() });
  } catch {
    res.status(502).json({ error: 'Unable to reach Discord webhook endpoint.' });
  }
}
