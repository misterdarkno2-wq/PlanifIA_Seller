// Los mensajes de error del servidor (funciones SQL, Edge Functions y la cola de IA) están en
// español y se guardan así en la base de datos. En inglés, la app los traduce al mostrarlos: primero
// por coincidencia exacta y luego con patrones para los que llevan números o fechas. Un mensaje que
// no está en la lista se muestra tal cual, así que agregar uno en el servidor nunca rompe nada.
import { lang } from "./i18n.js";

const EXACT = {
  "Acción no encontrada.": "Action not found.",
  "Actividad importada inválida.": "Invalid imported activity.",
  "Archivo de importación inválido o demasiado grande.": "Invalid or too large import file.",
  "Cada hito necesita un título y acciones.": "Each milestone needs a title and actions.",
  "Consulta el resultado antes de reintentar.": "Check the result before trying again.",
  "Cuenta de créditos no disponible.": "Credit account not available.",
  "Cuenta no disponible.": "Account not available.",
  "Describe tu meta en 3 a 2.000 caracteres.": "Describe your goal in 3 to 2,000 characters.",
  "Duración o día inválido.": "Invalid duration or day.",
  "Días inválidos.": "Invalid days.",
  "El código se usa antes de tu primera solicitud de IA.": "The code must be used before your first AI request.",
  "El mensaje es demasiado largo.": "The message is too long.",
  "El plan debe incluir entre uno y ocho hitos.": "The plan must include between one and eight milestones.",
  "El plan supera el tiempo semanal asignado a la meta.": "The plan exceeds the weekly time assigned to the goal.",
  "El precio cambió. Revisa el importe actualizado antes de continuar.": "The price changed. Review the updated amount before continuing.",
  "El proveedor de IA devolvió una respuesta ilegible.": "The AI provider returned an unreadable response.",
  "El proveedor de IA devolvió una respuesta inválida.": "The AI provider returned an invalid response.",
  "El proveedor de IA rechazó la solicitud. Revisa el modelo y su configuración.": "The AI provider rejected the request.",
  "El tiempo de la meta debe estar entre 30 minutos y tu disponibilidad semanal total.":
    "The goal's time must be between 30 minutes and your total weekly availability.",
  "El tiempo máximo de IA está mal configurado.": "The AI time limit is misconfigured.",
  "Elige qué problema tiene.": "Choose what the problem is.",
  "Elige una hora para el recordatorio.": "Choose a time for the reminder.",
  "Envía un mensaje válido.": "Send a valid message.",
  "Envía una solicitud válida.": "Send a valid request.",
  "Escribe ELIMINAR para confirmar.": "Type DELETE to confirm.",
  "Escribe un mensaje de 1 a 500 caracteres.": "Write a message of 1 to 500 characters.",
  "Ese día no corresponde a un cumplimiento del hábito.": "That day doesn't match a day of the habit.",
  "Esta compra no pertenece a PlanifIA.": "This purchase doesn't belong to PlanifIA.",
  "Esta compra pertenece a otra cuenta de PlanifIA.": "This purchase belongs to another PlanifIA account.",
  "Esta suscripción no pertenece a PlanifIA.": "This subscription doesn't belong to PlanifIA.",
  "Este identificador ya corresponde a otra solicitud.": "This identifier already belongs to another request.",
  "Este identificador ya pertenece a otra operación.": "This identifier already belongs to another operation.",
  "Este mensaje ya no está disponible.": "This message is no longer available.",
  "Este mensaje ya se envió.": "This message was already sent.",
  "Este paquete no pertenece a PlanifIA.": "This pack doesn't belong to PlanifIA.",
  "Estado inválido.": "Invalid status.",
  "Falta un identificador válido para el mensaje.": "The message is missing a valid identifier.",
  "Falta un identificador válido para recuperar la solicitud.": "The request is missing a valid identifier.",
  "Google Play no reconoce esta compra.": "Google Play doesn't recognize this purchase.",
  "Google Play no respondió. Inténtalo de nuevo en unos minutos.": "Google Play didn't respond. Try again in a few minutes.",
  "Hay demasiadas solicitudes desde tu conexión. Espera unos minutos y vuelve a intentarlo. No se descontaron créditos.":
    "There are too many requests from your connection. Wait a few minutes and try again. No credits were deducted.",
  "Hay una acción inválida en la propuesta.": "There is an invalid action in the proposal.",
  "Hito no encontrado.": "Milestone not found.",
  "Hábito no encontrado.": "Habit not found.",
  "Identificador de solicitud inválido.": "Invalid request identifier.",
  "Indica si el cumplimiento está completado.": "Say whether it was completed.",
  "Inicia sesión para continuar.": "Sign in to continue.",
  "Inicia sesión para crear un plan.": "Sign in to create a plan.",
  "Inicia sesión para hablar con Lumi.": "Sign in to talk with Lumi.",
  "Inicia sesión para usar la IA.": "Sign in to use the AI.",
  "Inicia sesión.": "Sign in.",
  "La IA de respaldo alcanzó su límite por ahora y la IA local está apagada. Inténtalo más tarde. No se descontaron créditos.":
    "The backup AI has reached its limit for now and the local AI is off. Try again later. No credits were deducted.",
  "La IA de respaldo alcanzó su límite por hoy. Tu solicitud sigue guardada y se preparará cuando vuelva la IA local.":
    "The backup AI has reached its limit for today. Your request is still saved and will be prepared when the local AI is back.",
  "La IA de respaldo no está disponible. Tu solicitud sigue guardada y se preparará cuando vuelva la IA local.":
    "The backup AI isn't available. Your request is still saved and will be prepared when the local AI is back.",
  "La IA de respaldo no respondió.": "The backup AI didn't respond.",
  "La IA devolvió una meta incompleta. Puedes volver a intentarlo.": "The AI returned an incomplete goal. You can try again.",
  "La IA está ocupada. Inténtalo de nuevo en unos segundos.": "The AI is busy. Try again in a few seconds.",
  "La IA está tardando demasiado. Puedes reintentarlo o crear la meta manualmente.":
    "The AI is taking too long. You can try again or create the goal manually.",
  "La IA no terminó la propuesta. Inténtalo con una meta más acotada.": "The AI didn't finish the proposal. Try a more focused goal.",
  "La conexión segura con el proveedor de IA está incompleta.": "The secure connection to the AI provider is incomplete.",
  "La conversación se borró mientras Lumi respondía, así que la respuesta no se guardó. No se descontaron créditos.":
    "The conversation was deleted while Lumi was answering, so the reply wasn't saved. No credits were deducted.",
  "La descripción es demasiado larga.": "The description is too long.",
  "La dirección del proveedor de IA está mal configurada.": "The AI provider address is misconfigured.",
  "La fecha objetivo debe ser hoy o posterior.": "The target date must be today or later.",
  "La meta cambió desde que generaste la propuesta. Revísala y genera un ajuste nuevo.":
    "The goal changed since you generated the proposal. Review it and generate a new adjustment.",
  "La promoción ya fue utilizada.": "The promotion was already used.",
  "La propuesta contiene demasiadas acciones.": "The proposal contains too many actions.",
  "La propuesta incluye un día en el que no estás disponible.": "The proposal includes a day when you're not available.",
  "La propuesta no respeta las condiciones de planificación.": "The proposal doesn't meet the planning conditions.",
  "La propuesta pertenece a otro día. Genera una nueva para actualizar sus fechas.":
    "The proposal belongs to another day. Generate a new one to update its dates.",
  "La propuesta supera la fecha objetivo.": "The proposal goes past the target date.",
  "La semana ya está ocupada. Reduce el alcance del nuevo plan.": "The week is already full. Reduce the scope of the new plan.",
  "La verificación de Google Play no está configurada.": "Google Play verification isn't configured.",
  "La versión de los términos no es válida. Actualiza la app.": "The terms version isn't valid. Update the app.",
  "Llegaste al límite de metas o IA de tu plan. Consulta Mi plan; puedes seguir editando manualmente.":
    "You reached your plan's goal or AI limit. See My plan; you can keep editing manually.",
  "Llegaste al límite diario de mensajes con Lumi. Vuelve mañana.": "You reached today's limit of messages with Lumi. Come back tomorrow.",
  "Llegaste al límite diario de propuestas. Puedes seguir editando manualmente.":
    "You reached today's proposal limit. You can keep editing manually.",
  "Los detalles pueden tener hasta 500 caracteres.": "Details can be up to 500 characters.",
  "Lumi está descansando, inténtalo más tarde. No se descontaron créditos.": "Lumi is resting, try again later. No credits were deducted.",
  "Lumi está terminando un plan. Inténtalo en un minuto. No se descontaron créditos.":
    "Lumi is finishing a plan. Try again in a minute. No credits were deducted.",
  "Lumi no pudo responder y no pudimos confirmar la devolución de créditos. Revisa tu saldo antes de volver a enviar.":
    "Lumi couldn't answer and we couldn't confirm the credit refund. Check your balance before sending again.",
  "Meta no encontrada.": "Goal not found.",
  "Método no permitido.": "Method not allowed.",
  "Máximo 40 acciones por propuesta.": "Maximum 40 actions per proposal.",
  "No encontramos esa meta en tu cuenta.": "We couldn't find that goal in your account.",
  "No encontramos esa propuesta en tu cuenta.": "We couldn't find that proposal in your account.",
  "No encontramos esa respuesta de Lumi en tu conversación.": "We couldn't find that reply from Lumi in your conversation.",
  "No encontramos ese código de invitación.": "We couldn't find that invitation code.",
  "No pudimos cargar tu disponibilidad. Guarda tus ajustes primero.": "We couldn't load your availability. Save your settings first.",
  "No pudimos comunicarnos con el proveedor de IA. Inténtalo de nuevo más tarde.":
    "We couldn't reach the AI provider. Try again later.",
  "No pudimos conectar con Google Play.": "We couldn't connect to Google Play.",
  "No pudimos conectar con la GPU. Se intentará de nuevo dentro del límite configurado.":
    "We couldn't reach the local AI. It will be retried within the configured limit.",
  "No pudimos conectar con la IA de respaldo. Se intentará de nuevo dentro del límite configurado.":
    "We couldn't reach the backup AI. It will be retried within the configured limit.",
  "No pudimos consultar tu calendario completo. Inténtalo de nuevo.": "We couldn't read your full calendar. Try again.",
  "No pudimos crear la propuesta. Inténtalo de nuevo en un momento.": "We couldn't create the proposal. Try again in a moment.",
  "No pudimos crear tu código de invitación. Inténtalo de nuevo.": "We couldn't create your invitation code. Try again.",
  "No pudimos enviar tu mensaje. Inténtalo de nuevo.": "We couldn't send your message. Try again.",
  "No pudimos guardar la compra. Inténtalo de nuevo.": "We couldn't save the purchase. Try again.",
  "No pudimos guardar la solicitud. Inténtalo de nuevo en un momento.": "We couldn't save the request. Try again in a moment.",
  "No pudimos preparar la propuesta.": "We couldn't prepare the proposal.",
  "No pudimos verificar la compra.": "We couldn't verify the purchase.",
  "No puedes usar tu propio código.": "You can't use your own code.",
  "No tienes un período vigente para programar este cambio.": "You don't have a current period to schedule this change.",
  "No tienes una suscripción pagada.": "You don't have a paid subscription.",
  "Operación no válida.": "Invalid operation.",
  "Origen no autorizado. Configura ALLOWED_ORIGINS para esta web.": "Unauthorized origin.",
  "Paquete de créditos desconocido.": "Unknown credit pack.",
  "Plan no disponible.": "Plan not available.",
  "Plan o modalidad no disponible.": "Plan or billing option not available.",
  "Plataforma no válida.": "Invalid platform.",
  "Producto de suscripción desconocido.": "Unknown subscription product.",
  "Producto desconocido.": "Unknown product.",
  "Programa el cambio de plan para la próxima renovación.": "Schedule the plan change for the next renewal.",
  "Propuesta inválida.": "Invalid proposal.",
  "Referencia inválida.": "Invalid reference.",
  "Respuesta vacía.": "Empty response.",
  "Resultado demasiado grande.": "Result too large.",
  "Resultado inválido.": "Invalid result.",
  "Revisa el código: tiene 8 letras y números.": "Check the code: it has 8 letters and numbers.",
  "Se agotó el tiempo de espera o los reintentos. Puedes crear otra solicitud.":
    "The waiting time or retries ran out. You can create another request.",
  "Solicitud demasiado grande.": "Request too large.",
  "Solicitud inválida.": "Invalid request.",
  "Solicitud no encontrada.": "Request not found.",
  "Tipo de contenido no válido.": "Invalid content type.",
  "Tu calendario supera el tamaño que podemos planificar de forma segura.": "Your calendar is larger than we can safely plan.",
  "Tu sesión terminó. Vuelve a iniciar sesión.": "Your session ended. Sign in again.",
  "Un hito no tiene acciones.": "A milestone has no actions.",
  "Una acción no corresponde a los días o fechas disponibles.": "An action doesn't match the available days or dates.",
  "Una fecha límite no corresponde a la acción.": "A deadline doesn't match the action.",
  "Uso de IA inválido.": "Invalid AI use.",
  "Usuario no encontrado.": "User not found.",
  "Vas muy rápido. Espera un momento antes de escribirle otra vez a Lumi.": "You're going very fast. Wait a moment before writing to Lumi again.",
  "Ya enviaste muchos reportes hoy. Si es urgente, escríbenos a planifiaprivacity@gmail.com.":
    "You've sent many reports today. If it's urgent, write to us at planifiaprivacity@gmail.com.",
  "Ya tienes un pago pendiente de verificación.": "You already have a payment pending verification.",
  "Ya tienes una solicitud en preparación. Recupérala antes de crear otra.":
    "You already have a request in progress. Retrieve it before creating another one.",
  "Ya usaste un código de invitación.": "You already used an invitation code.",
  "Zona horaria inválida.": "Invalid time zone.",
};

// Mensajes con números, fechas o un detalle al final. "rest" se vuelve a traducir.
const PATTERNS = [
  [/^No tienes créditos suficientes\. Cada uso de IA cuesta (\d+) créditos; consigue más en Mi plan\.$/, (n) =>
    `You don't have enough credits. Each AI use costs ${n} credits; get more in My plan.`],
  [/^No tienes créditos suficientes\.\s*(.*)$/s, (rest) => `You don't have enough credits. ${translate(rest)}`.trim()],
  [/^Tu plan permite (\d+) metas activas\. Pausa una meta o consulta Mi plan; puedes seguir editando manualmente\.$/, (n) =>
    `Your plan allows ${n} active goals. Pause a goal or see My plan; you can keep editing manually.`],
  [/^Tu plan permite (\d+) metas activas\. Puedes consultar tus datos y pausar una meta para activar otra\.$/, (n) =>
    `Your plan allows ${n} active goals. You can view your data and pause a goal to activate another one.`],
  [/^Los códigos se usan durante los primeros (\d+) días de la cuenta\.$/, (n) =>
    `Codes can be used during the account's first ${n} days.`],
  [/^No queda suficiente tiempo el (\S+); reprograma acciones o reduce el plan\.$/, (day) =>
    `There isn't enough time left on ${day}; reschedule actions or reduce the plan.`],
  [/^La semana (\d+) suma (\d+) minutos y supera el tiempo disponible de (\d+)\. Reduce las acciones o sus duraciones\.$/, (w, m, k) =>
    `Week ${w} adds up to ${m} minutes and exceeds the available ${k}. Reduce the actions or their durations.`],
  [/^El día (\S+) suma (\d+) minutos y supera el tiempo disponible de (\d+)\. Reparte las acciones en otros días disponibles\.$/, (d, m, k) =>
    `${d} adds up to ${m} minutes and exceeds the available ${k}. Spread the actions over other available days.`],
  [/^La IA no pudo ajustar una propuesta válida\.\s*(.*)$/s, (rest) =>
    `The AI couldn't fit a valid proposal. ${translate(rest)}`.trim()],
  [/^La IA local rechazó la solicitud \(HTTP (\d+)\)\.$/, (code) => `The local AI rejected the request (HTTP ${code}).`],
];

function translate(message) {
  if (!message) return message;
  if (EXACT[message]) return EXACT[message];
  for (const [pattern, build] of PATTERNS) {
    const match = message.match(pattern);
    if (match) return build(...match.slice(1));
  }
  return message;
}

/** Mensaje del servidor en el idioma de la app. */
export function serverText(message) {
  const text = typeof message === "string" ? message.trim() : message;
  return lang() === "en" && typeof text === "string" ? translate(text) : message;
}
