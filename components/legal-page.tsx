import Link from 'next/link';
import type { ReactNode } from 'react';

type LegalSection = {
  title: string;
  body: ReactNode;
};

export function LegalPage({
  eyebrow,
  title,
  intro,
  sections,
  englishTitle,
  englishIntro,
  englishSections,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  englishTitle: string;
  englishIntro: ReactNode;
  englishSections: LegalSection[];
}) {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="legal-brand" href="/" aria-label="Volver a Alerta Tram">
          <span className="brand-tram" aria-hidden="true" />
          <span><strong><b>Alerta</b> Tram</strong><small>Tenerife · movilidad en directo</small></span>
        </Link>
        <Link className="legal-back" href="/">← Volver / Back</Link>
      </header>

      <article className="legal-document">
        <p className="legal-eyebrow">{eyebrow} · 03.09.2026</p>
        <h1>{title}</h1>
        <div className="legal-intro">{intro}</div>
        <aside className="legal-warning">
          <strong>Requisito previo a invitar probadores / Before inviting testers</strong>
          <p>La identidad legal de la persona responsable y un canal directo de contacto deben completarse antes de invitar a terceros, también en una beta cerrada. Esta versión es un borrador para pruebas del propietario.</p>
          <p>The controller&apos;s legal identity and a direct contact channel must be completed before inviting others, including a closed beta. This is a draft for owner testing.</p>
        </aside>
        <div className="legal-sections">
          {sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.body}</section>)}
        </div>

        <hr />

        <p className="legal-eyebrow">ENGLISH</p>
        <h1>{englishTitle}</h1>
        <div className="legal-intro">{englishIntro}</div>
        <div className="legal-sections">
          {englishSections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.body}</section>)}
        </div>
      </article>

      <footer className="legal-footer">
        <Link href="/privacy">Privacidad / Privacy</Link>
        <Link href="/terms">Condiciones / Terms</Link>
        <Link href="/community-guidelines">Normas / Guidelines</Link>
      </footer>
    </main>
  );
}
