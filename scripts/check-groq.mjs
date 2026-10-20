// Prueba real con datos sintéticos: nunca imprime claves, cabeceras ni respuestas del proveedor.
import { cloudSettings, cloudChat, CloudUnavailable, CLOUD_CHAT_ADDENDUM, CLOUD_PLAN_ADDENDUM } from "../supabase/functions/_shared/ai-fallback.ts";
import { generateValidatedPlan, PlanGenerationError } from "../supabase/functions/_shared/generate-plan.ts";

const hints = {
  400: "Revisa el formato y las capacidades del modelo.",
  401: "La clave de Groq no es válida o fue revocada.",
  403: "La cuenta o el proyecto de Groq no tiene permiso para usar este modelo.",
  404: "El modelo no está disponible para esta cuenta.",
  410: "El modelo fue retirado; configura GROQ_MODEL/GROQ_CHAT_MODEL.",
  429: "Se alcanzó un límite de Groq; revisa Limits y espera antes de reintentar.",
};

try {
  const settings = cloudSettings((key) => process.env[key]);
  if (!settings) {
    console.error("Falta GROQ_API_KEY. Para esta prueba, configúrala en supabase/functions/.env.local (ignorado por Git) o en el entorno del proceso. Para la app, debe existir además como secreto de Supabase. Nunca uses VITE_GROQ_API_KEY.");
    process.exitCode = 1;
  } else {
    console.log(`Configuración: chat=${settings.chatModels.join(",")}; planes=${settings.models.join(",")}; formato=${settings.planFormat}`);
    const start = performance.now();
    await cloudChat({ settings, messages: [
      { role: "system", content: "Eres Lumi. Responde en español con una sola frase corta." + CLOUD_CHAT_ADDENDUM },
      { role: "user", content: "Dame un paso sencillo para ordenar mi escritorio." },
    ] });
    console.log(`Chat real de Groq: OK (${Math.round(performance.now() - start)} ms).`);
    if (process.argv.includes("--plan")) {
      const proposal = await generateValidatedPlan({
        endpoint: settings.endpoint, apiKey: settings.apiKey, model: settings.model,
        responseFormat: settings.planFormat, systemAddendum: CLOUD_PLAN_ADDENDUM,
        requestData: { idea: "Ordenar mi escritorio con dos acciones pequeñas esta semana", current_situation: "Tengo papeles y libros sin ordenar", outcome: "Tener el escritorio despejado" },
        limits: { weeklyMinutes: 60, remainingDaily: {}, remainingWeekly: [60, 60, 60, 60], startDate: new Date().toISOString().slice(0, 10), availableDays: [0, 1, 2, 3, 4, 5, 6] },
      });
      console.log(`Plan real de Groq: OK, ${proposal.milestones.length} hitos; validación de contenido y calendario superada.`);
    }
    console.log("Esta prueba directa no verifica los secretos desplegados, enabled ni los límites de Supabase. Consulta docs/respaldo-nube.md.");
  }
} catch (error) {
  const status = error instanceof CloudUnavailable ? error.status : error instanceof PlanGenerationError ? error.providerStatus : undefined;
  // Sólo mensajes propios: no imprimir error.message ni el cuerpo HTTP, que podría contener datos.
  console.error(`Groq: prueba fallida${status ? ` (HTTP ${status})` : ""}. ${hints[status] || "Revisa configuración, red y disponibilidad; no se pudo confirmar una respuesta válida."}`);
  process.exitCode = 1;
}
