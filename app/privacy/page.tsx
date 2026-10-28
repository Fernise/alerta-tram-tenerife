import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacidad — Alerta Tram Tenerife',
  description: 'Información sobre privacidad y datos de Alerta Tram Tenerife.',
};

export default function PrivacyPage() {
  return <LegalPage
    eyebrow="PRIVACIDAD"
    title="Política de privacidad"
    intro={<p>Alerta Tram se ha diseñado para funcionar sin cuentas y recogiendo la menor cantidad de información posible. Esta política explica qué ocurre al consultar la web, compartir un aviso o activar notificaciones.</p>}
    sections={[
      {
        title: '1. Responsable y contacto',
        body: <><p>Nombre del servicio y marca: Alerta Tram. País indicado: España.</p><p>Para cuestiones de privacidad, ejercicio de derechos o solicitudes de eliminación puedes escribir a <a href="mailto:support.alertatram@gmail.com">support.alertatram@gmail.com</a>. También puedes consultar las <a href="/data-deletion">instrucciones de eliminación de datos</a>. No envíes contraseñas, documentos de identidad ni información de terceras personas.</p></>,
      },
      {
        title: '2. Avisos de la comunidad',
        body: <><p>No pedimos nombre, correo, cuenta, fotografías ni descripciones de personas. Un aviso contiene únicamente su categoría —inspección o incidencia—, tipo de incidencia cuando corresponda, línea, sentido, parada aproximada, zona del tranvía, fechas, confirmaciones y estado. Si se selecciona “Otra incidencia”, también incluye la nota breve escrita por el usuario.</p><p>El navegador crea un identificador aleatorio guardado localmente. El servidor recibe ese valor al publicar, confirmar o retirar un aviso, pero conserva únicamente un resumen criptográfico SHA-256 para aplicar límites contra abusos. No se usa para publicidad ni identifica de forma verificada a una persona.</p><p>Con cada aviso activo se entrega una clave pública abreviada derivada de ese resumen. Permite que otro navegador bloquee los avisos de la misma fuente anónima sin publicar el identificador original. La clave solo sirve para agrupar avisos dentro de Alerta Tram y debe considerarse un dato seudónimo.</p></>,
      },
      {
        title: '3. Notificaciones',
        body: <><p>Si las activas, guardamos la suscripción técnica del navegador —dirección de entrega, claves y preferencias de línea, sentido, ocupación y horario silencioso— para enviar las alertas solicitadas. Puedes darte de baja desde la aplicación. Las suscripciones inactivas se eliminan periódicamente y, como máximo, tras 180 días sin actividad.</p><p>Las copias de seguridad del servidor pueden conservar una suscripción eliminada durante hasta siete días adicionales, más el tiempo hasta la siguiente copia correcta. Son privadas, se usan solo para recuperación y las bajas deben respetarse antes de reactivar envíos tras una restauración.</p></>,
      },
      {
        title: '3.1. Denuncias y conservación',
        body: <><p>Al denunciar un aviso conservamos el motivo, la fecha y el resumen criptográfico del dispositivo para impedir votos repetidos y abusos. Tres denuncias de dispositivos distintos pueden ocultar temporalmente un aviso para revisión. Los avisos comunitarios, sus confirmaciones y denuncias de más de 90 días se eliminan en la siguiente consulta de avisos, salvo mientras exista una pausa activa vinculada para que la administración pueda levantarla. Sin consultas pueden permanecer hasta entonces.</p><p>La administración puede pausar durante 24 horas las acciones comunitarias de un dispositivo. Se guardan su resumen SHA-256 y las fechas de inicio y fin; no se publica el identificador. La pausa vence automáticamente y se elimina en la siguiente consulta de avisos o moderación. No identifica de forma verificada a una persona. Levantarla o dejarla vencer no restaura avisos ocultos.</p><p>La persona administradora puede descargar copias privadas para recuperación, incluidas las pausas. Debe protegerlas, eliminarlas transcurridos siete días y aplicar las bajas, retiradas y plazos de conservación antes de recuperar datos en producción. La eliminación de estas copias manuales no es automática.</p></>,
      },
      {
        title: '3.2. Comentarios de la beta',
        body: <><p>El formulario de pruebas guarda categoría, texto, idioma, tipo de dispositivo elegido voluntariamente y fechas de envío y revisión. Solo la administración puede consultarlos; no se publican en el mapa. No pedimos nombre ni contacto. No escribas información personal de otras personas.</p><p>Un identificador aleatorio separado se conserva en el navegador. Guardamos su resumen SHA-256 con los comentarios para limitar los envíos, no para publicidad. Estos identificadores técnicos no equivalen a datos anónimos. Los comentarios de más de 90 días se eliminan en el siguiente envío o acceso a la bandeja; si no hay actividad pueden permanecer hasta entonces. También se incluyen en las copias privadas manuales sujetas al plazo de siete días indicado arriba.</p><p>Los comentarios se usan para evaluar y corregir el servicio. Puedes solicitar su eliminación mediante el canal indicado en la sección 1.</p></>,
      },
      {
        title: '4. Métricas agregadas',
        body: <p>Para saber si la beta resulta útil almacenamos solo el día, el tipo de acción, el idioma y un contador total. Nuestra base de métricas no guarda IP, identificador de dispositivo, agente de usuario ni recorrido individual. Los contadores se conservan hasta 24 meses.</p>,
      },
      {
        title: '5. Almacenamiento del navegador y cookies',
        body: <p>El navegador conserva preferencias funcionales: idioma, configuración de alertas, identificador comunitario aleatorio, aceptación de las normas, avisos ocultos, fuentes bloqueadas y tiempos de espera para evitar pulsaciones repetidas. Estas preferencias pueden eliminarse borrando los datos del sitio. En esta beta no usamos cookies publicitarias, perfiles de comportamiento ni analítica de terceros. Si esto cambia, se actualizará esta política y se solicitará consentimiento cuando corresponda.</p>,
      },
      {
        title: '6. Proveedores y datos técnicos',
        body: <p>Los proveedores que alojan y protegen el servicio pueden tratar temporalmente datos técnicos de conexión necesarios para entregar y asegurar las solicitudes, como ocurre en cualquier servicio web. La relación completa de encargados, ubicaciones y salvaguardas deberá documentarse antes del lanzamiento público.</p>,
      },
      {
        title: '7. Finalidad, base y derechos',
        body: <><p>Tratamos la información para prestar las funciones que solicitas, mantener la seguridad, limitar abusos y mejorar el servicio mediante estadísticas agregadas. La activación de notificaciones es voluntaria y requiere permiso del navegador; la seguridad y la mejora agregada se apoyan en el interés legítimo del servicio.</p><p>Puedes retirar el permiso de notificaciones desde el navegador y solicitar acceso, rectificación, supresión, oposición o limitación escribiendo a <a href="mailto:support.alertatram@gmail.com">support.alertatram@gmail.com</a>. También puedes reclamar ante la Agencia Española de Protección de Datos.</p></>,
      },
    ]}
    englishTitle="Privacy policy"
    englishIntro={<p>Alerta Tram is designed to work without accounts and to collect as little information as possible. This policy explains what happens when you browse the site, share a report or enable notifications.</p>}
    englishSections={[
      {
        title: '1. Controller and contact',
        body: <><p>Service name and brand: Alerta Tram. Country stated: Spain.</p><p>For privacy questions, rights requests or data deletion requests, email <a href="mailto:support.alertatram@gmail.com">support.alertatram@gmail.com</a>. You can also read the <a href="/data-deletion">data deletion instructions</a>. Do not send passwords, identity documents or information about other people.</p></>,
      },
      {
        title: '2. Community reports',
        body: <><p>We do not request your name, email, account, photographs or descriptions of people. A report only contains its category—inspection or incident—the incident type where applicable, line, direction, approximate stop, tram area, timestamps, confirmations and status. When “Other incident” is selected, it also contains the short note written by the user.</p><p>Your browser creates a random identifier stored locally. The server receives it when a report is posted, confirmed or removed, but stores only a SHA-256 cryptographic digest to enforce abuse limits. It is not used for advertising and does not provide verified identification of a person.</p><p>Each active report includes a shortened public key derived from that digest. It lets another browser block reports from the same anonymous source without publishing the original identifier. The key only groups reports inside Alerta Tram and must be treated as pseudonymous data.</p></>,
      },
      {
        title: '3. Notifications',
        body: <><p>If enabled, we store the browser&apos;s technical push subscription—delivery endpoint, keys and line, direction, occupancy and quiet-hour preferences—to send the alerts you request. You can unsubscribe in the application. Inactive subscriptions are periodically removed and are retained for no longer than 180 days without activity.</p><p>Server backups may retain a deleted subscription for up to seven additional days, plus the time until the next successful backup. They are private and used only for recovery; opt-outs must be respected before resuming delivery after a restoration.</p></>,
      },
      {
        title: '3.1. Flags and retention',
        body: <><p>When you flag an alert, we store the reason, timestamp and cryptographic device digest to prevent repeated votes and abuse. Three flags from different devices may temporarily hide an alert for review. Community reports, confirmations and flags older than 90 days are removed on the next report listing, except while a linked participation pause remains active so that the administrator can release it. With no requests they may remain until then.</p><p>The administrator can pause a device’s community actions for 24 hours. We store its SHA-256 digest and start/end timestamps; the identifier is not public. A pause expires automatically and is deleted on the next report or moderation listing. This does not verify a person’s identity. Releasing or expiring a pause does not restore hidden reports.</p><p>The administrator can download private recovery backups, including pauses. They must protect them, delete them after seven days and apply opt-outs, removals and retention limits before restoring production data. Deletion of these manual backups is not automatic.</p></>,
      },
      {
        title: '3.2. Beta feedback',
        body: <><p>The test form stores category, message, language, optionally chosen device type, and submission and review timestamps. Only the administrator can read feedback; it is not published on the map. We do not request names or contact details. Do not include other people&apos;s personal information.</p><p>A separate random identifier is kept in your browser. Its SHA-256 digest is stored with feedback to limit submissions, not for advertising. These technical identifiers are not anonymous data. Comments older than 90 days are removed on the next submission or inbox access; with no activity they may remain until then. They are included in private manual backups subject to the seven-day retention described above.</p><p>Feedback is used to evaluate and improve the service. You can request its deletion through the channel in section 1.</p></>,
      },
      {
        title: '4. Aggregate metrics',
        body: <p>To understand whether the beta is useful, we store only the day, event type, language and a total counter. Our metrics database does not store IP addresses, device identifiers, user agents or individual journeys. Counters are retained for up to 24 months.</p>,
      },
      {
        title: '5. Browser storage and cookies',
        body: <p>Your browser keeps functional preferences: language, alert settings, a random community identifier, acceptance of the rules, hidden reports, blocked sources and cooldown timestamps. You can remove these preferences by clearing the site&apos;s data. This beta uses no advertising cookies, behavioural profiles or third-party analytics. If that changes, this policy will be updated and consent requested where required.</p>,
      },
      {
        title: '6. Providers and technical data',
        body: <p>Providers that host and protect the service may temporarily process technical connection data required to deliver and secure requests, as with any web service. The complete list of processors, locations and safeguards must be documented before public launch.</p>,
      },
      {
        title: '7. Purpose, basis and rights',
        body: <><p>Information is processed to provide requested features, maintain security, limit abuse and improve the service using aggregate statistics. Notifications are voluntary and require browser permission; security and aggregate service improvement rely on the service&apos;s legitimate interests.</p><p>You can revoke notification permission in your browser and request access, correction, deletion, objection or restriction by emailing <a href="mailto:support.alertatram@gmail.com">support.alertatram@gmail.com</a>. You may also lodge a complaint with the Spanish Data Protection Agency.</p></>,
      },
    ]}
  />;
}
