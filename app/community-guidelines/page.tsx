import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Normas de la comunidad — Alerta Tram Tenerife',
  description: 'Normas para publicar y confirmar avisos en Alerta Tram Tenerife.',
};

export default function CommunityGuidelinesPage() {
  return <LegalPage
    eyebrow="COMUNIDAD"
    title="Normas de la comunidad"
    intro={<p>Un aviso útil es breve, aproximado y respetuoso. Estas normas se aplican al publicar, confirmar o retirar información.</p>}
    sections={[
      { title: 'Separa inspecciones e incidencias', body: <p>Usa “Inspección de billetes” únicamente cuando observes una comprobación de títulos. Utiliza “Incidencia de servicio” para retrasos, aglomeraciones excepcionales, accesibilidad u otros problemas del viaje. No es un canal de emergencias: ante peligro inmediato, avisa al personal y llama al 112.</p> },
      { title: 'Comparte solo la ubicación', body: <p>Elige la línea, el sentido, la parada aproximada y, para inspecciones, la zona del tranvía. No publiques nombres, fotografías, matrículas, uniforme, edad, género, rasgos físicos u otros detalles que permitan identificar a una persona.</p> },
      { title: 'Actúa de buena fe', body: <p>Publica únicamente lo que observas directamente. No inventes, dupliques ni automatices avisos. No uses el servicio para acosar, señalar, amenazar o discriminar.</p> },
      { title: 'Describe sin identificar', body: <p>La nota de “Otra incidencia” debe explicar únicamente qué afecta al servicio. No incluyas nombres, datos de contacto, enlaces, acusaciones ni información que permita identificar a trabajadores o viajeros.</p> },
      { title: 'Revisa tu nota antes de enviarla', body: <p>Un filtro comprueba algunos patrones habituales de teléfonos, correos, enlaces, documentos, matrículas, datos bancarios e insultos o amenazas. Si rechaza una nota, verás el motivo y podrás corregirla sin perder el texto. No detecta todos los casos y puede equivocarse: no presupongas que una nota aceptada es segura. Describe el servicio, no a las personas; usa la denuncia si se publica contenido inapropiado.</p> },
      { title: 'Mantén la información al día', body: <p>Confirma “Sí, sigue” solo si puedes comprobarlo. Cada dispositivo puede confirmar el mismo aviso una vez cada 10 minutos. Usa “Ya no está” cuando el aviso haya dejado de ser correcto; podrás deshacerlo si fue un error.</p> },
      { title: 'Los avisos caducan', body: <p>Un aviso desaparece 15 minutos después de su última confirmación. Su fiabilidad depende de la comunidad y nunca está garantizada.</p> },
      { title: 'Viaja con título válido', body: <p>La finalidad del mapa es informar a la comunidad. Debes disponer siempre de un billete válido y cumplir las condiciones oficiales del transporte.</p> },
      { title: 'Moderación', body: <p>La actividad falsa, abusiva o contraria a estas normas puede ser retirada o limitada. Los mecanismos automáticos reducen spam, pero no sustituyen una revisión humana cuando sea necesaria.</p> },
      { title: 'Pausas de participación', body: <p>La administración puede pausar durante 24 horas el dispositivo que publicó un aviso abusivo. Durante ese tiempo no puede publicar, confirmar, retirar, deshacer ni denunciar avisos. Puede seguir consultando el mapa y enviar comentarios privados desde “Ayúdanos a mejorar”. La pausa puede levantarse antes, pero no recupera automáticamente avisos ocultos. Es una medida por navegador, no un bloqueo de identidad.</p> },
      { title: 'Denuncia con responsabilidad', body: <p>Usa “Denunciar contenido” para datos personales, avisos falsos o contenido inapropiado. No lo uses simplemente porque una inspección o incidencia ya haya terminado; para eso están “Ya no está” y “Ya está resuelta”.</p> },
      { title: 'Controla lo que ves', body: <p>Puedes ocultar un aviso o bloquear en tu dispositivo los avisos de la misma fuente anónima sin retirarlos para el resto de la comunidad. Estas preferencias se guardan en el navegador y pueden deshacerse inmediatamente.</p> },
    ]}
    englishTitle="Community guidelines"
    englishIntro={<p>A useful report is brief, approximate and respectful. These rules apply whenever you post, confirm or remove information.</p>}
    englishSections={[
      { title: 'Separate inspections and incidents', body: <p>Use “Ticket inspection” only when you observe staff checking tickets. Use “Service incident” for delays, exceptional crowding, accessibility or other journey problems. This is not an emergency channel: for immediate danger, alert staff and call 112.</p> },
      { title: 'Share location only', body: <p>Select the line, direction, approximate stop and, for inspections, the tram area. Do not post names, photographs, vehicle plates, uniforms, age, gender, physical traits or any other detail that could identify a person.</p> },
      { title: 'Act in good faith', body: <p>Only report what you directly observe. Do not invent, duplicate or automate reports. Do not use the service to harass, target, threaten or discriminate.</p> },
      { title: 'Describe without identifying', body: <p>The “Other incident” note should only explain what is affecting the service. Do not include names, contact details, links, allegations or information that could identify staff or passengers.</p> },
      { title: 'Check your note before sending', body: <p>A filter checks some common patterns for phone numbers, emails, links, identity documents, number plates, bank details, insults and threats. If a note is rejected, you can see why and edit it without losing the text. The filter misses some cases and can make mistakes: acceptance does not mean a note is safe. Describe the service, not people; flag inappropriate content if it is published.</p> },
      { title: 'Keep information current', body: <p>Confirm “Yes, still there” only when you can verify it. Each device can confirm the same report once every 10 minutes. Use “No longer there” when the report is no longer correct; you can undo the action if it was a mistake.</p> },
      { title: 'Reports expire', body: <p>A report disappears 15 minutes after its latest confirmation. Confidence depends on the community and is never guaranteed.</p> },
      { title: 'Travel with a valid ticket', body: <p>The map is intended to inform the community. You must always hold a valid ticket and comply with the official transport conditions.</p> },
      { title: 'Moderation', body: <p>False, abusive or non-compliant activity may be removed or restricted. Automated safeguards reduce spam but do not replace human review when needed.</p> },
      { title: 'Participation pauses', body: <p>The administrator may pause the device that posted an abusive report for 24 hours. It cannot post, confirm, remove, undo or flag reports during that time. It can still view the map and send private feedback through “Help us improve”. A pause can be lifted early, but hidden reports are not automatically restored. This is a browser-level measure, not an identity ban.</p> },
      { title: 'Flag responsibly', body: <p>Use “Report content” for personal information, false alerts or inappropriate material. Do not use it merely because an inspection or incident has ended; use “No longer there” or “It is resolved” instead.</p> },
      { title: 'Control what you see', body: <p>You can hide a report or block reports from the same anonymous source on your device without removing them for the rest of the community. These preferences are stored in your browser and can be undone immediately.</p> },
    ]}
  />;
}
