// Bound untrusted request bodies before parsing. No rejected content is logged
// or echoed. Kept separate from the browser-shared note filter.
export class CommunityRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export async function readCommunityText(request: Request, maxBytes = 4096): Promise<string> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new CommunityRequestError(415, 'json_required');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CommunityRequestError(400, 'invalid_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new CommunityRequestError(413, 'body_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new CommunityRequestError(400, 'invalid_body'); }
}

export async function readCommunityJson(request: Request, maxBytes = 4096): Promise<unknown> {
  const body = await readCommunityText(request, maxBytes);
  try { return JSON.parse(body); }
  catch { throw new CommunityRequestError(400, 'invalid_body'); }
}
