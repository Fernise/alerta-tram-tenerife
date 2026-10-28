import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Condiciones de uso — Alerta Tram Tenerife',
  description: 'Condiciones de uso de Alerta Tram Tenerife.',
};

export default function TermsPage() {
  return <LegalPage
    eyebrow="CONDICIONES"
    title="Condiciones de uso"
    intro={<p>Al usar Alerta Tram aceptas estas reglas básicas. El servicio ayuda a interpretar la red, pero no sustituye las fuentes oficiales ni las obligaciones de cada viajero.</p>}
    sections={[
      { title: '1. Servicio independiente', body: <p>Alerta Tram es un proyecto comunitario independiente. No pertenece, representa ni está afiliado a Metropolitano de Tenerife, Cabildo de Tenerife o ten+móvil.</p> },
      { title: '2. Información orientativa', body: <p>Las posiciones, tiempos, ocupación y avisos pueden sufrir retrasos, errores o interrupciones. Comprueba las fuentes y señalización oficiales para decisiones importantes. El servicio se ofrece sin garantía de disponibilidad continua.</p> },
      { title: '3. Billete obligatorio', body: <p>Debes viajar siempre con un título válido, adquirido y validado conforme a las reglas oficiales. Los avisos comunitarios no justifican viajar sin billete ni eludir obligaciones legales.</p> },
      { title: '4. Uso de la comunidad', body: <><p>Antes de publicar un aviso debes aceptar estas condiciones y las Normas de la comunidad vigentes. Los avisos sobre inspecciones e incidencias son aproximados, temporales y no verificados. Las incidencias comunitarias no son un canal de emergencias ni sustituyen las comunicaciones oficiales. Está prohibido publicar fotografías, nombres, rasgos identificativos o descripciones de trabajadores o viajeros; acosar, amenazar o discriminar; crear avisos falsos, repetitivos o automatizados; o utilizar el servicio para fines ilegales.</p><p>Podemos limitar, ocultar o retirar contenido y bloquear actividad abusiva. Varias denuncias independientes pueden ocultar automáticamente un aviso hasta su revisión.</p></> },
      { title: '5. Datos y atribución', body: <p>Los datos oficiales mostrados se atribuyen al Cabildo de Tenerife y a Metropolitano de Tenerife y se reutilizan bajo licencia Creative Commons Atribución (CC BY), según la información publicada por la fuente. Los avisos comunitarios no son datos oficiales.</p> },
      { title: '6. Cambios', body: <p>Podemos modificar o suspender funciones durante la beta. Si las condiciones cambian de forma relevante, actualizaremos la fecha y avisaremos de manera visible.</p> },
    ]}
    englishTitle="Terms of use"
    englishIntro={<p>By using Alerta Tram you accept these basic rules. The service helps people understand the network, but it does not replace official sources or each passenger&apos;s obligations.</p>}
    englishSections={[
      { title: '1. Independent service', body: <p>Alerta Tram is an independent community project. It is not owned by, representative of or affiliated with Metropolitano de Tenerife, Cabildo de Tenerife or ten+móvil.</p> },
      { title: '2. Guidance only', body: <p>Positions, times, occupancy and reports may be delayed, wrong or unavailable. Check official sources and signage for important decisions. Continuous availability is not guaranteed.</p> },
      { title: '3. Valid ticket required', body: <p>You must always travel with a valid ticket purchased and validated under the official rules. Community reports do not justify travelling without a ticket or avoiding legal obligations.</p> },
      { title: '4. Community use', body: <><p>Before posting a report, you must accept the current Terms and Community guidelines. Inspection and incident reports are approximate, temporary and unverified. Community incidents are not an emergency channel and do not replace official communications. You must not post photos, names, identifying traits or descriptions of staff or passengers; harass, threaten or discriminate; submit false, repetitive or automated reports; or use the service for illegal purposes.</p><p>We may limit, hide or remove content and block abusive activity. Several independent flags may automatically hide an alert until it is reviewed.</p></> },
      { title: '5. Data and attribution', body: <p>Official data is attributed to Cabildo de Tenerife and Metropolitano de Tenerife and reused under the Creative Commons Attribution licence (CC BY), according to the source&apos;s published information. Community reports are not official data.</p> },
      { title: '6. Changes', body: <p>Features may change or be suspended during the beta. If these terms change materially, we will update the date and provide a visible notice.</p> },
    ]}
  />;
}
