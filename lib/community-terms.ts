export const COMMUNITY_TERMS_VERSION = '2026-09-03';

export function acceptsCurrentCommunityTerms(request: Request) {
  return request.headers.get('x-alerta-community-terms') === COMMUNITY_TERMS_VERSION;
}
