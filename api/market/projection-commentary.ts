import { GoogleGenAI } from '@google/genai';
import type { PriceProjectionAnalysis } from '../../src/types/eve.ts';

interface ServerlessReq {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  json(payload: unknown): void;
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string {
  if (!headers) return '';
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return String(val || '').trim();
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const geminiKey = getHeader(req.headers, 'x-gemini-api-key');
    const openAiKey = getHeader(req.headers, 'x-openai-api-key');
    const body =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as { analysis?: PriceProjectionAnalysis })
        : ((req.body ?? {}) as { analysis?: PriceProjectionAnalysis });
    const analysis = body.analysis;

    if (!analysis || typeof analysis.itemName !== 'string') {
      res.status(400).json({ error: 'Valid quantitative market analysis payload is required.' });
      return;
    }

    // Strict BYOK guarantee: NEVER fall back to developer env keys
    if (!geminiKey && !openAiKey) {
      res.status(400).json({
        error:
          'No personal API key provided. Enter your own Gemini or OpenAI API key in Settings to enable optional AI commentary.',
      });
      return;
    }

    const prompt = [
      'You are an EVE Online industrial & market analyst. Give a crisp, tactical 4-bullet commentary (max 140 words total) based ONLY on these real ESI statistics. No financial hype, no markdown headers.',
      `Item: ${analysis.itemName} (Type #${analysis.typeId}) in ${analysis.regionName}`,
      `Current Price: ${analysis.currentAvgPrice.toFixed(2)} ISK | Yesterday Avg: ${analysis.yesterdayAvgPrice.toFixed(2)} ISK (${analysis.change24hPct.toFixed(2)}%)`,
      `7d MA: ${analysis.ma7d.toFixed(2)} ISK | 30d MA: ${analysis.ma30d.toFixed(2)} ISK | Momentum: ${analysis.momentum7dPct.toFixed(2)}% | 30d Volatility: ${analysis.volatilityPct.toFixed(1)}%`,
      `Volume Spike Ratio (7d/30d): ${analysis.volumeSpikeRatio.toFixed(2)}x | Thin/Manipulation Risk: ${analysis.manipulationRisk} (${analysis.manipulationNotes.join('; ') || 'none'})`,
      `Statistical 7d Range: ${analysis.projected7dLow.toFixed(2)} - ${analysis.projected7dHigh.toFixed(2)} ISK (Signal: ${analysis.signal})`,
    ].join('\n');

    if (geminiKey) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
      });
      res.status(200).json({
        provider: 'gemini',
        commentary: (response.text || '').trim() || 'No commentary generated.',
      });
      return;
    }

    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: 'You are a concise EVE Online market analyst. Respond in 4 short tactical bullet points.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!oaiRes.ok) {
      res.status(oaiRes.status).json({
        error: `OpenAI API returned HTTP ${oaiRes.status}. Verify your personal OpenAI API key in Settings.`,
      });
      return;
    }

    const oaiJson = (await oaiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    res.status(200).json({
      provider: 'openai',
      commentary: oaiJson.choices?.[0]?.message?.content?.trim() || 'No commentary generated.',
    });
  } catch {
    res.status(502).json({
      error: 'Unable to generate BYOK AI commentary. Verify your personal API key in Settings.',
    });
  }
}
