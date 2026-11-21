import { GoogleGenAI } from '@google/genai';

interface ServerlessReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawEnvKey = (process.env.GEMINI_API_KEY || '').trim();
    const envApiKey = rawEnvKey && rawEnvKey !== 'MY_GEMINI_API_KEY' ? rawEnvKey : '';
    const headerRaw = req.headers['x-gemini-api-key'];
    const headerVal = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw || '';
    const customApiKey =
      headerVal.trim().length > 0 &&
      headerVal.trim().length <= 256 &&
      /^[\x21-\x7E]+$/.test(headerVal.trim())
        ? headerVal.trim()
        : '';

    const apiKey = envApiKey || customApiKey;
    if (!apiKey) {
      res.status(400).json({
        error:
          'No Gemini API key is configured. Open "API Setup" in the top bar to enter your optional Gemini API key, or continue using all live EVE market/industry tools without AI.',
      });
      return;
    }

    const parsed =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : ((req.body ?? {}) as Record<string, unknown>);

    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages as { role: 'user' | 'assistant'; content: string }[])
      : [];
    if (messages.length === 0) {
      res.status(400).json({ error: 'Message history is required.' });
      return;
    }

    const stateJson = JSON.stringify(parsed.appStateSummary ?? {}, null, 2);
    const ai = new GoogleGenAI({ apiKey });

    const contents = messages.slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents,
      config: {
        systemInstruction: [
          'You are the Strategic Advisor & Logistics Quartermaster for "Foxy RedFox Indy Command", an EVE Online industrialist and 5-hub Empire trade strategist.',
          'Use the live dashboard JSON below to give concise, numbered execution steps with exact stations, ISK capital, cargo m3, and after-tax profit.',
          stateJson,
        ].join('\n'),
      },
    });

    res.status(200).json({
      text: response.text || 'Unable to generate strategic briefing.',
      toolsUsed: [],
      actions: [],
      model: 'gemini-3.1-flash-lite',
    });
  } catch (err) {
    console.error('Vercel advisor chat error:', err);
    res.status(500).json({ error: 'Strategic Advisor request failed.' });
  }
}
