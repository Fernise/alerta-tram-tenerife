'use client';

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { isFresh, timestampMs, OCCUPANCY_MAX_AGE_MS } from '@/lib/realtime-freshness';
import { InstallHelp } from '@/components/install-help';
import { noteIssueMessage, validateIncidentNote } from '@/lib/incident-note';
import { COMMUNITY_TERMS_VERSION } from '@/lib/community-terms';
import { confirmationSnapshot, createPreferenceStore, stringListSnapshot, useBrowserClock, usePreference } from '@/lib/browser-preferences';

type LineId = 'L1' | 'L2';
type Direction = 'ida' | 'vuelta';
type Zone = 'Delante' | 'Zona central' | 'Detrás';
type Language = 'es' | 'en';
type ReportKind = 'inspection' | 'incident';
type IncidentType = 'disruption' | 'crowding' | 'accessibility' | 'other';
type FlagReason = 'personal_data' | 'false_or_spam' | 'inappropriate';
type MetricEvent = 'page_load' | 'language_changed' | 'guide_opened' | 'report_form_opened' | 'report_published' | 'inspection_published' | 'incident_published' | 'report_confirmed' | 'report_dismissed' | 'report_flagged' | 'notifications_enabled' | 'notification_test_sent' | 'pwa_installed';
type OccupancyThreshold = 'high' | 'very-high';
type PushMode = 'checking' | 'background' | 'local';
type NotificationPreferences = {
  enabled: boolean;
  line: LineId;
  direction: Direction;
  threshold: OccupancyThreshold;
  quietStart: string;
  quietEnd: string;
};
type Report = {
  id: string;
  line: LineId;
  direction: Direction;
  stop: string;
  zone: Zone;
  kind: ReportKind;
  incidentType: IncidentType | null;
  note: string | null;
  createdAt: number;
  lastConfirmedAt: number;
  confirmations: number;
  sourceToken: string | null;
};
type RemovedReport = { report: Report; index: number };
type LiveTram = {
  service: string;
  route: 1 | 2;
  direction: 1 | 2;
  coordinate: { lat: number; lon: number };
  remainingMinutes: number | null;
  atTerminal: boolean;
  departureMinutes: number | null;
  nextStop: string;
  nextStopDescription: string;
  destinationStop: string;
  destinationStopDescription: string;
  orderStop: number | null;
};
type LiveTramsResponse = {
  stale?: boolean;
  source: string;
  fetchedAt: string | null;
  trams: LiveTram[];
  error?: string;
};
type LiveOccupancy = {
  service: string;
  vehicle: number | null;
  load: number;
  sourceAt: string | null;
};
type LiveOccupancyResponse = {
  stale?: boolean;
  fetchedAt: string | null;
  occupancy: LiveOccupancy[];
  error?: string;
};
type OccupancyHistoryPoint = {
  weekday: number;
  weekdayLabel: string;
  minuteOfDay: number;
  timeLabel: string;
  medianLoad: number;
  p80Load: number;
  averageLoad: number;
  samples: number;
  daysObserved?: number;
};
type OccupancyHistoryResponse = {
  generatedAt: string | null;
  sampleCount: number;
  observedDays?: number;
  firstSampleAt?: string | null;
  lastSampleAt?: string | null;
  points: OccupancyHistoryPoint[];
  collecting?: boolean;
};
type VisibleTram = LiveTram & {
  displayStop: string;
  displayDestination: string;
  mapStop: string | null;
  occupancy: LiveOccupancy | null;
};

type TramFocusRequest = { key: string; nonce: number };

type ReportsResponse = { reports: Report[]; error?: string };
type ReportMutationResponse = {
  report?: Report | null;
  removed?: boolean;
  error?: string;
  noteIssue?: string;
  retryAfterMinutes?: number;
  retryAfterSeconds?: number;
};

const LIFETIME = 15 * 60 * 1000;
const CONFIRM_COOLDOWN = 10 * 60 * 1000;
const CONFIRM_STORAGE_KEY = 'alerta-tram-confirmations-v1';
const DEVICE_STORAGE_KEY = 'alerta-tram-device-v1';
const LANGUAGE_STORAGE_KEY = 'alerta-tram-language-v1';
const COMMUNITY_TERMS_STORAGE_KEY = 'alerta-tram-community-terms-v1';
const HIDDEN_REPORTS_STORAGE_KEY = 'alerta-tram-hidden-reports-v1';
const BLOCKED_SOURCES_STORAGE_KEY = 'alerta-tram-blocked-sources-v1';

function tramIdentity(tram: Pick<LiveTram, 'route' | 'direction' | 'service'>) {
  return `${tram.route}:${tram.direction}:${tram.service}`;
}

function centerTramMarker(marker: HTMLElement) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const routeMap = marker.closest<HTMLElement>('.route-map');
  const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

  if (!routeMap) {
    marker.scrollIntoView({ behavior, block: 'center', inline: 'nearest' });
    return;
  }

  const markerRect = marker.getBoundingClientRect();
  const mapRect = routeMap.getBoundingClientRect();
  const desiredLeft = routeMap.scrollLeft + markerRect.left - mapRect.left
    - ((routeMap.clientWidth - markerRect.width) / 2);
  const maximumLeft = Math.max(0, routeMap.scrollWidth - routeMap.clientWidth);
  const clampedLeft = Math.min(maximumLeft, Math.max(0, desiredLeft));
  const desiredTop = window.scrollY + markerRect.top - ((window.innerHeight - markerRect.height) / 2);

  routeMap.scrollTo({ left: clampedLeft, behavior });
  window.scrollTo({ top: Math.max(0, desiredTop), behavior });
}
const NOTIFICATION_STORAGE_KEY = 'alerta-tram-notifications-v1';
const NOTIFICATION_SENT_KEY = 'alerta-tram-notification-sent-v1';
const NOTIFICATION_COOLDOWN = 30 * 60 * 1000;
const LIVE_REFRESH = 10_000;
const REPORT_REFRESH = 10_000;
const MANUAL_REFRESH_COOLDOWN = 3_000;
const HISTORY_REQUIRED_DAYS = 14;
const HISTORY_REQUIRED_WEEKDAY_DAYS = 10;
const HISTORY_REQUIRED_BUCKET_SAMPLES = 50;
const stopCodes: Record<string, string> = {
  'La Trinidad': 'TRI',
  'Padre Anchieta': 'ANC',
  'Cruz de Piedra': 'CPI',
  'Museo de la Ciencia': 'MCI',
  Gracia: 'GRA',
  'Campus Guajara': 'GUA',
  'Las Mantecas': 'MAN',
  'Hospital Universitario': 'HOS',
  'El Cardonal': 'CAR',
  Taco: 'TAC',
  'Hospital La Candelaria': 'CAN',
  'Príncipes de España': 'PPE',
  Chimisay: 'CHI',
  Conservatorio: 'CON',
  'Cruz del Señor': 'CRS',
  'Puente Zurita': 'ZUR',
  'La Paz': 'PAZ',
  Weyler: 'WEY',
  'Teatro Guimerá': 'GUI',
  Fundación: 'FUN',
  Intercambiador: 'INT',
  'La Cuesta': 'CUE',
  Ingenieros: 'ING',
  'San Jerónimo': 'JER',
  Tíncer: 'TIN',
};
const lines = {
  L1: {
    name: 'Trinidad — Santa Cruz',
    directions: { ida: 'Intercambiador', vuelta: 'La Trinidad' },
    stops: [
      'La Trinidad', 'Padre Anchieta', 'Cruz de Piedra', 'Museo de la Ciencia',
      'Gracia', 'Campus Guajara', 'Las Mantecas', 'Hospital Universitario',
      'El Cardonal', 'Taco', 'Hospital La Candelaria', 'Príncipes de España',
      'Chimisay', 'Conservatorio', 'Cruz del Señor', 'Puente Zurita', 'La Paz',
      'Weyler', 'Teatro Guimerá', 'Fundación', 'Intercambiador',
    ],
  },
  L2: {
    name: 'La Cuesta — Tíncer',
    directions: { ida: 'Tíncer', vuelta: 'La Cuesta' },
    stops: ['La Cuesta', 'Ingenieros', 'Hospital Universitario', 'El Cardonal', 'San Jerónimo', 'Tíncer'],
  },
};
const defaultNotificationPreferences: NotificationPreferences = {
  enabled: false,
  line: 'L1',
  direction: 'ida',
  threshold: 'high',
  quietStart: '22:00',
  quietEnd: '07:00',
};

function recordMetric(event: MetricEvent, language: Language) {
  void fetch('/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, language }),
    keepalive: true,
  }).catch(() => { /* Metrics must never interrupt the product experience. */ });
}

const copy = {
  es: {
    tagline: 'Tenerife · movilidad en directo', network: 'Red conectada', info: 'Info', touristGuide: 'Guía turista', alerts: 'Alertas', openAlerts: 'Configurar mis alertas',
    openInfo: 'Abrir información', languageSelector: 'Seleccionar idioma', activeOne: 'aviso activo', activeMany: 'avisos activos', inNetwork: 'en la red',
    heroLead: 'El tranvía,', heroAccent: 'sin sorpresas.', heroCopy: 'Posiciones oficiales en tiempo real y avisos recientes compartidos por viajeros de Tenerife.',
    heroNote: 'Las posiciones se actualizan automáticamente. Los avisos caducan si nadie los confirma.', tramIllustration: 'Ilustración de un tranvía moderno articulado de Tenerife', inService: 'En circulación',
    visitorKicker: '¿Visitas Tenerife?', visitorTitle: 'Tu primera ruta en tranvía, resuelta.', visitorCopy: 'Billetes, validación y recorrido explicados en tres pasos, sin crear una cuenta.', openGuide: 'Abrir guía',
    chooseLine: 'Seleccionar línea', stops: 'paradas', line: 'Línea', liveMap: 'mapa operativo', toward: 'Hacia', changeDirection: 'Cambiar sentido',
    connecting: 'Conectando con TranvíaOnline…', inCirculation: 'tranvías en circulación', source: 'Fuente: Cabildo de Tenerife y Metrotenerife · CC BY', updated: 'actualizadas',
    sourceFallback: 'Datos del Cabildo de Tenerife y Metrotenerife · licencia CC BY · actualización cada 10 segundos.', refreshing: 'Actualizando…', updateNow: 'Actualizar ahora',
    refreshAria: 'Actualizar ahora las posiciones de los tranvías', officialSource: 'Fuente oficial', liveRouteAction: 'RECORRIDO EN DIRECTO · TOCA UNA PARADA PARA AVISAR',
    tramOne: 'tranvía', tramMany: 'tranvías', approaching: 'aproximándose a', liveMapAria: 'Mapa en directo de la línea', reportAt: 'Avisar de un control en',
    service: 'SERVICIO', nextStop: 'PRÓXIMA PARADA', showOnRoute: 'Ver en la línea', tramCentered: (service: string) => `Tranvía ${service} centrado en el recorrido.`, tramPositionUnavailable: 'La posición de este tranvía no está disponible en el recorrido.', noTrams: 'No hay tranvías oficiales publicados en este sentido ahora mismo.', communityAlerts: 'Avisos de la comunidad',
    activeDirection: 'activos en este sentido', controlLocated: 'CONTROL LOCALIZADO', near: 'Cerca de', lastUpdated: 'Actualizado', direction: 'Dirección', confirmations: 'confirmaciones',
    reliability: 'Fiabilidad', reliabilityHigh: 'alta', reliabilityMedium: 'media', reliabilityNew: 'nueva', hideInfo: 'Ocultar información', moreInfo: 'Más información',
    detected: 'Detectado', lastConfirmation: 'Última confirmación', expires: 'Caduca', inMinutes: 'en', stillThere: '¿Sigue ahí?', yesStillThere: '✓ Sí, sigue', confirmed: 'Confirmado', noLongerThere: 'Ya no está',
    noRecentAlerts: 'Sin inspecciones recientes', noRecentAlertsCopy: 'No hay inspecciones de billetes comunicadas en este sentido durante los últimos 15 minutos.', reportControl: 'Avisar de una inspección', reportIncident: 'Reportar incidencia', approximateLocation: 'Ubicación aproximada en la red',
    newReport: 'Nuevo aviso', formIntro: 'Solo ubicación aproximada. No publiques fotos ni descripciones de personas.', directionField: 'Dirección', stopField: 'Parada donde están', tramArea: 'Zona del tranvía',
    zoneFront: 'Delante', zoneMiddle: 'Zona central', zoneBack: 'Detrás', formNote: 'El aviso se comparte con la comunidad y caduca automáticamente.', publishAlert: 'Publicar aviso',
    inspectionTab: 'Inspecciones', incidentsTab: 'Incidencias', reportType: 'Tipo de aviso', inspection: 'Inspección de billetes', incident: 'Incidencia de servicio', inspectionDescription: 'Personal comprobando títulos de transporte.', incidentDescription: 'Problema observado que afecta al viaje.', newInspection: 'Avisar de una inspección', newIncident: 'Reportar una incidencia', inspectionFormIntro: 'Indica dónde has visto una inspección de billetes. Comparte solo la ubicación aproximada; nunca fotos ni descripciones de personas.', incidentFormIntro: 'Comparte una incidencia del servicio que estés observando. Para emergencias o peligro inmediato, avisa al personal y llama al 112.', incidentTypeField: 'Tipo de incidencia', incidentDisruption: 'Interrupción o retraso', incidentCrowding: 'Aglomeración excepcional', incidentAccessibility: 'Problema de accesibilidad', incidentOther: 'Otra incidencia de servicio', publishInspection: 'Publicar inspección', publishIncident: 'Publicar incidencia', inspectionLocated: 'INSPECCIÓN DE BILLETES', incidentReported: 'INCIDENCIA COMUNITARIA', noRecentIncidents: 'Sin incidencias recientes', noRecentIncidentsCopy: 'No hay incidencias comunitarias activas en este sentido.', stillHappening: '¿Sigue ocurriendo?', yesStillHappening: '✓ Sí, continúa', incidentResolved: 'Ya está resuelta', emergencyNote: 'No es un canal de emergencias ni una fuente oficial.',
    incidentNote: '¿Qué está pasando?', incidentNotePlaceholder: 'Ej.: máquina expendedora fuera de servicio', incidentNoteHint: 'Entre 5 y 160 caracteres. No incluyas nombres, datos personales, enlaces ni contactos.',
    flagContent: 'Denunciar contenido', hideContent: 'Ocultar para mí', blockSource: 'Bloquear esta fuente', hiddenLocally: 'El aviso se ha ocultado solo en este dispositivo.', localHideUndone: 'El aviso vuelve a mostrarse en este dispositivo.', sourceBlocked: 'Los avisos de esa fuente se han bloqueado en este dispositivo.', sourceBlockUndone: 'Los avisos de esa fuente vuelven a mostrarse.', flagTitle: 'Denunciar este aviso', flagIntro: 'Ayúdanos a retirar contenido que incumpla las normas. No uses esta opción solo porque el aviso ya haya terminado.', flagReason: 'Motivo', flagPersonalData: 'Incluye datos personales', flagSpam: 'Es falso o spam', flagInappropriate: 'Contenido inapropiado', submitFlag: 'Enviar denuncia', flagThanks: 'Denuncia recibida. Gracias por ayudar a cuidar la comunidad.', flagHidden: 'El aviso se ha ocultado temporalmente para revisión.', flagError: 'No se pudo enviar la denuncia o ya la habías enviado.',
    communityConsentStart: 'He leído y acepto las', communityConsentJoin: 'y las', communityConsentEnd: 'antes de publicar.', communityConsentError: 'Debes aceptar las normas y condiciones para compartir un aviso.',
    howItWorks: 'Cómo funciona', infoP1: 'Alerta Tram es un prototipo comunitario e independiente. Los avisos son aproximados, pueden estar equivocados y desaparecen 15 minutos después de la última confirmación.',
    infoP2: 'Las posiciones y tiempos de los tranvías proceden de TranvíaOnline. Datos atribuidos al Cabildo de Tenerife y a Metrotenerife, reutilizados bajo licencia Creative Commons Atribución (CC BY).',
    infoP3: 'Los avisos de controles pertenecen exclusivamente a la comunidad y no representan información oficial. El mapa no publica fotografías ni datos personales de trabajadores y no sustituye la obligación de viajar con un título válido.',
    understood: 'Entendido', close: 'Cerrar', undo: 'Deshacer',
    guideTitle: 'Guía rápida para visitantes', guideIntro: 'Consulta tranvías y paradas aquí sin registro. Para viajar necesitas siempre un título válido emitido por los canales oficiales.',
    guideStep1Title: 'Elige línea y sentido', guideStep1Copy: 'La Línea 1 une La Trinidad con Santa Cruz. La Línea 2 conecta La Cuesta con Tíncer. Comprueba el destino antes de subir.',
    guideStep2Title: 'Compra un billete válido', guideStep2Copy: 'Puedes utilizar ten+móvil o comprar y recargar una tarjeta ten+ en las máquinas de las paradas. Consulta precios y condiciones oficiales.',
    guideStep3Title: 'Valida cada viaje', guideStep3Copy: 'Valida el título siguiendo las indicaciones del sistema ten+ antes de viajar y consérvalo durante todo el trayecto.',
    officialFares: 'Ver billetes y tarifas oficiales', independentGuide: 'Alerta Tram es independiente y no vende ni valida billetes.',
    positionsUnavailable: 'Posiciones no disponibles', connectionError: 'No se puede conectar ahora con TranvíaOnline. Reintentando…',
    occupancy: 'Ocupación', occupancyLow: 'Poco ocupado', occupancyMedium: 'Ocupación media', occupancyHigh: 'Bastante lleno', occupancyVeryHigh: 'Muy lleno', occupancyUnavailable: 'Sin dato de ocupación',
    typicalCrowding: 'Ocupación habitual', workdays: 'Día laborable típico', historyIntro: 'Estimación a partir de las mediciones reales de los últimos 30 días.', historyCollecting: 'Estamos guardando una muestra por minuto. La gráfica aparecerá cuando haya suficiente histórico real.', historySamples: 'muestras', historyMedian: 'ocupación mediana', busiestTime: 'Franja más concurrida', morningPeak: 'Punta de mañana', afternoonPeak: 'Punta de tarde', preliminary: 'Datos preliminares', historyLearning: 'Todavía aprendiendo', historyReady: 'Cobertura suficiente', historyCoverage: (days: number, required: number) => `${days} de ${required} días mínimos`, historyCoverageReady: (days: number) => `${days} días observados`, historyQualityRule: 'Las horas punta solo aparecen cuando cada franja reúne al menos 10 días laborables y 50 muestras.', historyEvidence: (days: number, samples: number) => `${days} días · ${samples} muestras`,
    alertsTitle: 'Mis alertas', alertsIntro: 'Recibe un aviso cuando los tranvías de tu trayecto superen el nivel de ocupación elegido.', alertsPrivacy: 'El servidor guarda solo la suscripción técnica necesaria; las notificaciones viajan cifradas y no requieren cuenta. En iPhone o iPad, instala primero la PWA en la pantalla de inicio.', notificationsOn: 'Notificaciones activadas', backgroundNotificationsOn: 'Alertas en segundo plano activadas', localNotificationsOn: 'Alertas activas mientras la web esté abierta', notificationsOff: 'Notificaciones desactivadas', notificationsBlocked: 'Notificaciones bloqueadas en este navegador', notificationsUnsupported: 'Este navegador no admite notificaciones', enableNotifications: 'Activar notificaciones', disableNotifications: 'Desactivar', testNotification: 'Enviar prueba', testingNotification: 'Enviando…', testSent: 'Prueba enviada. Deberías recibirla en unos segundos.', testCooldown: 'Ya enviaste una prueba recientemente. Espera 5 minutos.', testFailed: 'No se pudo entregar la prueba. Prueba a desactivar y activar las alertas.', alertLine: 'Línea vigilada', alertDirection: 'Sentido vigilado', alertThreshold: 'Avisar a partir de', alertHigh: 'Bastante lleno · 60%', alertVeryHigh: 'Muy lleno · 80%', quietHours: 'Horario silencioso', quietFrom: 'Desde', quietUntil: 'Hasta', saveAlerts: 'Guardar preferencias', alertsSaved: 'Preferencias de alertas guardadas.', pushFallback: 'No se pudo activar el segundo plano. Los avisos funcionarán mientras la web permanezca abierta.', permissionDenied: 'El navegador ha bloqueado las notificaciones. Puedes habilitarlas desde sus ajustes.', notificationTestTitle: 'Alertas activadas', notificationTestBody: 'Te avisaremos cuando tu trayecto alcance el nivel de ocupación elegido.', crowdingNotificationTitle: 'Tranvía con alta ocupación', crowdingNotificationBody: (service: string, destination: string, load: number) => `Servicio ${service} hacia ${destination}: ${load}% de ocupación.`,
    alreadyConfirmed: (minutes: number) => `Ya has confirmado este aviso. Podrás hacerlo otra vez en ${minutes} min.`,
    confirmationAdded: 'Confirmación añadida. La señal seguirá activa 15 minutos.', removed: 'Has indicado que el control ya no está ahí.', restored: 'Acción deshecha. El aviso vuelve a estar activo.', published: 'Aviso compartido durante 15 minutos.', reportsUnavailable: 'No se pudo sincronizar el aviso. Inténtalo de nuevo.', reportCooldown: 'Espera un momento antes de publicar otro aviso.', estimatedDeparture: (minutes: number) => minutes === 1 ? 'Salida estimada en 1 min' : `Salida estimada en ${minutes} min`,
    deviceRestricted: 'Tu participación está pausada por moderación durante un máximo de 24 horas. Puedes seguir consultando el mapa y enviar un comentario privado desde Ayúdanos a mejorar.',
    privacy: 'Privacidad', dataDeletion: 'Eliminar mis datos', terms: 'Condiciones', communityRules: 'Normas de la comunidad', footerIndependent: 'Proyecto comunitario independiente · No afiliado a Metropolitano de Tenerife ni al Cabildo de Tenerife.',
  },
  en: {
    tagline: 'Tenerife · live mobility', network: 'Network online', info: 'Info', touristGuide: 'Visitor guide', alerts: 'Alerts', openAlerts: 'Configure my alerts',
    openInfo: 'Open information', languageSelector: 'Select language', activeOne: 'active alert', activeMany: 'active alerts', inNetwork: 'across the network',
    heroLead: 'Tenerife tram,', heroAccent: 'made simple.', heroCopy: 'Official live tram positions and recent community alerts shared by people travelling around Tenerife.',
    heroNote: 'Positions refresh automatically. Community alerts expire unless someone confirms them.', tramIllustration: 'Illustration of a modern articulated Tenerife tram', inService: 'In service',
    visitorKicker: 'Visiting Tenerife?', visitorTitle: 'Your first tram journey, sorted.', visitorCopy: 'Tickets, validation and routes explained in three steps. No account needed.', openGuide: 'Open guide',
    chooseLine: 'Select a line', stops: 'stops', line: 'Line', liveMap: 'live route map', toward: 'Towards', changeDirection: 'Change direction',
    connecting: 'Connecting to TranvíaOnline…', inCirculation: 'trams in service', source: 'Source: Cabildo de Tenerife and Metrotenerife · CC BY', updated: 'updated',
    sourceFallback: 'Data from Cabildo de Tenerife and Metrotenerife · CC BY licence · refreshes every 10 seconds.', refreshing: 'Refreshing…', updateNow: 'Refresh now',
    refreshAria: 'Refresh live tram positions now', officialSource: 'Official source', liveRouteAction: 'LIVE ROUTE · TAP A STOP TO POST AN ALERT',
    tramOne: 'tram', tramMany: 'trams', approaching: 'approaching', liveMapAria: 'Live map for line', reportAt: 'Report a ticket inspection at',
    service: 'SERVICE', nextStop: 'NEXT STOP', showOnRoute: 'Show on route', tramCentered: (service: string) => `Tram ${service} centred on the route.`, tramPositionUnavailable: 'This tram’s position is not available on the route.', noTrams: 'No official trams are currently listed in this direction.', communityAlerts: 'Community alerts',
    activeDirection: 'active in this direction', controlLocated: 'TICKET INSPECTION REPORTED', near: 'Near', lastUpdated: 'Updated', direction: 'Direction', confirmations: 'confirmations',
    reliability: 'Confidence', reliabilityHigh: 'high', reliabilityMedium: 'medium', reliabilityNew: 'new', hideInfo: 'Hide details', moreInfo: 'More details',
    detected: 'First reported', lastConfirmation: 'Last confirmed', expires: 'Expires', inMinutes: 'in', stillThere: 'Still there?', yesStillThere: '✓ Yes, still there', confirmed: 'Confirmed', noLongerThere: 'No longer there',
    noRecentAlerts: 'No recent inspections', noRecentAlertsCopy: 'No ticket inspections have been reported in this direction during the last 15 minutes.', reportControl: 'Report a ticket inspection', reportIncident: 'Report an incident', approximateLocation: 'Approximate network location',
    newReport: 'New alert', formIntro: 'Share only an approximate location. Do not post photos or descriptions of people.', directionField: 'Direction', stopField: 'Stop where they are', tramArea: 'Area of the tram',
    zoneFront: 'Front', zoneMiddle: 'Middle', zoneBack: 'Rear', formNote: 'The alert is shared with the community and expires automatically.', publishAlert: 'Publish alert',
    inspectionTab: 'Inspections', incidentsTab: 'Incidents', reportType: 'Report type', inspection: 'Ticket inspection', incident: 'Service incident', inspectionDescription: 'Staff checking passengers’ tickets.', incidentDescription: 'An observed problem affecting the journey.', newInspection: 'Report a ticket inspection', newIncident: 'Report a service incident', inspectionFormIntro: 'Say where you saw staff checking tickets. Share only an approximate location—never photos or descriptions of people.', incidentFormIntro: 'Share a service incident you are currently observing. For emergencies or immediate danger, alert staff and call 112.', incidentTypeField: 'Incident type', incidentDisruption: 'Disruption or delay', incidentCrowding: 'Exceptional crowding', incidentAccessibility: 'Accessibility problem', incidentOther: 'Other service incident', publishInspection: 'Publish inspection', publishIncident: 'Publish incident', inspectionLocated: 'TICKET INSPECTION', incidentReported: 'COMMUNITY INCIDENT', noRecentIncidents: 'No recent incidents', noRecentIncidentsCopy: 'There are no active community incidents in this direction.', stillHappening: 'Still happening?', yesStillHappening: '✓ Yes, ongoing', incidentResolved: 'It is resolved', emergencyNote: 'This is not an emergency channel or an official source.',
    incidentNote: 'What is happening?', incidentNotePlaceholder: 'Example: ticket machine out of service', incidentNoteHint: 'Use 5–160 characters. Do not include names, personal information, links or contact details.',
    flagContent: 'Report content', hideContent: 'Hide for me', blockSource: 'Block this source', hiddenLocally: 'This report is hidden on this device only.', localHideUndone: 'The report is visible again on this device.', sourceBlocked: 'Reports from that source are blocked on this device.', sourceBlockUndone: 'Reports from that source are visible again.', flagTitle: 'Report this alert', flagIntro: 'Help us remove content that breaks the rules. Do not use this option merely because the alert has ended.', flagReason: 'Reason', flagPersonalData: 'Contains personal information', flagSpam: 'False or spam', flagInappropriate: 'Inappropriate content', submitFlag: 'Submit report', flagThanks: 'Report received. Thank you for helping protect the community.', flagHidden: 'The alert has been temporarily hidden for review.', flagError: 'The report could not be submitted or you already submitted it.',
    communityConsentStart: 'I have read and accept the', communityConsentJoin: 'and the', communityConsentEnd: 'before posting.', communityConsentError: 'You must accept the guidelines and terms before sharing a report.',
    howItWorks: 'How it works', infoP1: 'Alerta Tram is an independent community prototype. Alerts are approximate, may be wrong and disappear 15 minutes after the latest confirmation.',
    infoP2: 'Tram positions and arrival times come from TranvíaOnline. Data is attributed to Cabildo de Tenerife and Metrotenerife and reused under the Creative Commons Attribution licence (CC BY).',
    infoP3: 'Ticket-inspection alerts are provided solely by the community and are not official information. The map does not publish photographs or personal information about staff, and it does not replace the requirement to travel with a valid ticket.',
    understood: 'Got it', close: 'Close', undo: 'Undo',
    guideTitle: 'Quick visitor guide', guideIntro: 'Check trams and stops here without registering. You must always have a valid ticket issued through official channels before travelling.',
    guideStep1Title: 'Choose a line and direction', guideStep1Copy: 'Line 1 runs between La Trinidad and Santa Cruz. Line 2 connects La Cuesta and Tíncer. Check the destination before boarding.',
    guideStep2Title: 'Get a valid ticket', guideStep2Copy: 'Use ten+móvil or buy and top up a ten+ card at tram-stop machines. Check the official prices and conditions before purchasing.',
    guideStep3Title: 'Validate every journey', guideStep3Copy: 'Validate your ticket as instructed by the ten+ system before travelling and keep it available throughout your journey.',
    officialFares: 'View official tickets and fares', independentGuide: 'Alerta Tram is independent and does not sell or validate tickets.',
    positionsUnavailable: 'Positions unavailable', connectionError: 'TranvíaOnline is currently unavailable. Retrying…',
    occupancy: 'Occupancy', occupancyLow: 'Quiet', occupancyMedium: 'Moderately busy', occupancyHigh: 'Busy', occupancyVeryHigh: 'Very busy', occupancyUnavailable: 'Occupancy unavailable',
    typicalCrowding: 'Usual crowding', workdays: 'Typical weekday', historyIntro: 'Estimate based on real measurements from the last 30 days.', historyCollecting: 'We are saving one sample per minute. The chart will appear once there is enough real history.', historySamples: 'samples', historyMedian: 'median occupancy', busiestTime: 'Busiest period', morningPeak: 'Morning peak', afternoonPeak: 'Evening peak', preliminary: 'Preliminary data', historyLearning: 'Still learning', historyReady: 'Sufficient coverage', historyCoverage: (days: number, required: number) => `${days} of ${required} minimum days`, historyCoverageReady: (days: number) => `${days} days observed`, historyQualityRule: 'Peak times appear only when each period combines at least 10 weekdays and 50 samples.', historyEvidence: (days: number, samples: number) => `${days} days · ${samples} samples`,
    alertsTitle: 'My alerts', alertsIntro: 'Get an alert when trams on your journey exceed your chosen occupancy level.', alertsPrivacy: 'The server stores only the technical subscription required; notifications are encrypted and need no account. On iPhone or iPad, install the PWA on your Home Screen first.', notificationsOn: 'Notifications enabled', backgroundNotificationsOn: 'Background alerts enabled', localNotificationsOn: 'Alerts enabled while the website is open', notificationsOff: 'Notifications disabled', notificationsBlocked: 'Notifications are blocked in this browser', notificationsUnsupported: 'This browser does not support notifications', enableNotifications: 'Enable notifications', disableNotifications: 'Disable', testNotification: 'Send test', testingNotification: 'Sending…', testSent: 'Test sent. You should receive it within a few seconds.', testCooldown: 'You sent a test recently. Please wait 5 minutes.', testFailed: 'The test could not be delivered. Try disabling and enabling alerts again.', alertLine: 'Watched line', alertDirection: 'Watched direction', alertThreshold: 'Notify me from', alertHigh: 'Busy · 60%', alertVeryHigh: 'Very busy · 80%', quietHours: 'Quiet hours', quietFrom: 'From', quietUntil: 'Until', saveAlerts: 'Save preferences', alertsSaved: 'Alert preferences saved.', pushFallback: 'Background delivery could not be enabled. Alerts will work while the website remains open.', permissionDenied: 'Your browser has blocked notifications. You can enable them in its settings.', notificationTestTitle: 'Alerts enabled', notificationTestBody: 'We will notify you when your journey reaches the occupancy level you selected.', crowdingNotificationTitle: 'Busy tram alert', crowdingNotificationBody: (service: string, destination: string, load: number) => `Service ${service} towards ${destination}: ${load}% occupancy.`,
    alreadyConfirmed: (minutes: number) => `You have already confirmed this alert. You can confirm it again in ${minutes} min.`,
    confirmationAdded: 'Confirmation added. The alert will remain active for 15 minutes.', removed: 'You reported that the inspection is no longer there.', restored: 'Undone. The alert is active again.', published: 'Alert shared for 15 minutes.', reportsUnavailable: 'The alert could not be synced. Please try again.', reportCooldown: 'Wait a moment before publishing another alert.', estimatedDeparture: (minutes: number) => minutes === 1 ? 'Estimated departure in 1 min' : `Estimated departure in ${minutes} min`,
    deviceRestricted: 'Moderation has paused your participation for up to 24 hours. You can still view the map and send private feedback through Help us improve.',
    privacy: 'Privacy', dataDeletion: 'Delete my data', terms: 'Terms', communityRules: 'Community guidelines', footerIndependent: 'Independent community project · Not affiliated with Metropolitano de Tenerife or Cabildo de Tenerife.',
  },
} as const;

function ageText(timestamp: number, now: number, language: Language) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (language === 'en') {
    if (minutes === 0) return 'just now';
    if (minutes === 1) return '1 min ago';
    return `${minutes} min ago`;
  }
  if (minutes === 0) return 'ahora mismo';
  if (minutes === 1) return 'hace 1 min';
  return `hace ${minutes} min`;
}

function confidenceLevel(confirmations: number) {
  if (confirmations >= 8) return 'high';
  if (confirmations >= 3) return 'medium';
  return 'new';
}

function arrivalText(minutes: number | null, language: Language, atTerminal = false) {
  if (language === 'en') {
    if (atTerminal) return 'at terminal';
    if (minutes === null) return 'time unavailable';
    if (minutes === 0) return 'arriving';
    if (minutes === 1) return '1 min away';
    return `${minutes} min away`;
  }
  if (atTerminal) return 'en la parada final';
  if (minutes === null) return 'tiempo no disponible';
  if (minutes === 0) return 'llegando';
  if (minutes === 1) return 'a 1 min';
  return `a ${minutes} min`;
}

function occupancyLevel(load: number) {
  if (load <= 30) return 'low';
  if (load <= 55) return 'medium';
  if (load <= 75) return 'high';
  return 'very-high';
}

function isQuietTime(current: Date, start: string, end: string) {
  const minutes = current.getHours() * 60 + current.getMinutes();
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

function quietDurationText(start: string, end: string, language: Language) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const duration = (endTotal - startTotal + 1440) % 1440;
  if (duration === 0) return language === 'en' ? 'Quiet hours are disabled' : 'El horario silencioso está desactivado';
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  if (language === 'en') return `${hours ? `${hours} h` : ''}${hours && minutes ? ' ' : ''}${minutes ? `${minutes} min` : ''} without alerts`;
  return `${hours ? `${hours} h` : ''}${hours && minutes ? ' ' : ''}${minutes ? `${minutes} min` : ''} sin avisos`;
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

async function syncBackgroundPush(preferences: NotificationPreferences, language: Language) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const configResponse = await fetch('/api/push/config', { headers: { Accept: 'application/json' } });
  if (!configResponse.ok) return false;
  const config = (await configResponse.json()) as { publicKey?: unknown };
  if (typeof config.publicKey !== 'string') return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.publicKey),
    });
  }
  const response = await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), preferences: { ...preferences, language } }),
  });
  return response.ok;
}

async function removeBackgroundPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await fetch('/api/push/subscriptions', {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      keepalive: true,
    });
  } finally {
    await subscription.unsubscribe();
  }
}

function communityDeviceId() {
  const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (stored) return stored;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
}

const languagePreference = createPreferenceStore<Language>(LANGUAGE_STORAGE_KEY, 'es', (stored) => (
  stored === 'es' || stored === 'en' ? stored : navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
), (value) => value);
const confirmationsPreference = createPreferenceStore<Record<string, number>>(CONFIRM_STORAGE_KEY, {},
  (raw) => confirmationSnapshot(raw, Date.now(), CONFIRM_COOLDOWN));
const hiddenReportsPreference = createPreferenceStore<string[]>(HIDDEN_REPORTS_STORAGE_KEY, [], (raw) => stringListSnapshot(raw));
const blockedSourcesPreference = createPreferenceStore<string[]>(BLOCKED_SOURCES_STORAGE_KEY, [],
  (raw) => stringListSnapshot(raw, (token) => /^source_[a-f0-9]{16}$/.test(token)));
const communityTermsPreference = createPreferenceStore(COMMUNITY_TERMS_STORAGE_KEY, false,
  (raw) => raw === COMMUNITY_TERMS_VERSION, (accepted) => accepted ? COMMUNITY_TERMS_VERSION : '');

export default function Home() {
  const [language, setLanguage] = usePreference(languagePreference);
  const [line, setLine] = useState<LineId>('L1');
  const [direction, setDirection] = useState<Direction>('ida');
  const [reports, setReports] = useState<Report[]>([]);
  const [confirmationTimes, setConfirmationTimes] = usePreference(confirmationsPreference);
  const [reportOpen, setReportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [touristOpen, setTouristOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [pushMode, setPushMode] = useState<PushMode>('checking');
  const [pushTesting, setPushTesting] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [removedReport, setRemovedReport] = useState<RemovedReport | null>(null);
  const [locallyHiddenReport, setLocallyHiddenReport] = useState<Report | null>(null);
  const [hiddenReportIds, setHiddenReportIds] = usePreference(hiddenReportsPreference);
  const [locallyBlockedSource, setLocallyBlockedSource] = useState<{ token: string; report: Report } | null>(null);
  const [blockedSourceTokens, setBlockedSourceTokens] = usePreference(blockedSourcesPreference);
  const [reportPending, setReportPending] = useState<string | null>(null);
  const { ready, now: clockNow } = useBrowserClock();
  const [reportedNow, setNow] = useState(0);
  const now = Math.max(clockNow, reportedNow);
  const [draftLine, setDraftLine] = useState<LineId>('L1');
  const [draftDirection, setDraftDirection] = useState<Direction>('ida');
  const [draftStop, setDraftStop] = useState(lines.L1.stops[0]);
  const [draftZone, setDraftZone] = useState<Zone>('Zona central');
  const [draftKind, setDraftKind] = useState<ReportKind>('inspection');
  const [draftIncidentType, setDraftIncidentType] = useState<IncidentType>('disruption');
  const [draftIncidentNote, setDraftIncidentNote] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);
  const [noteServerIssue, setNoteServerIssue] = useState<string | null>(null);
  const incidentNoteRef = useRef<HTMLTextAreaElement>(null);
  const communityConsentRef = useRef<HTMLInputElement>(null);
  const [communityTermsAccepted, setCommunityTermsAccepted] = usePreference(communityTermsPreference);
  const [communityTermsTouched, setCommunityTermsTouched] = useState(false);
  const noteValidation = validateIncidentNote(draftIncidentNote);
  const noteIssue = noteServerIssue || (noteTouched && !noteValidation.ok ? noteValidation.issue : null);
  const [reportFilter, setReportFilter] = useState<ReportKind>('inspection');
  const [flagReport, setFlagReport] = useState<Report | null>(null);
  const [flagReason, setFlagReason] = useState<FlagReason>('false_or_spam');
  const [flagPending, setFlagPending] = useState(false);
  const [liveTrams, setLiveTrams] = useState<LiveTram[]>([]);
  const [liveOccupancy, setLiveOccupancy] = useState<LiveOccupancy[]>([]);
  const [history, setHistory] = useState<OccupancyHistoryResponse>({ generatedAt: null, sampleCount: 0, points: [], collecting: true });
  const [liveFetchedAt, setLiveFetchedAt] = useState<number | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [liveRefreshLocked, setLiveRefreshLocked] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [liveStale, setLiveStale] = useState(false);
  const [occupancyFetchedAt, setOccupancyFetchedAt] = useState<number | null>(null);
  const [occupancyUnavailable, setOccupancyUnavailable] = useState(true);
  const liveControllerRef = useRef<AbortController | null>(null);
  const liveUnlockTimerRef = useRef<number | null>(null);
  const tramMarkerRefs = useRef(new Map<string, HTMLSpanElement>());
  const [selectedTramKey, setSelectedTramKey] = useState<string | null>(null);
  const [tramFocusRequest, setTramFocusRequest] = useState<TramFocusRequest | null>(null);
  const [tramMapAnnouncement, setTramMapAnnouncement] = useState('');
  const pageLoadMetricSent = useRef(false);
  const t = copy[language];
  const liveUnavailable = liveError || liveStale || !isFresh(liveFetchedAt, now);
  const occupancyFresh = !occupancyUnavailable && isFresh(occupancyFetchedAt, now);
  const dataWarning = language === 'es'
    ? 'Sin datos recientes. Ocultamos las posiciones y los tiempos hasta recuperar la conexión; esto no significa que el servicio esté interrumpido.'
    : 'No recent data. Positions and times are hidden until the connection recovers; this does not mean the tram service is disrupted.';
  const networkLabel = liveLoading ? t.connecting : liveUnavailable
    ? (language === 'es' ? 'Sin datos en directo' : 'Live data unavailable') : t.network;

  useEffect(() => {
    if (!tramFocusRequest) return;
    const marker = tramMarkerRefs.current.get(tramFocusRequest.key);
    if (marker) centerTramMarker(marker);
  }, [tramFocusRequest]);

  function changeRoute(nextLine: LineId, nextDirection: Direction) {
    if (nextLine === line && nextDirection === direction) return;
    setLine(nextLine);
    setDirection(nextDirection);
    setSelectedTramKey(null);
    setTramFocusRequest(null);
    setTramMapAnnouncement('');
  }

  const showAppNotification = useCallback(async (title: string, body: string, tag: string) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options: NotificationOptions = { body, icon: '/favicon.png', badge: '/favicon.png', tag };
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
        return;
      } catch {
        // Fall through to a regular browser notification.
      }
    }
    new Notification(title, options);
  }, []);

  useEffect(() => {
    if (ready && !pageLoadMetricSent.current) {
      pageLoadMetricSent.current = true;
      recordMetric('page_load', language);
    }
  }, [language, ready]);

  useEffect(() => {
    const onInstalled = () => recordMetric('pwa_installed', language);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [language]);

  useEffect(() => {
    let savedPreferences = defaultNotificationPreferences;
    try {
      const saved = JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || 'null') as Partial<NotificationPreferences> | null;
      if (saved) savedPreferences = { ...defaultNotificationPreferences, ...saved };
    } catch { savedPreferences = defaultNotificationPreferences; }
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    queueMicrotask(() => {
      setNotificationPreferences(savedPreferences);
      setNotificationPermission(permission);
    });
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').then(async () => {
        if (savedPreferences.enabled && permission === 'granted') {
          try {
            const backgroundReady = await syncBackgroundPush(savedPreferences, language);
            setPushMode(backgroundReady ? 'background' : 'local');
          } catch { setPushMode('local'); }
        } else {
          setPushMode('local');
        }
      }).catch(() => setPushMode('local'));
    } else {
      queueMicrotask(() => setPushMode('local'));
    }
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'en'
      ? 'Alerta Tram Tenerife — live trams and community alerts'
      : 'Alerta Tram Tenerife — tranvías y avisos en directo';
  }, [language]);

  useEffect(() => {
    localStorage.removeItem('alerta-tram-reports-v2');
    communityDeviceId();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => { setNotice(''); setRemovedReport(null); setLocallyHiddenReport(null); setLocallyBlockedSource(null); }, 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshLiveTrams = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    liveControllerRef.current?.abort();
    const controller = new AbortController();
    liveControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 9000);
    const requestOptions = {
      cache: 'no-store' as RequestCache,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    };
    return Promise.all([
      fetch('/api/trams', requestOptions),
      fetch('/api/occupancy', requestOptions).catch(() => null),
    ]).then(async ([response, occupancyResponse]) => {
      const payload = (await response.json()) as LiveTramsResponse;
      if (!response.ok || !Array.isArray(payload.trams)) throw new Error(payload.error || t.positionsUnavailable);
      if (liveControllerRef.current !== controller) return;
      setLiveTrams(payload.trams);
      setLiveFetchedAt(timestampMs(payload.fetchedAt));
      setLiveStale(Boolean(payload.stale));
      setOccupancyUnavailable(true);
      if (occupancyResponse?.ok) {
        const occupancyPayload = await occupancyResponse.json().catch(() => null) as LiveOccupancyResponse | null;
        if (liveControllerRef.current !== controller) return;
        if (occupancyPayload && Array.isArray(occupancyPayload.occupancy)) {
          setLiveOccupancy(occupancyPayload.occupancy);
          setOccupancyFetchedAt(timestampMs(occupancyPayload.fetchedAt));
          setOccupancyUnavailable(Boolean(occupancyPayload.stale));
        }
      }
      setNow(Date.now());
      setLiveError(false);
    }).catch(() => {
      if (liveControllerRef.current !== controller) return;
      setLiveError(true);
      setOccupancyUnavailable(true);
    }).finally(() => {
      window.clearTimeout(timeout);
      if (liveControllerRef.current === controller) {
        setLiveLoading(false);
        setLiveRefreshing(false);
      }
    });
  }, [t.positionsUnavailable]);

  const refreshReports = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    return fetch('/api/reports', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = (await response.json()) as ReportsResponse;
        if (response.ok) setReports(payload.reports);
      })
      .catch(() => { /* The next automatic refresh retries silently. */ });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const route = Number(line.slice(1));
    const officialDirection = direction === 'ida' ? 2 : 1;
    void fetch(`/api/occupancy-history?days=30&route=${route}&direction=${officialDirection}&interval=30`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as OccupancyHistoryResponse;
        if (response.ok) setHistory(payload);
      })
      .catch((error) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setHistory({ generatedAt: null, sampleCount: 0, points: [], collecting: true });
        }
      });
    return () => controller.abort();
  }, [line, direction]);

  function changeLanguage(nextLanguage: Language) {
    if (nextLanguage !== language) recordMetric('language_changed', nextLanguage);
    setLanguage(nextLanguage);
  }

  function moveReportFilter(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextFilter: ReportKind = event.key === 'ArrowLeft' || event.key === 'Home' ? 'inspection' : 'incident';
    setReportFilter(nextFilter);
    window.requestAnimationFrame(() => document.getElementById(`community-${nextFilter}-tab`)?.focus());
  }

  function handleManualLiveRefresh() {
    if (liveRefreshing || liveRefreshLocked || document.visibilityState === 'hidden') return;
    setLiveRefreshLocked(true);
    setLiveRefreshing(true);
    void refreshLiveTrams();
    if (liveUnlockTimerRef.current) window.clearTimeout(liveUnlockTimerRef.current);
    liveUnlockTimerRef.current = window.setTimeout(() => {
      setLiveRefreshLocked(false);
      liveUnlockTimerRef.current = null;
    }, MANUAL_REFRESH_COOLDOWN);
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      showNotice(t.permissionDenied);
      return;
    }
    const next = { ...notificationPreferences, enabled: true };
    setNotificationPreferences(next);
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
    let backgroundReady = false;
    try { backgroundReady = await syncBackgroundPush(next, language); } catch { backgroundReady = false; }
    setPushMode(backgroundReady ? 'background' : 'local');
    await showAppNotification(t.notificationTestTitle, t.notificationTestBody, 'alerta-tram-test');
    recordMetric('notifications_enabled', language);
    if (!backgroundReady) showNotice(t.pushFallback);
  }

  async function disableNotifications() {
    const next = { ...notificationPreferences, enabled: false };
    setNotificationPreferences(next);
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
    try { await removeBackgroundPush(); } catch { /* The local preference still disables foreground alerts. */ }
    setPushMode('local');
  }

  async function saveNotificationPreferences() {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notificationPreferences));
    let backgroundReady = pushMode === 'background';
    if (notificationPreferences.enabled && notificationPermission === 'granted') {
      try { backgroundReady = await syncBackgroundPush(notificationPreferences, language); } catch { backgroundReady = false; }
      setPushMode(backgroundReady ? 'background' : 'local');
    }
    showNotice(backgroundReady || !notificationPreferences.enabled ? t.alertsSaved : t.pushFallback);
    setAlertsOpen(false);
  }

  async function sendPushTest() {
    if (pushTesting || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setPushTesting(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) throw new Error('subscription_missing');
      const response = await fetch('/api/push/test', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (response.ok) {
        recordMetric('notification_test_sent', language);
        showNotice(t.testSent);
      }
      else if (response.status === 429) showNotice(t.testCooldown);
      else {
        setPushMode('local');
        showNotice(t.testFailed);
      }
    } catch {
      setPushMode('local');
      showNotice(t.testFailed);
    } finally {
      setPushTesting(false);
    }
  }

  useEffect(() => {
    void refreshLiveTrams();
    const interval = window.setInterval(refreshLiveTrams, LIVE_REFRESH);
    const handleVisibility = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void refreshLiveTrams();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleVisibility);

    return () => {
      liveControllerRef.current?.abort();
      liveControllerRef.current = null;
      if (liveUnlockTimerRef.current) window.clearTimeout(liveUnlockTimerRef.current);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleVisibility);
    };
  }, [refreshLiveTrams]);

  useEffect(() => {
    void refreshReports();
    const interval = window.setInterval(refreshReports, REPORT_REFRESH);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshReports();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshReports]);

  useEffect(() => {
    if (!ready || liveUnavailable || !occupancyFresh || pushMode !== 'local' || !notificationPreferences.enabled || notificationPermission !== 'granted' || liveOccupancy.length === 0) return;
    if (isQuietTime(new Date(), notificationPreferences.quietStart, notificationPreferences.quietEnd)) return;

    const route = Number(notificationPreferences.line.slice(1));
    const watchedDirection = notificationPreferences.direction === 'ida' ? 2 : 1;
    const threshold = notificationPreferences.threshold === 'very-high' ? 80 : 60;
    const matchingTrams = new Set(
      liveTrams
        .filter((tram) => tram.route === route && tram.direction === watchedDirection)
        .map((tram) => tram.service),
    );
    const timestamp = Date.now();
    let sent: Record<string, number> = {};
    try { sent = JSON.parse(localStorage.getItem(NOTIFICATION_SENT_KEY) || '{}') as Record<string, number>; } catch { sent = {}; }
    const candidates = liveOccupancy
      .filter((item) => isFresh(timestampMs(item.sourceAt), timestamp, OCCUPANCY_MAX_AGE_MS) && matchingTrams.has(item.service) && item.load >= threshold && timestamp - (sent[item.service] || 0) >= NOTIFICATION_COOLDOWN)
      .sort((a, b) => b.load - a.load);
    if (candidates.length === 0) return;

    const busiest = candidates[0];
    const destination = lines[notificationPreferences.line].directions[notificationPreferences.direction];
    candidates.forEach((item) => { sent[item.service] = timestamp; });
    localStorage.setItem(NOTIFICATION_SENT_KEY, JSON.stringify(sent));
    void showAppNotification(
      t.crowdingNotificationTitle,
      t.crowdingNotificationBody(busiest.service, destination, busiest.load),
      `alerta-tram-occupancy-${notificationPreferences.line}-${notificationPreferences.direction}`,
    );
  }, [liveOccupancy, liveTrams, liveUnavailable, occupancyFresh, notificationPermission, notificationPreferences, pushMode, ready, showAppNotification, t]);

  const activeReports = useMemo(
    () => reports.filter((item) => now - item.lastConfirmedAt < LIFETIME),
    [reports, now],
  );
  const visibleReports = activeReports
    .filter((item) => item.line === line && item.direction === direction && !hiddenReportIds.includes(item.id) && (!item.sourceToken || !blockedSourceTokens.includes(item.sourceToken)))
    .sort((a, b) => b.lastConfirmedAt - a.lastConfirmedAt);
  const visibleInspectionReports = visibleReports.filter((item) => item.kind === 'inspection');
  const visibleIncidentReports = visibleReports.filter((item) => item.kind === 'incident');
  const filteredReports = reportFilter === 'inspection' ? visibleInspectionReports : visibleIncidentReports;
  const inspectionStops = new Set(visibleInspectionReports.map((item) => item.stop));
  const incidentStops = new Set(visibleIncidentReports.map((item) => item.stop));
  const current = lines[line];
  const officialDirection = direction === 'ida' ? 2 : 1;
  const stopNameByCode = Object.fromEntries(current.stops.map((stop) => [stopCodes[stop], stop]));
  const occupancyByService = new Map((occupancyFresh ? liveOccupancy : [])
    .filter((item) => isFresh(timestampMs(item.sourceAt), now, OCCUPANCY_MAX_AGE_MS))
    .map((item) => [item.service, item]));
  const visibleTrams: VisibleTram[] = (liveUnavailable ? [] : liveTrams)
    .filter((tram) => tram.route === Number(line.slice(1)) && tram.direction === officialDirection)
    .map((tram) => ({
      ...tram,
      // The official feed may already expose the destination of the next trip
      // while a tram is still approaching its current terminal. The raw
      // direction and next-stop fields describe the movement shown right now.
      mapStop: stopNameByCode[tram.nextStop] ?? null,
      displayStop: stopNameByCode[tram.nextStop] ?? tram.nextStopDescription,
      displayDestination: current.directions[direction],
      occupancy: occupancyByService.get(tram.service) ?? null,
    }))
    .sort((a, b) => (a.orderStop ?? 0) - (b.orderStop ?? 0));
  const weekdayHistory = useMemo(() => {
    const buckets = new Map<number, { weighted: number; samples: number; daysObserved: number }>();
    history.points
      .filter((point) => point.weekday < 5 && point.minuteOfDay >= 360 && point.minuteOfDay <= 1320)
      .forEach((point) => {
        const currentBucket = buckets.get(point.minuteOfDay) || { weighted: 0, samples: 0, daysObserved: 0 };
        currentBucket.weighted += point.medianLoad * point.samples;
        currentBucket.samples += point.samples;
        currentBucket.daysObserved += Math.max(0, point.daysObserved ?? 0);
        buckets.set(point.minuteOfDay, currentBucket);
      });
    return [...buckets.entries()].map(([minuteOfDay, bucket]) => ({
      minuteOfDay,
      timeLabel: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
      load: bucket.samples ? Math.round(bucket.weighted / bucket.samples) : 0,
      samples: bucket.samples,
      daysObserved: bucket.daysObserved,
    })).sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  }, [history.points]);
  const historyObservedDays = Math.max(0, history.observedDays ?? 0);
  const historyCoveragePercent = Math.min(100, Math.round((historyObservedDays / HISTORY_REQUIRED_DAYS) * 100));
  const qualifiedWeekdayHistory = weekdayHistory.filter((point) => (
    point.daysObserved >= HISTORY_REQUIRED_WEEKDAY_DAYS
    && point.samples >= HISTORY_REQUIRED_BUCKET_SAMPLES
  ));
  const historyReady = historyObservedDays >= HISTORY_REQUIRED_DAYS && qualifiedWeekdayHistory.length >= 8;
  const busiestBucket = (historyReady ? qualifiedWeekdayHistory : []).reduce<(typeof weekdayHistory)[number] | null>(
    (best, point) => (!best || point.load > best.load ? point : best),
    null,
  );
  const peakPeriods = [
    { key: 'morning', label: t.morningPeak, start: 360, end: 720 },
    { key: 'afternoon', label: t.afternoonPeak, start: 720, end: 1321 },
  ].map((period) => ({
    ...period,
    point: qualifiedWeekdayHistory
      .filter((point) => point.minuteOfDay >= period.start && point.minuteOfDay < period.end)
      .reduce<(typeof weekdayHistory)[number] | null>((best, point) => (!best || point.load > best.load ? point : best), null),
  })).filter((period) => period.point);

  function showNotice(message: string) {
    setRemovedReport(null);
    setLocallyHiddenReport(null);
    setLocallyBlockedSource(null);
    setNotice(message);
  }

  function updateCommunityTermsAcceptance(accepted: boolean) {
    setCommunityTermsAccepted(accepted);
    setCommunityTermsTouched(true);
  }

  function hideReportLocally(report: Report) {
    const next = [...hiddenReportIds.filter((id) => id !== report.id), report.id].slice(-100);
    setHiddenReportIds(next);
    setRemovedReport(null);
    setLocallyBlockedSource(null);
    setLocallyHiddenReport(report);
    setNotice(t.hiddenLocally);
  }

  function undoLocalHide() {
    if (!locallyHiddenReport) return;
    const next = hiddenReportIds.filter((id) => id !== locallyHiddenReport.id);
    setHiddenReportIds(next);
    setLocallyHiddenReport(null);
    setNotice(t.localHideUndone);
  }

  function blockReportSource(report: Report) {
    if (!report.sourceToken) return;
    const next = [...blockedSourceTokens.filter((token) => token !== report.sourceToken), report.sourceToken].slice(-100);
    setBlockedSourceTokens(next);
    setRemovedReport(null);
    setLocallyHiddenReport(null);
    setLocallyBlockedSource({ token: report.sourceToken, report });
    setNotice(t.sourceBlocked);
  }

  function undoSourceBlock() {
    if (!locallyBlockedSource) return;
    const next = blockedSourceTokens.filter((token) => token !== locallyBlockedSource.token);
    setBlockedSourceTokens(next);
    setLocallyBlockedSource(null);
    setNotice(t.sourceBlockUndone);
  }

  function showTramOnRoute(tram: VisibleTram) {
    if (!tram.mapStop) {
      setTramMapAnnouncement(t.tramPositionUnavailable);
      return;
    }
    const key = tramIdentity(tram);
    setSelectedTramKey(key);
    setTramFocusRequest((previous) => ({ key, nonce: (previous?.nonce ?? 0) + 1 }));
    setTramMapAnnouncement(t.tramCentered(tram.service));
  }

  function openReportForm(kind: ReportKind = 'inspection') {
    setDraftLine(line);
    setDraftDirection(direction);
    setDraftStop(lines[line].stops[0]);
    setDraftZone('Zona central');
    setDraftKind(kind);
    setDraftIncidentType('disruption');
    setDraftIncidentNote('');
    setNoteTouched(false);
    setNoteServerIssue(null);
    setCommunityTermsTouched(false);
    setReportOpen(true);
    recordMetric('report_form_opened', language);
  }

  function openReportAtStop(stop: string) {
    setDraftLine(line);
    setDraftDirection(direction);
    setDraftStop(stop);
    setDraftZone('Zona central');
    setDraftKind('inspection');
    setDraftIncidentType('disruption');
    setDraftIncidentNote('');
    setNoteTouched(false);
    setNoteServerIssue(null);
    setCommunityTermsTouched(false);
    setReportOpen(true);
    recordMetric('report_form_opened', language);
  }

  function openTouristGuide() {
    setTouristOpen(true);
    recordMetric('guide_opened', language);
  }

  function changeDraftLine(value: LineId) {
    setDraftLine(value);
    setDraftStop(lines[value].stops[0]);
  }

  async function confirmReport(id: string) {
    if (reportPending) return;
    const timestamp = Date.now();
    const lastConfirmation = confirmationTimes[id] || 0;
    if (timestamp - lastConfirmation < CONFIRM_COOLDOWN) {
      const minutes = Math.max(1, Math.ceil((CONFIRM_COOLDOWN - (timestamp - lastConfirmation)) / 60000));
      showNotice(t.alreadyConfirmed(minutes));
      return;
    }
    setReportPending(id);
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Alerta-Device': communityDeviceId() },
        body: JSON.stringify({ id, action: 'confirm' }),
      });
      const payload = (await response.json()) as ReportMutationResponse;
      if (!response.ok) {
        if (response.status === 429 && payload.retryAfterMinutes) showNotice(t.alreadyConfirmed(payload.retryAfterMinutes));
        else showNotice(payload.error === 'device_restricted' ? t.deviceRestricted : t.reportsUnavailable);
        return;
      }
      if (payload.report) setReports((items) => items.map((item) => item.id === id ? payload.report as Report : item));
      setNow(timestamp);
      setConfirmationTimes((items) => ({ ...items, [id]: timestamp }));
      recordMetric('report_confirmed', language);
      showNotice(t.confirmationAdded);
    } catch { showNotice(t.reportsUnavailable); }
    finally { setReportPending(null); }
  }

  async function dismissReport(id: string) {
    if (reportPending) return;
    const index = reports.findIndex((item) => item.id === id);
    if (index < 0) return;
    setReportPending(id);
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Alerta-Device': communityDeviceId() },
        body: JSON.stringify({ id, action: 'dismiss' }),
      });
      const payload = await response.json() as ReportMutationResponse;
      if (!response.ok) {
        showNotice(payload.error === 'device_restricted' ? t.deviceRestricted : t.reportsUnavailable);
        return;
      }
      setRemovedReport({ report: reports[index], index });
      setReports((items) => items.filter((item) => item.id !== id));
      recordMetric('report_dismissed', language);
      setNotice(t.removed);
    } catch { showNotice(t.reportsUnavailable); }
    finally { setReportPending(null); }
  }

  async function undoDismiss() {
    if (!removedReport || reportPending) return;
    const removed = removedReport;
    setReportPending(removed.report.id);
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Alerta-Device': communityDeviceId() },
        body: JSON.stringify({ id: removed.report.id, action: 'undo' }),
      });
      const payload = (await response.json()) as ReportMutationResponse;
      if (!response.ok || !payload.report) {
        showNotice(payload.error === 'device_restricted' ? t.deviceRestricted : t.reportsUnavailable);
        return;
      }
      setReports((items) => {
        const next = [...items];
        next.splice(Math.min(removed.index, next.length), 0, payload.report as Report);
        return next;
      });
      setRemovedReport(null);
      setNotice(t.restored);
    } catch { showNotice(t.reportsUnavailable); }
    finally { setReportPending(null); }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reportPending) return;
    if (!communityTermsAccepted) {
      setCommunityTermsTouched(true);
      communityConsentRef.current?.focus();
      return;
    }
    const validation = validateIncidentNote(draftIncidentNote);
    if (draftKind === 'incident' && draftIncidentType === 'other' && !validation.ok) {
      setNoteTouched(true);
      setNoteServerIssue(null);
      incidentNoteRef.current?.focus();
      return;
    }
    const normalizedIncidentNote = validation.ok ? validation.note : null;
    const timestamp = Date.now();
    setReportPending('new');
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Alerta-Device': communityDeviceId(), 'X-Alerta-Community-Terms': COMMUNITY_TERMS_VERSION },
        body: JSON.stringify({ line: draftLine, direction: draftDirection, stop: draftStop, zone: draftZone, kind: draftKind, incidentType: draftKind === 'incident' ? draftIncidentType : null, note: draftKind === 'incident' && draftIncidentType === 'other' ? normalizedIncidentNote : null }),
      });
      const payload = (await response.json()) as ReportMutationResponse;
      if (!response.ok || !payload.report) {
        if (payload.error === 'invalid_report_note') {
          setNoteTouched(true);
          setNoteServerIssue(payload.noteIssue || 'length');
          incidentNoteRef.current?.focus();
          return;
        }
        showNotice(payload.error === 'device_restricted' ? t.deviceRestricted
          : payload.error === 'community_terms_required' ? t.communityConsentError
          : payload.retryAfterMinutes ? t.alreadyConfirmed(payload.retryAfterMinutes)
          : response.status === 429 ? t.reportCooldown : t.reportsUnavailable);
        return;
      }
      const report = payload.report;
      setReports((items) => [report, ...items.filter((item) => item.id !== report.id)]);
      setConfirmationTimes((items) => ({ ...items, [report.id]: timestamp }));
      changeRoute(report.line, report.direction);
      setReportFilter(report.kind);
      setNow(timestamp);
      setReportOpen(false);
      recordMetric('report_published', language);
      recordMetric(report.kind === 'inspection' ? 'inspection_published' : 'incident_published', language);
      showNotice(t.published);
    } catch { showNotice(t.reportsUnavailable); }
    finally { setReportPending(null); }
  }

  async function submitFlag() {
    if (!flagReport || flagPending) return;
    setFlagPending(true);
    try {
      const response = await fetch('/api/reports/flags', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Alerta-Device': communityDeviceId() },
        body: JSON.stringify({ id: flagReport.id, reason: flagReason }),
      });
      const payload = await response.json() as { flagged?: boolean; hidden?: boolean; error?: string };
      if (!response.ok || !payload.flagged) {
        showNotice(payload.error === 'device_restricted' ? t.deviceRestricted : t.flagError);
        return;
      }
      if (payload.hidden) setReports((items) => items.filter((item) => item.id !== flagReport.id));
      recordMetric('report_flagged', language);
      setFlagReport(null);
      showNotice(payload.hidden ? t.flagHidden : t.flagThanks);
    } catch { showNotice(t.flagError); }
    finally { setFlagPending(false); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Alerta Tram">
          <span className="brand-tram" aria-hidden="true" />
          <span className="brand-copy"><strong><span>Alerta</span> Tram</strong><small>{t.tagline}</small></span>
        </a>
        <div className="topbar-actions">
          <span className={`network-status ${liveLoading || liveUnavailable ? 'network-unavailable' : ''}`}><i /> {networkLabel}</span>
          <button className={`alerts-button ${notificationPreferences.enabled && notificationPermission === 'granted' ? 'active' : ''}`} type="button" aria-label={t.openAlerts} onClick={() => setAlertsOpen(true)}><span aria-hidden="true">●</span>{t.alerts}</button>
          <div className="language-switch" role="group" aria-label={t.languageSelector}>
            <button type="button" className={language === 'es' ? 'active' : ''} aria-pressed={language === 'es'} onClick={() => changeLanguage('es')}>ES</button>
            <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => changeLanguage('en')}>EN</button>
          </div>
          <button className="icon-button" type="button" aria-label={t.openInfo} onClick={() => setInfoOpen(true)}>{t.info}</button>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-copy-block">
          <p className="eyebrow"><span /> {activeReports.length} {activeReports.length === 1 ? t.activeOne : t.activeMany} {t.inNetwork}</p>
          <h1>{t.heroLead}<br /><em>{t.heroAccent}</em></h1>
          <p className="hero-copy">{t.heroCopy}</p>
          <div className="hero-note"><strong>10 s</strong><span>{t.heroNote}</span></div>
        </div>
        <div className="hero-visual" aria-label={t.tramIllustration} role="img">
          <div className="hero-grid-label"><span>TF · TRAM</span><span>28.46° N</span></div>
          <div className="hero-tram-art" />
          <div className="hero-visual-footer"><span><i /> {liveUnavailable ? networkLabel : t.inService}</span><strong>{liveLoading || liveUnavailable ? '—' : liveTrams.length.toString().padStart(2, '0')}</strong></div>
        </div>
      </section>

      <button className="visitor-strip" type="button" onClick={openTouristGuide}>
        <span className="visitor-mark" aria-hidden="true">✦</span>
        <span className="visitor-copy"><small>{t.visitorKicker}</small><strong>{t.visitorTitle}</strong><span>{t.visitorCopy}</span></span>
        <b>{t.openGuide} <span aria-hidden="true">→</span></b>
      </button>

      <InstallHelp language={language} expanded={installHelpOpen} onExpandedChange={setInstallHelpOpen} />

      <div className="line-switch" aria-label={t.chooseLine}>{(Object.keys(lines) as LineId[]).map((item) => <button className={line === item ? 'active' : ''} type="button" key={item} onClick={() => changeRoute(item, direction)} aria-pressed={line === item}><span>{item}</span><span className="line-switch-copy"><strong>{lines[item].name}</strong><small>{item === 'L1' ? `21 ${t.stops}` : `6 ${t.stops}`}</small></span><b aria-hidden="true">→</b></button>)}</div>

      <section className="live-panel" aria-labelledby="live-title">
        <div className="panel-heading"><div><p className="kicker"><span className={`live-pulse ${liveUnavailable ? 'data-offline' : ''}`} /> {t.line} {line.slice(1)} · {t.liveMap}</p><h2 id="live-title">{t.toward} {current.directions[direction]}</h2></div><button className="direction-button" type="button" onClick={() => changeRoute(line, direction === 'ida' ? 'vuelta' : 'ida')}><span aria-hidden="true">⇅</span> {t.changeDirection}</button></div>

        <div className={`tram-status ${!liveLoading && liveUnavailable ? 'tram-status-error' : ''}`}>
          <TramFigure />
          <div>
            <strong><span className={`official-dot ${liveUnavailable ? 'offline' : ''}`} /> {liveLoading ? t.connecting : liveUnavailable ? networkLabel : `${liveTrams.length} ${t.inCirculation}`}</strong>
            <p>{liveFetchedAt ? `${t.source} · ${language === 'es' ? 'Última consulta correcta' : 'Last successful retrieval'} ${ageText(liveFetchedAt, now, language)}` : t.sourceFallback}</p>
          </div>
          <div className="tram-actions">
            <button className={`live-refresh-button ${liveRefreshing ? 'refreshing' : ''}`} type="button" onClick={handleManualLiveRefresh} disabled={liveRefreshing || liveRefreshLocked} aria-label={t.refreshAria}>
              <span className="refresh-icon" aria-hidden="true">↻</span> {liveRefreshing ? t.refreshing : t.updateNow}
            </button>
            <a href="https://tranviaonline.metrotenerife.com/" target="_blank" rel="noreferrer">{t.officialSource} ↗</a>
          </div>
        </div>

        {!liveLoading && liveUnavailable && <p className="data-warning" role="status">{dataWarning}</p>}
        {!liveLoading && !liveUnavailable && !occupancyFresh && <p className="data-warning" role="status">{language === 'es' ? 'Las posiciones están disponibles, pero no hay datos recientes de ocupación.' : 'Positions are available, but recent occupancy data is unavailable.'}</p>}

        <div className="map-labels"><span>{t.liveRouteAction}</span><span className="direction-legend"><b aria-hidden="true">{officialDirection === 2 ? '→' : '←'}</b> {visibleTrams.length} {visibleTrams.length === 1 ? t.tramOne : t.tramMany} {t.toward.toLocaleLowerCase(language)} {current.directions[direction]}</span></div>
        <div className="route-map" aria-label={`${t.liveMapAria} ${line.slice(1)}`}>
          {current.stops.map((stop, index) => {
            const inspectionAlerted = inspectionStops.has(stop);
            const incidentAlerted = incidentStops.has(stop);
            const alerted = inspectionAlerted || incidentAlerted;
            const tramsHere = visibleTrams.filter((tram) => tram.mapStop === stop);
            const selectedTram = tramsHere.find((tram) => tramIdentity(tram) === selectedTramKey);
            const shownTrams = selectedTram
              ? [selectedTram, ...tramsHere.filter((tram) => tramIdentity(tram) !== selectedTramKey)].slice(0, 2)
              : tramsHere.slice(0, 2);
            const hiddenTrams = tramsHere.filter((tram) => !shownTrams.some((shown) => tramIdentity(shown) === tramIdentity(tram)));
            return <button className="stop" type="button" key={stop} onClick={() => openReportAtStop(stop)} aria-label={`${t.reportAt} ${stop}`}>
              <span className={`rail ${alerted ? 'rail-alert' : ''} ${incidentAlerted ? 'rail-incident' : ''}`}>
                <span className={`dot ${inspectionAlerted ? 'dot-alert' : ''} ${incidentAlerted && !inspectionAlerted ? 'dot-incident' : ''}`} />
                {inspectionAlerted && <span className="control-pin inspection-pin" aria-hidden="true">T</span>}
                {incidentAlerted && <span className={`control-pin incident-pin ${inspectionAlerted ? 'pin-shifted' : ''}`} aria-hidden="true">!</span>}
                {index < current.stops.length - 1 && <span className="track" />}
              </span>
              <span className={`stop-name ${alerted ? 'stop-alert' : ''}`}>{stop}</span>
              {tramsHere.length > 0 && <span className="live-tram-stack" aria-label={`${tramsHere.length} ${tramsHere.length === 1 ? t.tramOne : t.tramMany} ${t.toward.toLocaleLowerCase(language)} ${current.directions[direction]} ${t.approaching} ${stop}`}>
                {shownTrams.map((tram) => {
                  const key = tramIdentity(tram);
                  return <span className={`live-tram-marker direction-${tram.direction} ${selectedTramKey === key ? 'is-selected' : ''}`} key={key} ref={(node) => { if (node) tramMarkerRefs.current.set(key, node); else tramMarkerRefs.current.delete(key); }} data-service={tram.service} data-stop-code={tram.nextStop} title={`${t.service} ${tram.service} · ${t.nextStop.toLocaleLowerCase(language)} ${tram.displayStop} · ${t.toward.toLocaleLowerCase(language)} ${tram.displayDestination} · ${arrivalText(tram.remainingMinutes, language, tram.atTerminal)}${tram.atTerminal && tram.departureMinutes ? ` · ${t.estimatedDeparture(tram.departureMinutes)}` : ''}`}>
                  <span className="marker-direction" aria-hidden="true">{tram.direction === 2 ? '→' : '←'}</span>
                  <span className="marker-service">{tram.service}</span>
                  <TramGlyph compact direction={tram.direction} />
                  <small>{tram.atTerminal ? '•' : tram.remainingMinutes ?? '·'}</small>
                </span>;
                })}
                {hiddenTrams.length > 0 && <span className="live-tram-overflow" title={hiddenTrams.map((tram) => `${t.service} ${tram.service}`).join(' · ')}>+{hiddenTrams.length}</span>}
              </span>}
            </button>;
          })}
        </div>

        <p className="sr-only" role="status" aria-live="polite">{tramMapAnnouncement}</p>
        <div className="live-tram-list" aria-live="polite">
          {visibleTrams.length ? visibleTrams.map((tram) => {
            const level = tram.occupancy ? occupancyLevel(tram.occupancy.load) : null;
            const occupancyLabel = level === 'low' ? t.occupancyLow : level === 'medium' ? t.occupancyMedium : level === 'high' ? t.occupancyHigh : level === 'very-high' ? t.occupancyVeryHigh : t.occupancyUnavailable;
            const key = tramIdentity(tram);
            return <button className="live-tram-card" type="button" key={key} data-service={tram.service} data-stop-code={tram.nextStop} onClick={() => showTramOnRoute(tram)} aria-label={`${t.showOnRoute}: ${t.service} ${tram.service}, ${tram.displayStop}, ${t.toward.toLocaleLowerCase(language)} ${tram.displayDestination}`}>
              <span className={`live-tram-card-icon direction-${tram.direction}`}><TramGlyph compact direction={tram.direction} /><b aria-hidden="true">{tram.direction === 2 ? '→' : '←'}</b></span>
              <span className="live-tram-card-copy"><span className="service-label">{t.service} {tram.service} · {tram.nextStop}</span><strong>{tram.displayStop}</strong><small className="tram-destination"><span aria-hidden="true">{tram.direction === 2 ? '→' : '←'}</span> {t.toward} {tram.displayDestination}</small><small className="tram-map-action">{t.showOnRoute} <span aria-hidden="true">↗</span></small></span>
              <span className="live-tram-arrival"><strong>{arrivalText(tram.remainingMinutes, language, tram.atTerminal)}</strong>{tram.atTerminal && tram.departureMinutes ? <em className="terminal-departure">{t.estimatedDeparture(tram.departureMinutes)}</em> : null}<small>{tram.coordinate.lat.toFixed(5)}, {tram.coordinate.lon.toFixed(5)}</small><span className={`occupancy-badge ${level ? `occupancy-${level}` : 'occupancy-missing'}`}><i aria-hidden="true" /> {occupancyLabel}{tram.occupancy ? ` · ${tram.occupancy.load}%` : ''}</span></span>
            </button>;
          }) : !liveLoading && !liveUnavailable ? <div className="live-tram-empty">{t.noTrams}</div> : null}
        </div>

        <div className="section-divider"><span>02</span><strong>{t.typicalCrowding}</strong><small>{history.sampleCount.toLocaleString(language)} {t.historySamples}</small></div>
        <section className="occupancy-history" aria-labelledby="occupancy-history-title">
          <div className="occupancy-history-heading">
            <div><p>{t.workdays}</p><h3 id="occupancy-history-title">{t.typicalCrowding} · L{line.slice(1)}</h3><small>{t.historyIntro}</small></div>
            {busiestBucket && <span><small>{t.busiestTime}</small><strong>{busiestBucket.timeLabel}</strong><b>{busiestBucket.load}%</b></span>}
          </div>
          {weekdayHistory.length >= 8 ? <>
            <div className={`history-quality ${historyReady ? 'is-ready' : 'is-learning'}`} role="status">
              <span className="history-quality-dot" aria-hidden="true" />
              <div><strong>{historyReady ? t.historyReady : t.historyLearning}</strong><p>{historyReady ? t.historyCoverageReady(historyObservedDays) : t.historyCoverage(historyObservedDays, HISTORY_REQUIRED_DAYS)}. {t.historyQualityRule}</p></div>
              <b>{historyCoveragePercent}%</b>
              <span className="history-coverage" aria-hidden="true"><i style={{ width: `${historyCoveragePercent}%` }} /></span>
            </div>
            {historyReady && <div className="peak-periods" aria-label={t.busiestTime}>
              {peakPeriods.map((period) => period.point && <article key={period.key}>
                <span>{period.label}</span>
                <strong>{period.point.timeLabel}</strong>
                <b>{period.point.load}%</b>
                <small>{t.historyEvidence(period.point.daysObserved, period.point.samples)}</small>
              </article>)}
            </div>}
            <div className="occupancy-chart" role="img" aria-label={`${t.typicalCrowding}: ${current.directions[direction]}`}>
              {weekdayHistory.map((point) => <div className="occupancy-column" key={point.minuteOfDay} title={`${point.timeLabel} · ${point.load}% · ${point.samples} ${t.historySamples}`}><span style={{ height: `${Math.max(5, point.load)}%` }} className={`occupancy-bar occupancy-${occupancyLevel(point.load)}`} /><small>{point.minuteOfDay % 120 === 0 ? point.timeLabel : ''}</small></div>)}
            </div>
            <p className="history-note"><span>{historyReady ? t.historyReady : t.preliminary}</span> · {history.sampleCount.toLocaleString(language)} {t.historySamples} · {t.historyMedian}</p>
          </> : <div className="history-collecting"><span className="history-loader" aria-hidden="true" /><div><strong>{t.preliminary}</strong><p>{t.historyCollecting}</p></div></div>}
        </section>

        <div className="section-divider"><span>03</span><strong>{t.communityAlerts}</strong><small>{visibleReports.length} {t.activeDirection}</small></div>
        <div className="report-filter-row">
          <div className="report-filter" role="tablist" aria-label={t.reportType}>
            <button id="community-inspection-tab" type="button" role="tab" aria-selected={reportFilter === 'inspection'} aria-controls="community-alerts-panel" tabIndex={reportFilter === 'inspection' ? 0 : -1} className={reportFilter === 'inspection' ? 'active' : ''} onKeyDown={moveReportFilter} onClick={() => setReportFilter('inspection')}><span>T</span>{t.inspectionTab}<b>{visibleInspectionReports.length}</b></button>
            <button id="community-incident-tab" type="button" role="tab" aria-selected={reportFilter === 'incident'} aria-controls="community-alerts-panel" tabIndex={reportFilter === 'incident' ? 0 : -1} className={reportFilter === 'incident' ? 'active incident' : ''} onKeyDown={moveReportFilter} onClick={() => setReportFilter('incident')}><span>!</span>{t.incidentsTab}<b>{visibleIncidentReports.length}</b></button>
          </div>
          <button className="report-inline-action" type="button" onClick={() => openReportForm(reportFilter)}>+ {reportFilter === 'inspection' ? t.reportControl : t.reportIncident}</button>
        </div>
        <div id="community-alerts-panel" className="alerts-list" role="tabpanel" aria-labelledby={`community-${reportFilter}-tab`}>
          {filteredReports.length ? filteredReports.map((report) => {
            const expanded = expandedReport === report.id;
            const reportConfidence = confidenceLevel(report.confirmations);
            const confidenceLabel = reportConfidence === 'high' ? t.reliabilityHigh : reportConfidence === 'medium' ? t.reliabilityMedium : t.reliabilityNew;
            const expiresIn = Math.max(1, Math.ceil((LIFETIME - (now - report.lastConfirmedAt)) / 60000));
            const cooldownLeft = Math.max(0, CONFIRM_COOLDOWN - (now - (confirmationTimes[report.id] || 0)));
            const canConfirm = cooldownLeft === 0;
            const cooldownMinutes = Math.max(1, Math.ceil(cooldownLeft / 60000));
            const incidentLabel = report.incidentType === 'crowding' ? t.incidentCrowding : report.incidentType === 'accessibility' ? t.incidentAccessibility : report.incidentType === 'other' ? t.incidentOther : t.incidentDisruption;
            return <article className={`alert-card ${report.kind === 'incident' ? 'incident-card' : 'inspection-card'}`} key={report.id}>
              <div className="alert-icon" aria-hidden="true">{report.kind === 'inspection' ? 'T' : '!'}</div>
              <div className="alert-content">
                <div className="alert-title-row"><div><p>{report.kind === 'inspection' ? t.inspectionLocated : t.incidentReported}</p><h3>{t.near} {report.stop}</h3></div><span className="freshness">{t.lastUpdated} {ageText(report.lastConfirmedAt, now, language)}</span></div>
                <div className="alert-meta"><span>{report.kind === 'inspection' ? (report.zone === 'Delante' ? t.zoneFront : report.zone === 'Detrás' ? t.zoneBack : t.zoneMiddle) : incidentLabel}</span><span>{t.direction} {current.directions[report.direction]}</span><span>{report.confirmations} {t.confirmations}</span><span className={`confidence confidence-${reportConfidence}`}>{t.reliability} {confidenceLabel}</span></div>
                {report.kind === 'incident' && report.note && <p className="incident-note"><span aria-hidden="true">“</span>{report.note}<span aria-hidden="true">”</span></p>}
                <button className="details-button" type="button" aria-expanded={expanded} onClick={() => setExpandedReport(expanded ? null : report.id)}>{expanded ? t.hideInfo : t.moreInfo} <span>{expanded ? '−' : '+'}</span></button>
                {expanded && <div className="report-details"><div><span>{t.detected}</span><strong>{ageText(report.createdAt, now, language)}</strong></div><div><span>{t.lastConfirmation}</span><strong>{ageText(report.lastConfirmedAt, now, language)}</strong></div><div><span>{t.expires}</span><strong>{t.inMinutes} {expiresIn} min</strong></div></div>}
                {expanded && <div className="content-controls"><button className="flag-content-button" type="button" onClick={() => { setFlagReason('false_or_spam'); setFlagReport(report); }}>{t.flagContent}</button><button className="hide-content-button" type="button" onClick={() => hideReportLocally(report)}>{t.hideContent}</button>{report.sourceToken && <button className="block-source-button" type="button" onClick={() => blockReportSource(report)}>{t.blockSource}</button>}</div>}
                <div className="confirm-row"><span>{report.kind === 'inspection' ? t.stillThere : t.stillHappening}</span><button type="button" disabled={!canConfirm || reportPending === report.id} onClick={() => void confirmReport(report.id)}>{canConfirm ? (report.kind === 'inspection' ? t.yesStillThere : t.yesStillHappening) : `${t.confirmed} · ${cooldownMinutes} min`}</button><button type="button" disabled={reportPending === report.id} onClick={() => void dismissReport(report.id)}>{report.kind === 'inspection' ? t.noLongerThere : t.incidentResolved}</button></div>
              </div>
            </article>;
          }) : <div className="empty-state"><span>✓</span><div><strong>{reportFilter === 'inspection' ? t.noRecentAlerts : t.noRecentIncidents}</strong><p>{reportFilter === 'inspection' ? t.noRecentAlertsCopy : t.noRecentIncidentsCopy}</p></div></div>}
        </div>
      </section>

      <footer className="site-footer">
        <a href="/privacy">{t.privacy}</a>
        <a href="/data-deletion">{t.dataDeletion}</a>
        <a href="/terms">{t.terms}</a>
        <a href="/community-guidelines">{t.communityRules}</a>
        <a href="/beta">{language === 'es' ? 'Ayúdanos a mejorar' : 'Help us improve'}</a>
        <p>{t.footerIndependent}</p>
      </footer>

      {!installHelpOpen && <button className="report-button" type="button" aria-label={t.reportControl} onClick={() => openReportForm('inspection')}><span>T</span><span className="report-button-copy"><strong>{t.reportControl}</strong><small>{t.approximateLocation}</small></span></button>}

      {reportOpen && <Modal title={draftKind === 'inspection' ? t.newInspection : t.newIncident} closeLabel={t.close} onClose={() => setReportOpen(false)}>
        <form className="report-form" onSubmit={submitReport} noValidate>
          <fieldset><legend>{t.reportType}</legend><div className="report-kind-options"><button type="button" className={draftKind === 'inspection' ? 'selected' : ''} onClick={() => setDraftKind('inspection')}><span>T</span><strong>{t.inspection}</strong><small>{t.inspectionDescription}</small></button><button type="button" className={draftKind === 'incident' ? 'selected incident' : ''} onClick={() => setDraftKind('incident')}><span>!</span><strong>{t.incident}</strong><small>{t.incidentDescription}</small></button></div></fieldset>
          <p className={`form-intro ${draftKind === 'incident' ? 'incident-intro' : ''}`}>{draftKind === 'inspection' ? t.inspectionFormIntro : t.incidentFormIntro}</p>
          <CustomSelect label={t.line} value={draftLine} options={[{ value: 'L1', label: 'L1 · Trinidad — Santa Cruz' }, { value: 'L2', label: 'L2 · La Cuesta — Tíncer' }]} onChange={changeDraftLine} />
          <CustomSelect label={t.directionField} value={draftDirection} options={[{ value: 'ida', label: `${t.toward} ${lines[draftLine].directions.ida}` }, { value: 'vuelta', label: `${t.toward} ${lines[draftLine].directions.vuelta}` }]} onChange={setDraftDirection} />
          <CustomSelect label={t.stopField} value={draftStop} options={lines[draftLine].stops.map((stop) => ({ value: stop, label: stop }))} onChange={setDraftStop} />
          {draftKind === 'incident' && <CustomSelect label={t.incidentTypeField} value={draftIncidentType} options={[{ value: 'disruption', label: t.incidentDisruption }, { value: 'crowding', label: t.incidentCrowding }, { value: 'accessibility', label: t.incidentAccessibility }, { value: 'other', label: t.incidentOther }]} onChange={setDraftIncidentType} />}
          {draftKind === 'incident' && draftIncidentType === 'other' && <div className="incident-note-field">
            <label htmlFor="incident-note-input">{t.incidentNote}</label>
            <textarea id="incident-note-input" ref={incidentNoteRef} value={draftIncidentNote} minLength={5} maxLength={160} required
              aria-invalid={!!noteIssue} aria-describedby={`incident-note-hint${noteIssue ? ' incident-note-error' : ''}`}
              placeholder={t.incidentNotePlaceholder} onBlur={() => setNoteTouched(true)}
              onChange={(event) => { setDraftIncidentNote(event.target.value); setNoteServerIssue(null); }} />
            <small id="incident-note-hint"><span>{t.incidentNoteHint}</span><b>{draftIncidentNote.length}/160</b></small>
            {noteIssue && <p id="incident-note-error" className="incident-note-error" role="alert">{noteIssueMessage(noteIssue, language)}</p>}
          </div>}
          {draftKind === 'inspection' && <fieldset><legend>{t.tramArea}</legend><div className="zone-options">{(['Delante', 'Zona central', 'Detrás'] as Zone[]).map((zone) => <label className={draftZone === zone ? 'selected' : ''} key={zone}><input type="radio" name="zone" value={zone} checked={draftZone === zone} onChange={() => setDraftZone(zone)} />{zone === 'Delante' ? t.zoneFront : zone === 'Detrás' ? t.zoneBack : t.zoneMiddle}</label>)}</div></fieldset>}
          <div className="form-note"><span>15 min</span> {t.formNote}</div>
          {draftKind === 'incident' && <p className="emergency-note">112 · {t.emergencyNote}</p>}
          <label className={`community-consent ${communityTermsTouched && !communityTermsAccepted ? 'has-error' : ''}`}>
            <input ref={communityConsentRef} type="checkbox" checked={communityTermsAccepted} aria-invalid={communityTermsTouched && !communityTermsAccepted} aria-describedby={communityTermsTouched && !communityTermsAccepted ? 'community-consent-error' : undefined} onChange={(event) => updateCommunityTermsAcceptance(event.target.checked)} />
            <span>{t.communityConsentStart} <a href="/community-guidelines" target="_blank" rel="noreferrer">{t.communityRules}</a> {t.communityConsentJoin} <a href="/terms" target="_blank" rel="noreferrer">{t.terms}</a> {t.communityConsentEnd}</span>
          </label>
          {communityTermsTouched && !communityTermsAccepted && <p id="community-consent-error" className="community-consent-error" role="alert">{t.communityConsentError}</p>}
          <button className="submit-button" type="submit" disabled={reportPending === 'new'}>{draftKind === 'inspection' ? t.publishInspection : t.publishIncident}</button>
        </form>
      </Modal>}

      {flagReport && <Modal title={t.flagTitle} closeLabel={t.close} onClose={() => setFlagReport(null)}><div className="flag-form"><p>{t.flagIntro}</p><CustomSelect label={t.flagReason} value={flagReason} options={[{ value: 'personal_data', label: t.flagPersonalData }, { value: 'false_or_spam', label: t.flagSpam }, { value: 'inappropriate', label: t.flagInappropriate }]} onChange={setFlagReason} /><button className="submit-button" type="button" disabled={flagPending} onClick={() => void submitFlag()}>{t.submitFlag}</button></div></Modal>}

      {alertsOpen && <Modal title={t.alertsTitle} closeLabel={t.close} onClose={() => setAlertsOpen(false)}>
        <div className="notification-settings">
          <p className="form-intro">{t.alertsIntro}</p>
          <div className={`notification-status permission-${notificationPermission} ${notificationPreferences.enabled ? 'enabled' : ''} push-${pushMode}`}><i aria-hidden="true" /><strong>{notificationPermission === 'unsupported' ? t.notificationsUnsupported : notificationPermission === 'denied' ? t.notificationsBlocked : notificationPermission === 'granted' && notificationPreferences.enabled && pushMode === 'background' ? t.backgroundNotificationsOn : notificationPermission === 'granted' && notificationPreferences.enabled && pushMode === 'local' ? t.localNotificationsOn : notificationPermission === 'granted' && notificationPreferences.enabled ? t.notificationsOn : t.notificationsOff}</strong></div>
          <div className="notification-fields">
            <CustomSelect label={t.alertLine} value={notificationPreferences.line} options={[{ value: 'L1', label: 'L1 · Trinidad — Santa Cruz' }, { value: 'L2', label: 'L2 · La Cuesta — Tíncer' }]} onChange={(value) => setNotificationPreferences((currentPreferences) => ({ ...currentPreferences, line: value }))} />
            <CustomSelect label={t.alertDirection} value={notificationPreferences.direction} options={[{ value: 'ida', label: `${t.toward} ${lines[notificationPreferences.line].directions.ida}` }, { value: 'vuelta', label: `${t.toward} ${lines[notificationPreferences.line].directions.vuelta}` }]} onChange={(value) => setNotificationPreferences((currentPreferences) => ({ ...currentPreferences, direction: value }))} />
          </div>
          <fieldset className="notification-threshold"><legend>{t.alertThreshold}</legend><div className="threshold-options">
            {([['high', t.alertHigh], ['very-high', t.alertVeryHigh]] as [OccupancyThreshold, string][]).map(([value, label]) => <label className={notificationPreferences.threshold === value ? 'selected' : ''} key={value}><input type="radio" name="notification-threshold" checked={notificationPreferences.threshold === value} onChange={() => setNotificationPreferences((currentPreferences) => ({ ...currentPreferences, threshold: value }))} /><span><i aria-hidden="true" />{label}</span></label>)}
          </div></fieldset>
          <fieldset className="quiet-hours"><legend>{t.quietHours}</legend><p className="quiet-hint">{language === 'en' ? 'Type the exact time or use +/−. Minute buttons move in 5-minute steps.' : 'Escribe la hora exacta o usa +/−. Los minutos avanzan en pasos de 5.'}</p><div className="quiet-time-grid"><TimePicker label={t.quietFrom} value={notificationPreferences.quietStart} presets={['21:00', '22:00', '23:00']} onChange={(value) => setNotificationPreferences((currentPreferences) => ({ ...currentPreferences, quietStart: value }))} /><b className="quiet-time-arrow" aria-hidden="true">→</b><TimePicker label={t.quietUntil} value={notificationPreferences.quietEnd} presets={['06:00', '07:00', '08:00']} onChange={(value) => setNotificationPreferences((currentPreferences) => ({ ...currentPreferences, quietEnd: value }))} /></div><p className="quiet-duration"><span aria-hidden="true">◷</span>{quietDurationText(notificationPreferences.quietStart, notificationPreferences.quietEnd, language)}</p></fieldset>
          <p className="notification-privacy">{t.alertsPrivacy}</p>
          <a className="install-alerts-link" href="#install-app" onClick={() => { setAlertsOpen(false); setInstallHelpOpen(true); }}>{language === 'es' ? 'Ver cómo instalar en mi móvil →' : 'See how to install on my phone →'}</a>
          <div className="notification-actions">
            {notificationPreferences.enabled && notificationPermission === 'granted'
              ? <button className="notification-toggle disable" type="button" onClick={() => void disableNotifications()}>{t.disableNotifications}</button>
              : <button className="notification-toggle" type="button" disabled={notificationPermission === 'unsupported' || notificationPermission === 'denied'} onClick={() => void enableNotifications()}>{t.enableNotifications}</button>}
            {notificationPreferences.enabled && pushMode === 'background' && <button className="notification-test" type="button" disabled={pushTesting} onClick={() => void sendPushTest()}>{pushTesting ? t.testingNotification : t.testNotification}</button>}
            <button className="submit-button notification-save" type="button" onClick={() => void saveNotificationPreferences()}>{t.saveAlerts}</button>
          </div>
        </div>
      </Modal>}

      {touristOpen && <Modal title={t.guideTitle} closeLabel={t.close} onClose={() => setTouristOpen(false)}><div className="tourist-guide"><p className="guide-intro">{t.guideIntro}</p><div className="guide-steps"><article><span>01</span><div><strong>{t.guideStep1Title}</strong><p>{t.guideStep1Copy}</p></div></article><article><span>02</span><div><strong>{t.guideStep2Title}</strong><p>{t.guideStep2Copy}</p></div></article><article><span>03</span><div><strong>{t.guideStep3Title}</strong><p>{t.guideStep3Copy}</p></div></article></div><a className="guide-link" href={language === 'en' ? 'https://metrotenerife.com/en/tickets-fares/' : 'https://metrotenerife.com/billetes-y-tarifas/'} target="_blank" rel="noreferrer">{t.officialFares} <span aria-hidden="true">↗</span></a><small className="guide-disclaimer">{t.independentGuide}</small></div></Modal>}
      {infoOpen && <Modal title={t.howItWorks} closeLabel={t.close} onClose={() => setInfoOpen(false)}><div className="info-copy"><p>{t.infoP1}</p><p>{t.infoP2}</p><p>{t.infoP3}</p><button className="submit-button" type="button" onClick={() => setInfoOpen(false)}>{t.understood}</button></div></Modal>}
      {notice && <div className="toast" role="status"><span>{notice}</span>{removedReport && <button type="button" disabled={reportPending === removedReport.report.id} onClick={() => void undoDismiss()}>{t.undo}</button>}{locallyHiddenReport && <button type="button" onClick={undoLocalHide}>{t.undo}</button>}{locallyBlockedSource && <button type="button" onClick={undoSourceBlock}>{t.undo}</button>}</div>}
    </main>
  );
}

function CustomSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((option) => option.value === value) || options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selected.value));

  useEffect(() => {
    function close(event: MouseEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => optionButtons.current[selectedIndex]?.focus());
  }, [open, selectedIndex]);

  function closeAndReturnFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeAndReturnFocus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const focusedIndex = optionButtons.current.indexOf(document.activeElement as HTMLButtonElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;
    optionButtons.current[nextIndex]?.focus();
  }

  return <div className={`custom-select ${open ? 'open' : ''}`} ref={root} onKeyDown={handleKeyDown}>
    <span className="select-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} className="select-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} aria-labelledby={`${id}-label ${id}-value`} onClick={() => setOpen((currentOpen) => !currentOpen)}><span id={`${id}-value`}>{selected.label}</span><span className="select-chevron" aria-hidden="true">⌄</span></button>
    {open && <div id={`${id}-listbox`} className="select-list" role="listbox" aria-labelledby={`${id}-label`}>{options.map((option, index) => <button ref={(element) => { optionButtons.current[index] = element; }} type="button" role="option" tabIndex={option.value === value ? 0 : -1} aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} key={option.value} onClick={() => { onChange(option.value); closeAndReturnFocus(); }}><span>{option.label}</span>{option.value === value && <b aria-hidden="true">✓</b>}</button>)}</div>}
  </div>;
}

function TimePicker({ label, value, presets, onChange }: { label: string; value: string; presets: string[]; onChange: (value: string) => void }) {
  const [initialHour, initialMinute] = value.split(':');
  const [hourText, setHourText] = useState(initialHour);
  const [minuteText, setMinuteText] = useState(initialMinute);
  const id = useId();

  function commit(hour: number, minute: number) {
    const total = ((hour * 60 + minute) % 1440 + 1440) % 1440;
    const nextHour = String(Math.floor(total / 60)).padStart(2, '0');
    const nextMinute = String(total % 60).padStart(2, '0');
    setHourText(nextHour);
    setMinuteText(nextMinute);
    onChange(`${nextHour}:${nextMinute}`);
  }

  function adjust(deltaMinutes: number) {
    const [fallbackHour, fallbackMinute] = value.split(':').map(Number);
    const hour = hourText === '' ? fallbackHour : Number(hourText);
    const minute = minuteText === '' ? fallbackMinute : Number(minuteText);
    commit(hour, minute + deltaMinutes);
  }

  function updatePart(part: 'hour' | 'minute', raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, 2);
    if (part === 'hour') setHourText(next);
    else setMinuteText(next);
    if (!next) return;
    const hour = part === 'hour' ? Number(next) : Number(hourText || 0);
    const minute = part === 'minute' ? Number(next) : Number(minuteText || 0);
    if (hour <= 23 && minute <= 59) onChange(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  function normalizeDraft() {
    const hour = Math.min(23, Math.max(0, Number(hourText || 0)));
    const minute = Math.min(59, Math.max(0, Number(minuteText || 0)));
    commit(hour, minute);
  }

  return <div className="time-picker" aria-labelledby={`${id}-label`}>
    <div className="time-picker-heading"><span id={`${id}-label`}>{label}</span><strong>{value}</strong></div>
    <div className="time-dial">
      <div className="time-segment"><button type="button" aria-label={`${label}: +1 h`} onClick={() => adjust(60)}>+</button><input aria-label={`${label}: h`} type="text" inputMode="numeric" maxLength={2} value={hourText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePart('hour', event.target.value)} onBlur={normalizeDraft} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); adjust(event.key === 'ArrowUp' ? 60 : -60); } }} /><button type="button" aria-label={`${label}: −1 h`} onClick={() => adjust(-60)}>−</button><small>h</small></div>
      <span className="time-colon" aria-hidden="true">:</span>
      <div className="time-segment"><button type="button" aria-label={`${label}: +5 min`} onClick={() => adjust(5)}>+</button><input aria-label={`${label}: min`} type="text" inputMode="numeric" maxLength={2} value={minuteText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePart('minute', event.target.value)} onBlur={normalizeDraft} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); adjust(event.key === 'ArrowUp' ? 1 : -1); } }} /><button type="button" aria-label={`${label}: −5 min`} onClick={() => adjust(-5)}>−</button><small>min</small></div>
    </div>
    <div className="time-presets">{presets.map((preset) => <button className={preset === value ? 'active' : ''} type="button" key={preset} onClick={() => { const [hour, minute] = preset.split(':').map(Number); commit(hour, minute); }}>{preset}</button>)}</div>
  </div>;
}

function TramFigure() {
  return <div className="tram-figure" aria-hidden="true" />;
}

function TramGlyph({ compact = false, direction = 2 }: { compact?: boolean; direction?: 1 | 2 }) {
  return <span className={`tram-glyph ${compact ? 'tram-glyph-compact' : ''} ${direction === 1 ? 'tram-glyph-reverse' : ''}`} aria-hidden="true"><span className="tram-glyph-pantograph" /><span className="tram-glyph-cars"><i /><b /><i /><b /><i /><b /><i /><b /><i /></span><span className="tram-glyph-rails" /></span>;
}

function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);

  useEffect(() => { closeHandler.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogElement = dialog.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>(focusableSelector) || []);
    window.requestAnimationFrame(() => (focusableElements()[0] || dialogElement)?.focus());

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        dialogElement?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" aria-label={closeLabel} onClick={onClose}>×</button></div>{children}</section></div>;
}
