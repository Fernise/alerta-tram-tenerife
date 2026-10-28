'use client';

import { useEffect, useRef, useState } from 'react';
import { createInstallController, INITIAL_INSTALL_STATE, suggestedInstallPlatform, type InstallPlatform } from '@/lib/pwa-install';

const copy = {
  es: {
    title: 'Lleva Alerta Tram contigo', subtitle: 'Un icono en tu móvil para volver al mapa sin buscar la web.',
    install: 'Instalar Alerta Tram', help: 'Cómo instalar', close: 'Cerrar guía', busy: 'Continúa en el navegador…', installed: 'Alerta Tram está instalada',
    platform: 'Instrucciones para', platforms: { ios: 'iPhone / iPad', android: 'Android', desktop: 'Ordenador' },
    steps: {
      ios: ['Abre esta web en Safari, fuera del navegador de otra app.', 'Pulsa Compartir y «Añadir a pantalla de inicio». Si no aparece, revisa «Editar acciones».', 'Activa «Abrir como app web» si aparece y pulsa «Añadir». Después abre Alerta Tram desde su icono.'],
      android: ['Abre esta web en Chrome, fuera del navegador de otra app.', 'Pulsa ⋮ y busca «Instalar y crear acceso directo» → «Instalar». Según la versión puede llamarse «Añadir a pantalla de inicio».', 'Confirma en el navegador y abre Alerta Tram desde el icono del móvil.'],
      desktop: ['Abre esta web en un navegador que permita instalar aplicaciones web.', 'Busca «Instalar» en la barra de direcciones o en el menú del navegador. Las opciones varían entre navegadores.', 'Si no aparece, puedes guardar la web en Favoritos y seguir utilizándola igual.'],
    },
    accepted: 'Solicitud aceptada. Termina los pasos del navegador y comprueba que aparece el icono.', dismissed: 'Has cerrado la instalación. Puedes continuar en la web sin instalar nada.', unavailable: 'La instalación automática no está disponible ahora. Usa los pasos de tu dispositivo.',
    connection: 'Necesitas internet para los tranvías y avisos en directo. Instalarla no activa las notificaciones ni añade una suscripción de pago.',
    privacy: 'En esta beta privada puede que debas iniciar sesión de nuevo al abrirla desde el icono. La instalación no concede acceso a otras personas.',
    notifications: 'En iPhone/iPad, abre primero el icono instalado y después activa las alertas desde «Mis alertas». Dependen de la compatibilidad y del permiso del navegador.',
    browserHint: '¿Estás dentro de Instagram, WhatsApp u otra app? Abre el enlace en Safari o Chrome. Los pasos pueden variar según la versión.',
    source: 'Ayuda oficial del navegador',
  },
  en: {
    title: 'Take Alerta Tram with you', subtitle: 'A Home Screen icon to reach the map without finding the website again.',
    install: 'Install Alerta Tram', help: 'How to install', close: 'Close guide', busy: 'Continue in your browser…', installed: 'Alerta Tram is installed',
    platform: 'Instructions for', platforms: { ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer' },
    steps: {
      ios: ['Open this website in Safari, outside another app’s built-in browser.', 'Tap Share, then “Add to Home Screen”. If missing, check “Edit Actions”.', 'Enable “Open as Web App” if shown, then tap “Add”. Open Alerta Tram from its new icon.'],
      android: ['Open this website in Chrome, outside another app’s built-in browser.', 'Tap ⋮ and look for “Install and create shortcut” → “Install”. Some versions call it “Add to Home Screen”.', 'Confirm in your browser, then open Alerta Tram from its icon on your phone.'],
      desktop: ['Open this website in a browser that supports installing web apps.', 'Look for “Install” in the address bar or browser menu. Options vary between browsers.', 'If it is not available, bookmark the website and keep using it normally.'],
    },
    accepted: 'Request accepted. Finish the browser steps and check that the icon appears.', dismissed: 'Installation dismissed. You can keep using the website without installing anything.', unavailable: 'Automatic installation is not available right now. Follow the steps for your device.',
    connection: 'An internet connection is required for live trams and alerts. Installing does not enable notifications or start a paid subscription.',
    privacy: 'In this private beta, you may need to sign in again when opening the icon. Installation does not grant access to anyone else.',
    notifications: 'On iPhone/iPad, open the installed icon first, then enable alerts in “My alerts”. Delivery depends on browser compatibility and permission.',
    browserHint: 'Inside Instagram, WhatsApp or another app? Open the link in Safari or Chrome. Steps may vary by version.',
    source: 'Official browser help',
  },
};

export function InstallHelp({ language, expanded, onExpandedChange }: { language: 'es' | 'en'; expanded: boolean; onExpandedChange: (open: boolean) => void }) {
  const [state, setState] = useState(INITIAL_INSTALL_STATE);
  const [platform, setPlatform] = useState<InstallPlatform>('ios');
  const controller = useRef<ReturnType<typeof createInstallController> | null>(null);
  const t = copy[language];
  useEffect(() => {
    const instance = createInstallController(window, setState);
    controller.current = instance;
    let active = true;
    queueMicrotask(() => { if (active) { setState(instance.getSnapshot()); setPlatform(suggestedInstallPlatform(window.navigator)); } });
    return () => { active = false; instance.destroy(); controller.current = null; };
  }, []);

  const message = state.outcome === 'idle' ? '' : t[state.outcome];
  const source = platform === 'ios' ? 'https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios'
    : platform === 'android' ? 'https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid'
      : 'https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing';

  return <section id="install-app" className="install-help" aria-labelledby="install-title">
    <div className="install-summary"><div><p className="install-kicker">ALERTA TRAM · WEB APP</p><h2 id="install-title">{state.installed ? t.installed : t.title}</h2><p>{t.subtitle}</p></div>
      <div className="install-actions">
        {!state.installed && (state.available || state.prompting) && <button type="button" className="install-primary" disabled={state.prompting} onClick={() => void controller.current?.install()}>{state.prompting ? t.busy : t.install}<span aria-hidden="true">↗</span></button>}
        <button type="button" aria-expanded={expanded} aria-controls="install-instructions" onClick={() => onExpandedChange(!expanded)}>{expanded ? t.close : t.help}<span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
      </div>
    </div>
    <p className="install-status" role="status">{message}</p>
    {expanded && <div id="install-instructions" className="install-instructions">
      <div className="install-platforms" role="group" aria-label={t.platform}>{(['ios', 'android', 'desktop'] as const).map((value) => <button type="button" key={value} aria-pressed={platform === value} onClick={() => setPlatform(value)}>{t.platforms[value]}</button>)}</div>
      <ol>{t.steps[platform].map((step) => <li key={step}>{step}</li>)}</ol>
      <p>{t.browserHint} <a href={source} target="_blank" rel="noreferrer">{t.source} ↗</a></p>
      <div className="install-notes"><p>{t.connection}</p><p>{t.privacy}</p>{platform === 'ios' && <p>{t.notifications}</p>}</div>
    </div>}
  </section>;
}
