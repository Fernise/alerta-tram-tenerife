'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ModerationReport = {
  id: string;
  line: string;
  direction: string;
  stop: string;
  kind: 'inspection' | 'incident';
  incidentType: string | null;
  note: string | null;
  createdAt: number;
  lastConfirmedAt: number;
  restrictionUntil: number | null;
  flagCount: number;
  status: string;
  moderationReason: string | null;
  personalDataFlags: number;
  spamFlags: number;
  inappropriateFlags: number;
};

export default function ModerationPage() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [pending, setPending] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [pauses, setPauses] = useState<{ reportId: string; expiresAt: number }[]>([]);
  const [activeCutoff, setActiveCutoff] = useState(0);
  const [backupRequested, setBackupRequested] = useState(false);

  const loadReports = useCallback(async () => {
    try {
      const response = await fetch('/api/moderation/reports', { cache: 'no-store' });
      if (response.status === 404) { setState('denied'); return; }
      if (!response.ok) throw new Error('moderation_unavailable');
      const payload = await response.json() as { reports?: ModerationReport[]; pauses?: typeof pauses; activeCutoff: number };
      setReports(payload.reports || []);
      setPauses(payload.pauses || []);
      setActiveCutoff(payload.activeCutoff);
      setState('ready');
    } catch { setState('error'); }
  }, []);

  useEffect(() => { queueMicrotask(() => void loadReports()); }, [loadReports]);

  async function moderate(id: string, action: 'remove' | 'restore' | 'restrict' | 'release') {
    if (pending) return;
    setPending(id);
    setActionNotice('');
    try {
      const response = await fetch('/api/moderation/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setActionNotice(payload.error === 'restore_not_allowed'
          ? 'No se puede restaurar: el aviso ha caducado, ya no está oculto o su dispositivo sigue en pausa.'
          : 'No se pudo aplicar el cambio. Vuelve a cargar y comprueba el estado antes de reintentar.');
        await loadReports();
        return;
      }
      setConfirmPause(null);
      setActionNotice(action === 'restrict' ? 'Participación pausada durante 24 horas. Sus avisos activos han quedado ocultos.'
        : action === 'release' ? 'Pausa levantada. Los avisos ocultos no se han restaurado.' : 'Cambio aplicado.');
      await loadReports();
    } catch { setActionNotice('No se pudo confirmar el cambio. Actualiza la lista antes de reintentar.'); }
    finally { setPending(null); }
  }

  return <main className="moderation-shell">
    <header className="moderation-header"><div><p>ALERTA TRAM · ÁREA PRIVADA</p><h1>Moderación</h1></div><Link href="/">← Volver al mapa</Link></header>
    {state === 'loading' && <div className="moderation-state">Cargando avisos…</div>}
    {state === 'denied' && <div className="moderation-state denied"><strong>Acceso no autorizado</strong><p>Esta sección solo está disponible para la persona administradora de Alerta Tram.</p></div>}
    {state === 'error' && <div className="moderation-state denied"><strong>No se pudo cargar</strong><button type="button" onClick={() => void loadReports()}>Reintentar</button></div>}
    {state === 'ready' && <>
      <p><Link href="/moderation/feedback">Ver comentarios privados de la beta →</Link></p>
      <section className="moderation-backup" aria-labelledby="backup-title">
        <div><h2 id="backup-title">Copia privada de la comunidad</h2><p>Descarga avisos, confirmaciones, denuncias, pausas de participación, métricas y comentarios de la beta. No incluye el histórico ni las suscripciones del VPS, que tienen una copia separada.</p><small>Contiene notas e identificadores técnicos: guárdala en un lugar privado, no la subas a la web y elimina las copias con más de siete días. Descarga manual; no es una copia diaria automática.</small></div>
        <form action="/api/moderation/backup" method="post" target="community-backup-download" onSubmit={() => setBackupRequested(true)}>
          <button type="submit" disabled={backupRequested}>{backupRequested ? 'Copia solicitada' : 'Descargar copia'}</button>
        </form>
        <iframe name="community-backup-download" title="Resultado de la descarga de la copia" hidden />
        <p role="status">{backupRequested ? 'Solicitud enviada al navegador. Comprueba que el archivo aparece en Descargas antes de considerarlo una copia válida.' : ''}</p>
      </section>
      <section className="moderation-safety" aria-labelledby="safety-title">
        <h2 id="safety-title">Pausas de participación</h2>
        <p>Puedes pausar durante 24 horas el dispositivo que publicó un aviso abusivo. No podrá publicar, confirmar, retirar, deshacer ni denunciar avisos; podrá seguir consultando el mapa y enviar comentarios privados de la beta.</p>
        <p>Es una medida por navegador, no un bloqueo de una persona: borrar sus datos o cambiar de navegador permite obtener otro identificador. No se solicitan cuentas ni datos personales adicionales.</p>
        {pauses.length ? <ul>{pauses.map((pause, index) => <li key={pause.reportId}>
          <span>Pausa {index + 1} · Hasta {new Date(pause.expiresAt).toLocaleString('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'short', timeStyle: 'short' })} (Canarias)</span>
          <button type="button" disabled={!!pending} onClick={() => void moderate(pause.reportId, 'release')}>Levantar pausa</button>
        </li>)}</ul> : <p>No hay pausas activas.</p>}
        <button type="button" disabled={!!pending} onClick={() => void loadReports()}>Actualizar lista</button>
        <p role="status" aria-live="polite">{actionNotice}</p>
      </section>
      <div className="moderation-summary"><strong>{reports.length}</strong><span>avisos con denuncias o intervención · últimos 200</span></div>
      <section className="moderation-list">
        {reports.length ? reports.map((report) => <article key={report.id} className={report.status === 'moderated' ? 'is-hidden' : ''}>
          <div className="moderation-report-heading"><span>{report.kind === 'inspection' ? 'INSPECCIÓN' : 'INCIDENCIA'}</span><b>{report.status === 'moderated' ? 'OCULTO' : report.status !== 'active' ? 'RETIRADO' : report.lastConfirmedAt <= activeCutoff ? 'CADUCADO' : 'VISIBLE'}</b></div>
          <h2>{report.line} · {report.stop}</h2>
          {report.note && <p className="moderation-note">“{report.note}”</p>}
          <div className="moderation-flags"><span>{report.flagCount} denuncias</span><small>Datos personales: {report.personalDataFlags}</small><small>Falso/spam: {report.spamFlags}</small><small>Inapropiado: {report.inappropriateFlags}</small></div>
          {report.restrictionUntil && <p className="moderation-pause-label">Dispositivo en pausa · Puedes levantarla en la lista superior.</p>}
          {report.status === 'moderated' && report.lastConfirmedAt <= activeCutoff && <p>Este aviso ha caducado. Restaurarlo no sería información actual.</p>}
          <div className="moderation-actions"><button type="button" disabled={!!pending || report.status === 'moderated'} onClick={() => void moderate(report.id, 'remove')}>Ocultar</button><button type="button" disabled={!!pending || report.status !== 'moderated' || !!report.restrictionUntil || report.lastConfirmedAt <= activeCutoff} onClick={() => void moderate(report.id, 'restore')}>Restaurar y limpiar denuncias</button>
            <button type="button" disabled={!!pending || !!report.restrictionUntil} onClick={() => setConfirmPause(report.id)}>Pausar dispositivo 24 h…</button>
          </div>
          {confirmPause === report.id && <div className="moderation-pause-confirm" role="group" aria-label="Confirmar pausa del dispositivo">
            <p>Se ocultarán sus avisos activos y se pausarán sus acciones comunitarias durante 24 horas. Podrás levantar la pausa en cualquier momento. ¿Aplicarla?</p>
            <div className="moderation-actions"><button type="button" disabled={!!pending} onClick={() => void moderate(report.id, 'restrict')}>Sí, pausar 24 horas</button><button type="button" disabled={!!pending} onClick={() => setConfirmPause(null)}>Cancelar</button></div>
          </div>}
        </article>) : <div className="moderation-state"><strong>Todo limpio</strong><p>No hay avisos denunciados.</p></div>}
      </section>
    </>}
  </main>;
}
