import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Eliminación de datos — Alerta Tram Tenerife',
  description: 'Cómo solicitar la eliminación de datos asociados a Alerta Tram Tenerife.',
};

export default function DataDeletionPage() {
  return <LegalPage
    eyebrow="ELIMINACIÓN DE DATOS"
    title="Solicitar la eliminación de datos"
    intro={<p>Alerta Tram no crea cuentas de usuario. Aun así, puedes pedir que revisemos y eliminemos datos que hayas enviado voluntariamente.</p>}
    sections={[
      {
        title: 'Cómo solicitarlo',
        body: <><p>Escribe desde tu correo a <a href="mailto:support.alertatram@gmail.com?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos">support.alertatram@gmail.com</a> con el asunto “Solicitud de eliminación de datos”.</p><p>Indica únicamente la información necesaria para localizar el contenido: tipo de aviso o comentario, fecha aproximada, línea, sentido y parada. No envíes contraseñas, documentos de identidad, fotografías ni datos de otras personas.</p></>,
      },
      {
        title: 'Qué puede eliminarse',
        body: <p>Podemos eliminar avisos comunitarios, notas de incidencias, comentarios de beta y sus acciones asociadas cuando sea posible localizarlos de forma razonable. Las notificaciones pueden desactivarse directamente desde “Mis alertas”; la suscripción técnica se da de baja al hacerlo.</p>,
      },
      {
        title: 'Verificación y límites',
        body: <p>Como no existe una cuenta, puede que necesitemos datos contextuales del aviso para evitar borrar contenido de otra persona. Si no podemos vincular razonablemente una solicitud con un registro, explicaremos la limitación. Cierta información puede conservarse temporalmente cuando sea necesaria para seguridad, prevención de abuso, obligaciones legales o copias de recuperación sujetas a su plazo.</p>,
      },
      {
        title: 'Plazo y respuesta',
        body: <p>Confirmaremos la recepción y responderemos por el mismo correo. Aplicaremos la solicitud sin demora indebida dentro de los plazos legales que correspondan.</p>,
      },
    ]}
    englishTitle="Request data deletion"
    englishIntro={<p>Alerta Tram does not create user accounts. You can still ask us to review and delete data that you voluntarily submitted.</p>}
    englishSections={[
      {
        title: 'How to request deletion',
        body: <><p>Email <a href="mailto:support.alertatram@gmail.com?subject=Data%20deletion%20request">support.alertatram@gmail.com</a> with the subject “Data deletion request”.</p><p>Include only the information needed to locate the content: report or feedback type, approximate date, line, direction and stop. Do not send passwords, identity documents, photographs or information about other people.</p></>,
      },
      {
        title: 'What can be deleted',
        body: <p>We can delete community reports, incident notes, beta feedback and related actions when they can be reasonably located. Notifications can be disabled directly from “My alerts”; doing so removes the technical subscription.</p>,
      },
      {
        title: 'Verification and limits',
        body: <p>Because there is no account, we may need contextual report information to avoid deleting someone else&apos;s content. If we cannot reasonably link a request to a record, we will explain the limitation. Some information may be retained temporarily where necessary for security, abuse prevention, legal obligations or recovery backups subject to their retention period.</p>,
      },
      {
        title: 'Timing and response',
        body: <p>We will acknowledge the request and reply to the same email address. We will act without undue delay within the applicable legal time limits.</p>,
      },
    ]}
  />;
}
