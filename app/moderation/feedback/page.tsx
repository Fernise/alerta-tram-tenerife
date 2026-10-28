'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Feedback = { id: string; category: string; message: string; platform: string; language: string; createdAt: number; reviewedAt: number | null };
const categories: Record<string, string> = { bug: 'Funcionamiento', data: 'Datos del tranvía', language: 'Idioma', suggestion: 'Sugerencia' };

export default function FeedbackInbox() {
  const [filter, setFilter] = useState<'pending' | 'reviewed'>('pending');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Feedback[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionError, setActionError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/moderation/feedback?status=${filter}&page=${page}`, { cache: 'no-store', signal });
      if (response.status === 404) { setState('denied'); return; }
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json() as { feedback: Feedback[]; hasMore: boolean };
      if (signal?.aborted) return;
      setItems(payload.feedback); setHasMore(payload.hasMore); setState('ready');
    } catch { if (!signal?.aborted) setState('error'); }
  }, [filter, page]);

  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);

  async function act(id: string, action: 'review' | 'reopen' | 'delete') {
    if (pending) return;
    setPending(id); setActionError(false);
    try {
      const response = await fetch('/api/moderation/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
      if (!response.ok) throw new Error('unavailable');
      setDeleting(null); await load();
    } catch { setActionError(true); }
    finally { setPending(null); }
  }

  return <main className="moderation-shell beta-inbox">
    <header className="moderation-header"><div><p>ALERTA TRAM · ÁREA PRIVADA</p><h1>Comentarios de la beta</h1></div><Link href="/moderation">← Moderación</Link></header>
    <p className="beta-fineprint">Solo para administración. No son incidencias del transporte. Revisa datos personales antes de compartir cualquier extracto. Los comentarios de más de 90 días se purgan al abrir esta bandeja o recibir un envío.</p>
    <nav className="beta-inbox-filters" aria-label="Estado de los comentarios">{(['pending', 'reviewed'] as const).map((value) => <button type="button" key={value} disabled={Boolean(pending)} aria-pressed={filter === value} onClick={() => { if (value !== filter) { setFilter(value); setPage(0); setState('loading'); setDeleting(null); } }}>{value === 'pending' ? 'Pendientes' : 'Revisados'}</button>)}<button type="button" disabled={Boolean(pending)} onClick={() => void load()}>Actualizar</button></nav>
    {state === 'loading' && <p role="status">Cargando…</p>}
    {state === 'denied' && <div className="moderation-state denied"><strong>Acceso no autorizado</strong><p>Inicia sesión como propietario para consultar los comentarios.</p></div>}
    {state === 'error' && <div className="moderation-state denied" role="alert">No se pudo cargar la bandeja. Usa «Actualizar» para reintentar.</div>}
    {actionError && <p className="beta-error" role="alert">No se pudo confirmar el cambio. Actualiza la bandeja antes de reintentarlo.</p>}
    {state === 'ready' && <><p className="beta-fineprint">{items.length} comentarios mostrados · página {page + 1}. Revisa desde la primera página para no saltar pendientes al cambiar su estado.</p><section className="moderation-list">
      {items.length === 0 ? <div className="moderation-state"><strong>{filter === 'pending' ? 'No hay comentarios pendientes' : 'Aún no hay comentarios revisados'}</strong><p>El formulario está en <Link href="/beta">la guía de la beta</Link>.</p></div> : items.map((item) => <article key={item.id}>
        <div className="moderation-report-heading"><span>{categories[item.category] || item.category}</span><b>{item.language.toUpperCase()} · {item.platform}</b></div>
        <p className="beta-feedback-text">{item.message}</p><p className="beta-fineprint"><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('es-ES', { timeZone: 'Atlantic/Canary' })}</time> · hora canaria<br /><code>{item.id}</code></p>
        <div className="moderation-actions"><button type="button" disabled={Boolean(pending)} onClick={() => void act(item.id, filter === 'pending' ? 'review' : 'reopen')}>{filter === 'pending' ? 'Marcar revisado' : 'Volver a pendiente'}</button><button type="button" disabled={Boolean(pending)} onClick={() => setDeleting(item.id)}>Eliminar</button></div>
        {deleting === item.id && <div className="beta-delete-confirm"><p>Se eliminará de la base activa, sin deshacer. Las copias privadas anteriores pueden conservarlo hasta su eliminación manual.</p><button type="button" disabled={Boolean(pending)} onClick={() => void act(item.id, 'delete')}>Sí, eliminar comentario</button><button type="button" disabled={Boolean(pending)} onClick={() => setDeleting(null)}>Cancelar</button></div>}
      </article>)}
    </section><nav className="beta-inbox-filters" aria-label="Páginas de comentarios"><button type="button" disabled={page === 0 || Boolean(pending)} onClick={() => { setPage(page - 1); setState('loading'); }}>← Anterior</button><button type="button" disabled={!hasMore || Boolean(pending)} onClick={() => { setPage(page + 1); setState('loading'); }}>Siguiente →</button></nav></>}
  </main>;
}
