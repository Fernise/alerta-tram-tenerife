import { communityDb } from '@/lib/community-db';
import { FeedbackError, submitFeedback } from '@/lib/beta-feedback';

export async function POST(request: Request) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
  try { return Response.json(await submitFeedback(communityDb(), request), { status: 201, headers }); }
  catch (error) {
    const status = error instanceof FeedbackError ? error.status : 503;
    if (status === 429) headers['Retry-After'] = '300';
    return Response.json({ error: error instanceof FeedbackError ? error.code : 'feedback_unavailable' }, { status, headers });
  }
}
