// Vercel Serverless Handler: Public Regional Contracts Proxy (2026 ESI Compliant)

interface ServerlessReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  setHeader?(name: string, value: string): void;
  json(payload: unknown): void;
}

const ESI_HEADERS = {
  Accept: 'application/json',
  'X-Compatibility-Date': '2026-08-18',
  'User-Agent':
    'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)',
};

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawRegion = Number(Array.isArray(req.query?.regionId) ? req.query?.regionId[0] : req.query?.regionId || 10000002);
    const regionId = Number.isInteger(rawRegion) && rawRegion > 10_000_000 ? rawRegion : 10000002;
    const rawPage = Number(Array.isArray(req.query?.page) ? req.query?.page[0] : req.query?.page || 1);
    const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10 ? rawPage : 1;

    const r = await fetch(
      `https://esi.evetech.net/contracts/public/${regionId}?datasource=tranquility&page=${page}`,
      { headers: ESI_HEADERS }
    );
    if (!r.ok) {
      res.status(r.status).json({ error: `EVE ESI contracts returned HTTP ${r.status}` });
      return;
    }

    const list = (await r.json()) as Record<string, unknown>[];
    res.setHeader?.('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    res.status(200).json({
      regionId,
      page,
      contracts: Array.isArray(list) ? list.slice(0, 30) : [],
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    res.status(502).json({ error: 'Unable to fetch public contracts from EVE ESI.' });
  }
}
