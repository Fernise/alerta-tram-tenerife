export const FEEDBACK_CATEGORIES = ['bug', 'data', 'language', 'suggestion'] as const;
export const FEEDBACK_PLATFORMS = ['unspecified', 'ios', 'android', 'desktop', 'other'] as const;
export const FEEDBACK_COOLDOWN = 5 * 60 * 1000;
export const FEEDBACK_RETENTION = 90 * 24 * 60 * 60 * 1000;
export const FEEDBACK_INSERT = `INSERT INTO beta_feedback
  (id, category, message, platform, language, device_hash, created_at)
  SELECT ?, ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM beta_feedback WHERE device_hash = ? AND created_at > ?)
    AND (SELECT COUNT(*) FROM beta_feedback WHERE device_hash = ? AND created_at > ?) < 10
    AND (SELECT COUNT(*) FROM beta_feedback) < 10000
  ON CONFLICT(id) DO NOTHING`;

export class FeedbackError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

export async function readSmallJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new FeedbackError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError(400, 'invalid_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new FeedbackError(413, 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FeedbackError(400, 'invalid_body'); }
}

export function parseFeedback(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeedbackError(400, 'invalid_feedback');
  const body = value as Record<string, unknown>;
  const { id, category, platform, language } = body;
  const message = typeof body.message === 'string' ? body.message.trim().normalize('NFC') : '';
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
    || !FEEDBACK_CATEGORIES.includes(category as typeof FEEDBACK_CATEGORIES[number])
    || !FEEDBACK_PLATFORMS.includes(platform as typeof FEEDBACK_PLATFORMS[number])
    || !['es', 'en'].includes(language as string)
    || message.length < 15 || message.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) {
    throw new FeedbackError(400, 'invalid_feedback');
  }
  if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(message)) throw new FeedbackError(400, 'no_contact_details');
  return { id, category: category as string, platform: platform as string, language: language as string, message };
}

export async function submitFeedback(database: D1Database, request: Request, now = Date.now()) {
  if (!sameOrigin(request)) throw new FeedbackError(403, 'invalid_origin');
  const device = request.headers.get('x-alerta-device') || '';
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(device)) throw new FeedbackError(400, 'invalid_device');
  const input = parseFeedback(await readSmallJson(request));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`alerta-tram-beta:${device}`));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  // Serialized D1 writes enforce the cooldown and daily cap within the insert,
  // including simultaneous requests. Device IDs are resettable, not human identity.
  const results = await database.batch([
    database.prepare('DELETE FROM beta_feedback WHERE created_at <= ?').bind(now - FEEDBACK_RETENTION),
    database.prepare(FEEDBACK_INSERT).bind(input.id, input.category, input.message, input.platform, input.language, hash, now,
      hash, now - FEEDBACK_COOLDOWN, hash, now - 24 * 60 * 60 * 1000),
  ]);
  if (results.some((result) => !result.success)) throw new FeedbackError(503, 'feedback_unavailable');
  if (!results[1].meta.changes) {
    const existing = await database.prepare(`SELECT category, message, platform, language FROM beta_feedback WHERE id = ? AND device_hash = ?`)
      .bind(input.id, hash).first<{ category: string; message: string; platform: string; language: string }>();
    // An ambiguous network failure can be retried without creating a second row.
    if (!existing || existing.category !== input.category || existing.message !== input.message || existing.platform !== input.platform || existing.language !== input.language) {
      throw new FeedbackError(429, 'feedback_limit');
    }
  }
  return { received: true, reference: input.id };
}
