// Identity headers are injected by the Sites dispatcher, not by client controls.
export function isOwner(request: Request) {
  const configuredId = process.env.MODERATION_OWNER_USER_ID?.trim();
  const suppliedId = request.headers.get('oai-authenticated-user-id')?.trim();
  const configuredEmail = process.env.MODERATION_OWNER_EMAIL?.trim().toLowerCase();
  const suppliedEmail = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return Boolean(
    (configuredId && suppliedId && configuredId === suppliedId)
    || (configuredEmail && suppliedEmail && configuredEmail === suppliedEmail),
  );
}
