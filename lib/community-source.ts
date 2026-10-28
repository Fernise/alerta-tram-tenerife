export function publicSourceToken(reporterHash: unknown) {
  if (typeof reporterHash !== 'string' || !/^[a-f0-9]{64}$/i.test(reporterHash)) return null;
  return `source_${reporterHash.slice(0, 16).toLowerCase()}`;
}
