const AI_ENABLED = process.env.GEMINI_API_KEY !== undefined && !process.argv.includes('--no-ai');

const GEMINI_URL =
  'https://generativelanguage.googleapis.com' +
  '/v1beta/models/gemini-pro:generateContent?key=';

export async function askGemini(context: string[], query: string): Promise<string> {
  if (!AI_ENABLED) {
    return '[Mode hors-ligne : IA indisponible]';
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '[Mode hors-ligne : IA indisponible]';
    }

    const prompt = ['Contexte Archipel:', ...context, '', 'Question:', query].join('\n');
    const response = await fetch(`${GEMINI_URL}${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    if (!response.ok) {
      return `[IA indisponible: HTTP ${response.status}]`;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text && text.length > 0 ? text : '[IA indisponible: reponse vide]';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[IA indisponible: ${message}]`;
  }
}

export function isAiEnabled(): boolean {
  return AI_ENABLED;
}
