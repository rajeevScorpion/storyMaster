import 'server-only';

export async function postOpenAiCompatibleImageForXai(input: {
  apiKey: string | undefined;
  path?: '/images/generations' | '/images/edits';
  body: Record<string, unknown>;
}): Promise<{ dataUrl: string; usage?: Record<string, unknown> }> {
  if (!input.apiKey) {
    throw new Error('Missing API key for xAI image generation.');
  }

  const path = input.path ?? '/images/generations';
  const response = await fetch(`https://api.x.ai/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`xAI image generation failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json = await response.json() as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
    usage?: Record<string, unknown>;
  };
  const first = json.data?.[0];
  if (first?.b64_json) {
    return {
      dataUrl: `data:image/png;base64,${first.b64_json}`,
      usage: json.usage,
    };
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error('xAI returned an image URL that could not be fetched.');
    }
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return {
      dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      usage: json.usage,
    };
  }

  throw new Error('xAI did not return image data.');
}
