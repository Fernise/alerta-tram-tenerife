import { env } from 'cloudflare:workers';

export function communityDb() {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error('Community database is unavailable');
  return database;
}
