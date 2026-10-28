import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noteIssueMessage, validateIncidentNote } from '../lib/incident-note.ts';
import { readCommunityJson, readCommunityText } from '../lib/community-request.ts';

const allowed = [
  'Máquina expendedora fuera de servicio.',
  'Ticket machine is out of service.',
  'Servicio 1004, unos 15 min de retraso.',
  'Horario de 06:30 a 23:00; espera de 10–15 min.',
  'La parada está al 90% y no cabe una silla de ruedas.',
  'Hay una agresión; hemos avisado al personal y al 112.',
  'Someone reported a threat. Staff contacted; call 112 in an emergency.',
  'Vagón 2, puerta 3, del servicio 1012.',
  'Salida en < 5 minutos, según el panel.',
  'No funcionan 2 máquinas. La tercera sí funciona.',
  'El tranvía pasa pero no para en esta estación.',
];
test('ordinary ES/EN service notes, times, identifiers and danger reports remain allowed', () => {
  for (const note of allowed) assert.equal(validateIncidentNote(note).ok, true, note);
});
test('whitespace and compatibility forms are normalized; boundaries are enforced', () => {
  assert.deepEqual(validateIncidentNote('  Puerta\n\t３ bloqueada.  '), { ok: true, note: 'Puerta 3 bloqueada.' });
  for (const input of [undefined, null, {}, [], '', '    ', 'a'.repeat(4), 'a'.repeat(161), 'a'.repeat(4097)]) {
    assert.deepEqual(validateIncidentNote(input), { ok: false, issue: 'length' });
  }
  for (const n of [5, 160]) assert.equal(validateIncidentNote('a'.repeat(n)).ok, true);
});
test('common phone/email/social patterns are rejected, including compatibility and invisible characters', () => {
  for (const note of [
    'Llámame al 555000000.', 'Número +34 555 00 00 00.', 'Call +49 (151) 00000000.',
    'Contacto: test@example.invalid', 'Mensaje a @cuenta_de_prueba.',
    'Contacto test＠example.invalid', 'Teléfono ５５５００００００.',
    'Correo te\u200bst@example.invalid.', 'Número 555\u200b000000.',
  ]) assert.deepEqual(validateIncidentNote(note), { ok: false, issue: 'contact' }, note);
});
test('links with and without a scheme are rejected without treating normal punctuation as a domain', () => {
  for (const note of ['Ver https://example.invalid', 'Ver www.example.invalid', 'Mira example.com.', 'Mira example . es.',
    'Read example.org/info', 'Información https：／／example.invalid', 'Visita ht\u200btps://example.invalid',
    'Abre javascript:alert(1)', 'Sitio https: //example.invalid']) {
    assert.deepEqual(validateIncidentNote(note), { ok: false, issue: 'link' }, note);
  }
  assert.equal(validateIncidentNote('A las 10.30 hay retrasos. Es una avería.').ok, true);
  assert.equal(validateIncidentNote('Check the app. It shows no trams.').ok, true);
});
test('common Spanish identity, plate and bank patterns are blocked', () => {
  for (const note of ['Documento 00000000T.', 'Documento X0000000T.', 'Documento Y-0000000-T.', 'Matrícula 0000 BBB.']) {
    assert.deepEqual(validateIncidentNote(note), { ok: false, issue: 'personal_data' }, note);
  }
  assert.equal(validateIncidentNote('Cuenta ES0000000000000000000000').ok, false);
});
test('explicit insults and calls for violence are rejected without matching substrings', () => {
  for (const note of ['Son unos GILIPOLLAS.', 'Son unos gili\u200bpollas.', 'Hay que agredir al personal.',
    'Vamos a matar a los viajeros.', "Let's attack the staff.", 'We should beat the staff.', 'I will kill you.']) {
    assert.deepEqual(validateIncidentNote(note), { ok: false, issue: 'abuse' }, note);
  }
  assert.equal(validateIncidentNote('La pasarela de acceso está cerrada.').ok, true);
});
test('markup and controls are rejected, plain Unicode text remains text', () => {
  for (const note of ['Problema <script>alert(1)</script>', 'Puerta\u0000 bloqueada', 'Puerta\u0085 bloqueada']) {
    assert.deepEqual(validateIncidentNote(note), { ok: false, issue: 'format' });
  }
  assert.equal(validateIncidentNote('Puerta bloqueada ⚠️, avisado el personal.').ok, true);
});
test('every rejection has specific ES/EN copy; unknown server reasons do not become UI text', () => {
  for (const issue of ['length', 'contact', 'link', 'personal_data', 'abuse', 'format']) {
    assert.ok(noteIssueMessage(issue, 'es').length > 20);
    assert.ok(noteIssueMessage(issue, 'en').length > 20);
    assert.notEqual(noteIssueMessage(issue, 'es'), noteIssueMessage(issue, 'en'));
  }
  assert.equal(noteIssueMessage('__proto__', 'es'), noteIssueMessage('length', 'es'));
  assert.equal(noteIssueMessage('<script>', 'en'), noteIssueMessage('length', 'en'));
});

const request = (body, headers = {}) => new Request('https://example.test/api/reports', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
});
test('bounded body parsing handles malformed JSON, invalid UTF-8, null and content types', async () => {
  assert.deepEqual(await readCommunityJson(request('{"note":"Puerta bloqueada"}')), { note: 'Puerta bloqueada' });
  assert.equal(await readCommunityJson(request('null')), null); // Action/input validators reject it.
  for (const body of ['{', new Uint8Array([0xff, 0xfe])]) await assert.rejects(readCommunityJson(request(body)), (e) => e.status === 400 && !e.message.includes('Puerta'));
  await assert.rejects(readCommunityJson(request('{}', { 'Content-Type': 'text/plain' })), (e) => e.status === 415);
  await assert.rejects(readCommunityJson(request('{}', { 'Content-Type': 'application/jsonp' })), (e) => e.status === 415);
  assert.deepEqual(await readCommunityJson(request('{}', { 'Content-Type': 'Application/JSON; charset=utf-8' })), {});
});
test('actual byte limit rejects oversized chunks even with missing or false Content-Length', async () => {
  for (const headers of [{}, { 'Content-Length': '2' }]) await assert.rejects(readCommunityJson(request(' '.repeat(4097), headers)), (e) => e.status === 413);
  await assert.rejects(readCommunityJson(request(JSON.stringify({ note: 'é'.repeat(2200) }))), (e) => e.status === 413);
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2049)); }, cancel() { cancelled = true; } });
  await assert.rejects(readCommunityJson(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' })), (e) => e.status === 413);
  assert.equal(cancelled, true);
});
test('bounded text supports push limits and never trusts declared length', async () => {
  assert.equal(await readCommunityText(request(' '.repeat(8192)), 8192), ' '.repeat(8192));
  await assert.rejects(readCommunityText(request(' '.repeat(8193), { 'Content-Length': '2' }), 8192), (e) => e.status === 413);
  await assert.rejects(readCommunityText(request(new Uint8Array([0xff]))), (e) => e.status === 400);
  await assert.rejects(readCommunityText(request('{}', { 'Content-Type': 'application/jsonp' })), (e) => e.status === 415);
});
test('all externally writable API routes bound bodies before parsing', () => {
  for (const path of [
    '../app/api/metrics/route.ts',
    '../app/api/reports/flags/route.ts',
    '../app/api/moderation/reports/route.ts',
    '../app/api/push/subscriptions/route.ts',
    '../app/api/push/test/route.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /readCommunity(?:Json|Text)\(request/);
    assert.doesNotMatch(source, /request\.(?:json|text)\(\)/);
  }
});
test('browser and server share the validator; API checks note before database access; errors stay inline', () => {
  const route = readFileSync(new URL('../app/api/reports/route.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /validateIncidentNote\(body\.note\)/);
  assert.match(page, /validateIncidentNote\(draftIncidentNote\)/);
  const post = route.slice(route.indexOf('export async function POST'));
  assert.ok(post.indexOf('validReportInput(await readCommunityJson(request))') < post.indexOf('communityDb()'));
  assert.match(route, /noteIssue: validation\.issue/);
  assert.match(page, /id="incident-note-error"[^>]+role="alert"/);
  assert.match(page, /aria-invalid=\{!!noteIssue\}/);
  assert.match(page, /incidentNoteRef\.current\?\.focus\(\)/);
});
