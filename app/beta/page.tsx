'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FEEDBACK_CATEGORIES, FEEDBACK_PLATFORMS } from '@/lib/beta-feedback';

const copy = {
  es: {
    back: 'Volver al mapa', eyebrow: 'CUADERNO DE PRUEBAS · BETA', title: 'Un viaje mejor empieza con tu opinión.',
    intro: 'Ayúdanos a comprobar Alerta Tram en un trayecto real. Los comentarios llegan solo a la administración: no se publican como avisos del transporte.',
    guide: 'Tres cosas que puedes probar', steps: [
      ['Antes de salir', 'Elige tu línea y sentido. Comprueba que entiendes hacia dónde va cada tranvía y cuándo se actualizaron los datos.'],
      ['En la parada', 'Compara mapa y tarjetas con lo que ves. Si no coinciden, anota la hora aproximada, línea, sentido y parada; no describas personas.'],
      ['A tu manera', 'Prueba el cambio de idioma y los horarios de alertas. Puedes consultar sin permitir notificaciones. No publiques avisos ficticios para hacer pruebas.'],
    ], guideEnd: 'Información orientativa, no oficial. Para emergencias, utiliza los canales oficiales, no este formulario.',
    formTitle: '¿Qué mejorarías?', category: 'Tipo de comentario', categories: { bug: 'Algo no funciona', data: 'Datos del tranvía', language: 'Idioma o texto', suggestion: 'Una idea' },
    platform: '¿Dónde lo probaste? (opcional)', platforms: { unspecified: 'Sin indicar', ios: 'iPhone / iPad', android: 'Android', desktop: 'Ordenador', other: 'Otro' },
    message: 'Cuéntanos qué ocurrió', placeholder: 'Qué intentabas hacer, qué esperabas y qué pasó. Si son datos del tranvía: línea, sentido, parada y hora aproximada.',
    hint: '15–1.000 caracteres. No incluyas nombres, correos, teléfonos, matrículas, enlaces ni información personal.',
    privacy: 'Guardamos el comentario, categoría, idioma, dispositivo elegido y fecha. Un identificador técnico resumido limita los envíos (uno cada 5 minutos, hasta 10 al día). No pedimos datos de contacto ni enviamos newsletters. Los comentarios de más de 90 días se purgan en el siguiente envío o revisión.',
    privacyLink: 'Privacidad y conservación', submit: 'Enviar comentario', sending: 'Enviando…', success: 'Recibido. Gracias por ayudarnos a mejorar el próximo viaje.',
    another: 'Escribir otro comentario', reference: 'Referencia', waiting: 'Espera al menos 5 minutos entre comentarios; el límite es de 10 en 24 horas. Si la bandeja está llena, inténtalo más tarde.',
    invalid: 'Revisa la categoría y escribe entre 15 y 1.000 caracteres.', contact: 'Quita los enlaces y los datos de contacto antes de enviar.', error: 'No hemos podido confirmar el envío. Tu texto sigue aquí; puedes reintentarlo.',
  },
  en: {
    back: 'Back to the map', eyebrow: 'FIELD NOTES · BETA', title: 'A better journey starts with your feedback.',
    intro: 'Help us test Alerta Tram on a real journey. Feedback goes only to the administrator: it is not published as a transport alert.',
    guide: 'Three things to try', steps: [
      ['Before you leave', 'Choose your line and direction. Check that you can tell where each tram is heading and when the data was updated.'],
      ['At the stop', 'Compare the map and tram cards with what you see. If they differ, note the approximate time, line, direction and stop; do not describe people.'],
      ['Make it yours', 'Try switching languages and adjusting alert times. You can browse without allowing notifications. Do not publish made-up transport reports for testing.'],
    ], guideEnd: 'Indicative, unofficial information. In an emergency, use official channels, not this form.',
    formTitle: 'What could be better?', category: 'Feedback type', categories: { bug: 'Something is broken', data: 'Tram data', language: 'Language or wording', suggestion: 'An idea' },
    platform: 'Where did you try it? (optional)', platforms: { unspecified: 'Not specified', ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer', other: 'Other' },
    message: 'Tell us what happened', placeholder: 'What you were trying to do, what you expected and what happened. For tram data: line, direction, stop and approximate time.',
    hint: '15–1,000 characters. No names, emails, phone numbers, number plates, links or personal information.',
    privacy: 'We store your feedback, category, language, chosen device type and timestamp. A technical identifier digest limits submissions (one every 5 minutes, up to 10 per day). We do not request contact details or send newsletters. Feedback older than 90 days is purged on the next submission or inbox review.',
    privacyLink: 'Privacy and retention', submit: 'Send feedback', sending: 'Sending…', success: 'Received. Thank you for helping improve the next journey.',
    another: 'Write another comment', reference: 'Reference', waiting: 'Allow at least 5 minutes between comments; the limit is 10 in 24 hours. If the inbox is full, try again later.',
    invalid: 'Check the category and write between 15 and 1,000 characters.', contact: 'Remove links and contact details before sending.', error: 'We could not confirm delivery. Your text is still here; you can try again.',
  },
};

export default function BetaPage() {
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [category, setCategory] = useState<typeof FEEDBACK_CATEGORIES[number]>('bug');
  const [platform, setPlatform] = useState<typeof FEEDBACK_PLATFORMS[number]>('unspecified');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const sending = useRef(false);
  const sessionDevice = useRef('');
  const t = copy[language];

  useEffect(() => {
    queueMicrotask(() => {
      try { setLanguage(localStorage.getItem('alerta-tram-language-v1') === 'en' ? 'en' : 'es'); } catch { /* Storage is optional. */ }
    });
  }, []);

  function changeLanguage(next: 'es' | 'en') {
    setLanguage(next);
    try { localStorage.setItem('alerta-tram-language-v1', next); } catch { /* Keep the in-memory choice. */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setState('sending'); setError('');
    try {
      if (!sessionDevice.current) {
        let device = '';
        try { device = localStorage.getItem('alerta-tram-beta-device') || ''; } catch { /* Session fallback below. */ }
        sessionDevice.current = /^[a-zA-Z0-9-]{16,128}$/.test(device) ? device : crypto.randomUUID();
        try { localStorage.setItem('alerta-tram-beta-device', sessionDevice.current); } catch { /* Still usable in this tab. */ }
      }
      const payload = { category, platform, language, message };
      const key = JSON.stringify(payload);
      if (!attempt.current || attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const response = await fetch('/api/beta-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Alerta-Device': sessionDevice.current }, body: JSON.stringify({ ...payload, id: attempt.current.id }) });
      const result = await response.json() as { received?: boolean; reference?: string; error?: string };
      if (!response.ok || !result.received) { setError(result.error || 'unavailable'); setState('error'); return; }
      setReference(result.reference || attempt.current.id); setMessage(''); setState('sent'); attempt.current = null;
    } catch { setError('unavailable'); setState('error'); }
    finally { sending.current = false; }
  }

  return <main className="beta-shell" lang={language}>
    <header className="beta-header"><Link href="/" className="legal-brand"><span className="brand-tram" aria-hidden="true" /><strong>Alerta Tram</strong></Link><div className="language-switch" aria-label="Idioma / Language">{(['es', 'en'] as const).map((lang) => <button type="button" key={lang} aria-pressed={language === lang} className={language === lang ? 'active' : ''} disabled={state === 'sending'} onClick={() => changeLanguage(lang)}>{lang.toUpperCase()}</button>)}</div></header>
    <Link href="/" className="beta-back">← {t.back}</Link>
    <section className="beta-intro"><p className="legal-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p></section>
    <div className="beta-columns"><section className="beta-guide" aria-labelledby="beta-guide-title"><h2 id="beta-guide-title">{t.guide}</h2><ol>{t.steps.map(([title, description], index) => <li key={title}><span aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol><p className="beta-fineprint">{t.guideEnd}</p></section>
      <section className="beta-card" aria-labelledby="beta-form-title"><h2 id="beta-form-title">{t.formTitle}</h2>
        {state === 'sent' ? <div className="beta-success" role="status"><span aria-hidden="true">✓</span><h3>{t.success}</h3><p>{t.reference}: <code>{reference}</code></p><button type="button" onClick={() => setState('idle')}>{t.another}</button></div> : <form onSubmit={submit}>
          <fieldset disabled={state === 'sending'}><legend>{t.category}</legend><div className="beta-options">{FEEDBACK_CATEGORIES.map((value) => <label key={value}><input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} /><span>{t.categories[value]}</span></label>)}</div></fieldset>
          <fieldset disabled={state === 'sending'}><legend>{t.platform}</legend><div className="beta-options small">{FEEDBACK_PLATFORMS.map((value) => <label key={value}><input type="radio" name="platform" value={value} checked={platform === value} onChange={() => setPlatform(value)} /><span>{t.platforms[value]}</span></label>)}</div></fieldset>
          <label className="beta-message-label" htmlFor="beta-message">{t.message}</label><textarea id="beta-message" value={message} onChange={(event) => setMessage(event.target.value)} minLength={15} maxLength={1000} required rows={6} placeholder={t.placeholder} aria-describedby="beta-message-hint beta-count" disabled={state === 'sending'} />
          <div className="beta-message-meta"><p id="beta-message-hint">{t.hint}</p><span id="beta-count">{message.length}/1.000</span></div>
          <p className="beta-fineprint">{t.privacy} <Link href="/privacy">{t.privacyLink} ↗</Link></p>
          {state === 'error' && <p className="beta-error" role="alert">{error === 'feedback_limit' ? t.waiting : error === 'no_contact_details' ? t.contact : error === 'invalid_feedback' ? t.invalid : t.error}</p>}
          <button className="beta-submit" type="submit" disabled={state === 'sending' || message.trim().length < 15}>{state === 'sending' ? t.sending : t.submit}<span aria-hidden="true">↗</span></button>
        </form>}
      </section></div>
  </main>;
}
