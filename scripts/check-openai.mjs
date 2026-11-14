import { cloudChat, cloudPlanAddendum, cloudSettings, CloudUnavailable } from "../supabase/functions/_shared/ai-fallback.ts";
import { generateValidatedPlan, PlanGenerationError } from "../supabase/functions/_shared/generate-plan.ts";

try {
  const settings = cloudSettings((name) => process.env[name]);
  if (!settings) throw new CloudUnavailable("Falta OPENAI_API_KEY");

  const start = performance.now();
  await cloudChat({
    settings,
    messages: [
      { role: "system", content: "Eres Lumi. Responde en español con una frase corta." },
      { role: "user", content: "Dame un paso sencillo para ordenar un escritorio." },
    ],
  });
  console.log("Chat de OpenAI: OK (" + Math.round(performance.now() - start) + " ms).");

  if (process.argv.includes("--plan")) {
    const planStart = performance.now();
    const proposal = await generateValidatedPlan({
      provider: "openai",
      ...settings,
      systemAddendum: cloudPlanAddendum("es"),
      requestData: { idea: "Ordenar un escritorio", outcome: "Dejar la superficie despejada", language: "es" },
      limits: {
        weeklyMinutes: 60,
        remainingDaily: {},
        remainingWeekly: [60, 60, 60, 60],
        startDate: new Date().toISOString().slice(0, 10),
        availableDays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    console.log("Plan validado: " + proposal.milestones.length + " hitos (" + Math.round(performance.now() - planStart) + " ms).");
  }
} catch (error) {
  const status = error instanceof CloudUnavailable ? error.status :
    error instanceof PlanGenerationError ? error.providerStatus : undefined;
  const hints = {
    400: "Revisa las opciones y capacidades del modelo.",
    401: "Revisa la clave del proyecto.",
    403: "Revisa los permisos de la clave y del modelo.",
    404: "Revisa la disponibilidad del modelo en el proyecto.",
    429: "Revisa el saldo, los límites de gasto y la cuota del proyecto en OpenAI.",
  };
  const detail = error instanceof CloudUnavailable && error.message === "Falta OPENAI_API_KEY"
    ? "Pega la clave en supabase/functions/.env."
    : (hints[status] || "Revisa la configuración y la disponibilidad de la API.");
  console.error((status ? "OpenAI (HTTP " + status + "). " : "") + detail);
  process.exitCode = 1;
}
