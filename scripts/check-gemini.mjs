// Prueba real con datos sintéticos: nunca imprime claves, cabeceras ni respuestas del proveedor.
import { cloudSettings, cloudChat, cloudPlan, CloudUnavailable, CLOUD_CHAT_ADDENDUM } from "../supabase/functions/_shared/ai-fallback.ts";
import { PlanGenerationError } from "../supabase/functions/_shared/generate-plan.ts";

const hints = {
  400: "Revisa la clave, el formato de la solicitud y las capacidades del modelo.",
  401: "La clave de Gemini no es válida o fue revocada.",
  403: "Revisa los permisos de la clave y del proyecto de Google AI Studio.",
  404: "El modelo no está disponible para esta cuenta.",
  410: "El modelo fue retirado. Configura GEMINI_MODEL o GEMINI_CHAT_MODEL.",
  429: "Se alcanzó un límite de Gemini. Revisa la cuota del proyecto en Google AI Studio.",
};

try {
  const settings = cloudSettings((key) => process.env[key]);
  if (!settings) {
    console.error("Falta GEMINI_API_KEY. Agrégala en supabase/functions/.env o en el entorno del proceso.");
    process.exitCode = 1;
  } else {
    console.log(`Configuración: chat=${settings.chatModels.join(",")}; planes=${settings.models.join(",")}; formato=${settings.planFormat}`);
    const start = performance.now();
    await cloudChat({ settings, messages: [
      { role: "system", content: "Eres Lumi. Responde en español con una sola frase corta." + CLOUD_CHAT_ADDENDUM },
      { role: "user", content: "Dame un paso sencillo para ordenar mi escritorio." },
    ] });
    console.log(`Chat de Gemini: OK (${Math.round(performance.now() - start)} ms).`);
    if (process.argv.includes("--plan")) {
      const proposal = await cloudPlan({
        settings,
        requestData: { idea: "Ordenar mi escritorio con dos acciones pequeñas esta semana", current_situation: "Tengo papeles y libros sin ordenar", outcome: "Tener el escritorio despejado" },
        limits: { weeklyMinutes: 60, remainingDaily: {}, remainingWeekly: [60, 60, 60, 60], startDate: new Date().toISOString().slice(0, 10), availableDays: [0, 1, 2, 3, 4, 5, 6] },
      });
      console.log(`Plan de Gemini: OK (${proposal.milestones.length} hitos).`);
    }
  }
} catch (error) {
  const status = error instanceof CloudUnavailable ? error.status : error instanceof PlanGenerationError ? error.providerStatus : undefined;
  // Sólo mensajes propios: no imprimir error.message ni el cuerpo HTTP, que podría contener datos.
  console.error(`Falló la prueba de Gemini${status ? ` (HTTP ${status})` : ""}. ${hints[status] || "Revisa la configuración, la conexión y la disponibilidad del modelo."}`);
  process.exitCode = 1;
}
