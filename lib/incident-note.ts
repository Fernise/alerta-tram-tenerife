export const NOTE_MIN_LENGTH = 5;
export const NOTE_MAX_LENGTH = 160;
export type NoteIssue = 'length' | 'contact' | 'link' | 'personal_data' | 'abuse' | 'format';
export type NoteValidation = { ok: true; note: string } | { ok: false; issue: NoteIssue };

const messages: Record<'es' | 'en', Record<NoteIssue, string>> = {
  es: {
    length: 'Escribe entre 5 y 160 caracteres sobre lo que afecta al servicio.',
    contact: 'Retira teléfonos, correos y nombres de usuario. Describe solo la incidencia.',
    link: 'Retira los enlaces. Explica aquí lo que ocurre, sin enviar a otras páginas.',
    personal_data: 'Retira documentos, matrículas o datos bancarios. No identifiques a personas.',
    abuse: 'Reformula la nota sin insultos, amenazas ni llamadas a agredir. Describe el problema del servicio.',
    format: 'Usa texto sencillo, sin etiquetas ni caracteres de control.',
  },
  en: {
    length: 'Write 5–160 characters about what is affecting the service.',
    contact: 'Remove phone numbers, emails and usernames. Describe only the incident.',
    link: 'Remove links. Explain what is happening here, without directing people to other pages.',
    personal_data: 'Remove identity documents, number plates or bank details. Do not identify people.',
    abuse: 'Reword the note without insults, threats or calls for violence. Describe the service problem.',
    format: 'Use plain text without tags or control characters.',
  },
};

export function noteIssueMessage(issue: unknown, language: 'es' | 'en') {
  return typeof issue === 'string' && Object.hasOwn(messages[language], issue)
    ? messages[language][issue as NoteIssue] : messages[language].length;
}

// A deterministic guard for common patterns, NOT identity recognition or a
// complete abuse classifier. Names, descriptions, evasion and context still need
// the community flagging and owner-review flows. Never log rejected text.
export function validateIncidentNote(value: unknown): NoteValidation {
  if (typeof value !== 'string' || value.length > 4096) return { ok: false, issue: 'length' };
  const normalized = value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '');
  const note = normalized.trim().replace(/\s+/gu, ' ');
  if (note.length < NOTE_MIN_LENGTH || note.length > NOTE_MAX_LENGTH) return { ok: false, issue: 'length' };
  // Check before collapsing whitespace: unsupported controls must not disappear.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized) || /<\/?[a-z][^>]*>/iu.test(note)) {
    return { ok: false, issue: 'format' };
  }
  const folded = note.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/@\s*[\p{L}\p{N}_]/u.test(note)
    || /(?:^|[^\p{L}\p{N}])\+?\s*(?:\d[\s().-]*){8,14}\d(?![\p{L}\p{N}])/u.test(note)) {
    return { ok: false, issue: 'contact' };
  }
  if (/(?:https?|ftp):\s*\/\s*\/|\bwww\s*\.|\b(?:mailto|tel|javascript|data):/iu.test(note)
    // A dot followed by a space often starts a sentence ("avería. Es...").
    // Catch ordinary domains and deliberately spaced "example . es", not that.
    || /\b[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}-]+)*(?:\.|\s+\.\s*)(?:com|es|org|net|eu|io|app|dev|info|online|site|me|co|uk|de|fr|it|pt|ly|be|xyz)\b/iu.test(note)) {
    return { ok: false, issue: 'link' };
  }
  if (/\b(?:\d{8}[ -]?[a-z]|[xyz][ -]?\d{7}[ -]?[a-z])\b/iu.test(note)
    || /\bes\d{2}(?:[ -]?\d){20}\b/iu.test(note)
    || /\b\d{4}[ -]?[bcdfghjklmnprstvwxyz]{3}\b/iu.test(note)) {
    return { ok: false, issue: 'personal_data' };
  }
  // Keep a small, explicit rule set: do not reject reports of danger merely for
  // mentioning an assault or a threat (e.g. “hay una agresión; avisado el 112”).
  if (/\b(?:gilipollas|cabrones|hij[oa]s? de puta|pendej[oa]s?|assholes?|motherfuckers?)\b/u.test(folded)
    || /\b(?:hay que|vamos a)\s+(?:matar|pegar|agredir|atacar)\b/u.test(folded)
    || /\b(?:te voy a|voy a)\s+(?:matar|pegar|agredir)\b/u.test(folded)
    || /\b(?:maten|matad|pegad|ataquen)\s+(?:a\s+)?(?:los|las|les)\b/u.test(folded)
    || /\b(?:let['’]?s|we should|we must|i will|i['’]?ll)\s+(?:kill|attack|beat)\b/u.test(folded)) {
    return { ok: false, issue: 'abuse' };
  }
  return { ok: true, note };
}
