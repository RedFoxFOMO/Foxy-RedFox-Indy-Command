// Vercel Serverless Handler: Gank Tab Pilot Intel (Unversioned ESI + zKillboard)

interface ServerlessReq {
  method?: string;
  body?: unknown;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

const ESI_HEADERS = {
  Accept: 'application/json',
  'X-Compatibility-Date': '2026-08-18',
  'User-Agent':
    'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)',
};

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
    const characterName = String(parsed.characterName || '').trim();
    if (!characterName || characterName.length < 2 || characterName.length > 64) {
      res.status(400).json({ error: 'Provide a valid EVE character name (2-64 characters).' });
      return;
    }

    const idRes = await fetch('https://esi.evetech.net/universe/ids/?datasource=tranquility', {
      method: 'POST',
      headers: { ...ESI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify([characterName]),
    });
    if (!idRes.ok) {
      res.status(502).json({ error: 'EVE ESI character lookup unavailable.' });
      return;
    }

    const idJson = (await idRes.json()) as { characters?: { id: number; name: string }[] };
    const found = idJson.characters?.[0];
    if (!found) {
      res.status(404).json({ error: `No EVE capsuleer found matching "${characterName}".` });
      return;
    }

    const [charRes, zkillRes] = await Promise.all([
      fetch(`https://esi.evetech.net/characters/${found.id}/?datasource=tranquility`, { headers: ESI_HEADERS }),
      fetch(`https://zkillboard.com/api/stats/characterID/${found.id}/`, {
        headers: { Accept: 'application/json', 'User-Agent': ESI_HEADERS['User-Agent'] },
      }).catch(() => null),
    ]);

    let securityStatus = 0;
    if (charRes.ok) {
      const charInfo = (await charRes.json()) as { security_status?: number };
      securityStatus = Number((charInfo.security_status ?? 0).toFixed(2));
    }

    let shipsDestroyed = 0;
    let shipsLost = 0;
    let dangerRatio = 50;
    let gangRatio = 50;
    let source: 'zkill_live' | 'esi_only' = 'esi_only';

    if (zkillRes && zkillRes.ok) {
      const zk = (await zkillRes.json()) as {
        shipsDestroyed?: number;
        shipsLost?: number;
        dangerRatio?: number;
        gangRatio?: number;
      };
      shipsDestroyed = Number(zk.shipsDestroyed ?? 0);
      shipsLost = Number(zk.shipsLost ?? 0);
      dangerRatio = Number(zk.dangerRatio ?? 50);
      gangRatio = Number(zk.gangRatio ?? 50);
      source = 'zkill_live';
    }

    const posture: 'ganker_threat' | 'victim_target' | 'mixed_unknown' =
      securityStatus <= -2.0 || (source === 'zkill_live' && dangerRatio >= 65 && shipsDestroyed >= 15)
        ? 'ganker_threat'
        : source === 'zkill_live' && dangerRatio <= 30 && shipsLost >= 3
          ? 'victim_target'
          : 'mixed_unknown';

    res.status(200).json({
      characterId: found.id,
      characterName: found.name,
      corporationName: 'EVE Capsuleer',
      securityStatus,
      posture,
      shipsDestroyed,
      shipsLost,
      dangerRatio,
      gangRatio,
      source,
      summary:
        posture === 'ganker_threat'
          ? `High threat posture (${dangerRatio}% danger, sec ${securityStatus.toFixed(1)}).`
          : posture === 'victim_target'
            ? `Low combat danger (${dangerRatio}% danger, ${shipsLost} losses).`
            : `Mixed killboard profile (${shipsDestroyed} kills / ${shipsLost} losses).`,
    });
  } catch {
    res.status(500).json({ error: 'Unable to retrieve pilot intel.' });
  }
}
