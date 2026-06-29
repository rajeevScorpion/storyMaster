import 'server-only';

export async function postOpenAiCompatibleImageForXai(input: {
  apiKey: string | undefined;
  body: Record<string, unknown>;
}): Promise<string> {
  if (!input.apiKey) {
    throw new Error('Missing API key for xAI image generation.');
  }

  const response = await fetch('https://api.x.ai/v1/images/generations', {
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
  };
  const first = json.data?.[0];
  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error('xAI returned an image URL that could not be fetched.');
    }
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  throw new Error('xAI did not return image data.');
}
