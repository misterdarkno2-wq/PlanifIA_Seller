import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  generateValidatedPlan,
  PlanGenerationError,
} from "../_shared/generate-plan.ts";

const json = (data: unknown, status: number, headers: HeadersInit) =>
  Response.json(data, { status, headers });
export async function handleGoalPlan(req: Request) {
  const origin = req.headers.get("origin") || "";
  const origins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((x) => x.trim());
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (!origin || !origins.includes(origin))
    return json(
      {
        error: "Origen no autorizado. Configura ALLOWED_ORIGINS para esta web.",
      },
      403,
      {},
    );
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return json({ error: "Método no permitido." }, 405, headers);
  try {
    const token = req.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token)
      return json({ error: "Inicia sesión para crear un plan." }, 401, headers);
    const url = Deno.env.get("SUPABASE_URL")!,
      anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(token);
    if (authError || !user)
      return json(
        { error: "Tu sesión terminó. Vuelve a iniciar sesión." },
        401,
        headers,
      );
    const apiKey = Deno.env.get("AI_API_KEY"),
      model = Deno.env.get("AI_MODEL"),
      base = Deno.env.get("AI_BASE_URL");
    const missing = [
      !apiKey && "AI_API_KEY",
      !model && "AI_MODEL",
      !base && "AI_BASE_URL",
    ].filter(Boolean);
    if (missing.length)
      return json(
        {
          error: `Falta configurar ${missing.join(", ")} en los secretos de la función goal-plan.`,
        },
        503,
        headers,
      );
    const baseUrl = new URL(base!);
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password)
      throw new Error(
        "Configura AI_BASE_URL con una dirección HTTPS sin credenciales.",
      );
    if (Number(req.headers.get("content-length")) > 20000)
      return json(
        { error: "La descripción es demasiado larga." },
        413,
        headers,
      );
    const raw = await req.text();
    if (raw.length > 20000)
      return json(
        { error: "La descripción es demasiado larga." },
        413,
        headers,
      );
    const input = JSON.parse(raw);
    if (
      typeof input.idea !== "string" ||
      input.idea.trim().length < 3 ||
      input.idea.length > 2000 ||
      String(input.current_situation || "").length > 2000 ||
      String(input.outcome || "").length > 1000 ||
      String(input.reason || "").length > 1000
    )
      return json(
        { error: "Describe tu meta en 3 a 2.000 caracteres." },
        422,
        headers,
      );
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("*")
      .single();
    if (profileError || !profile)
      throw new Error(
        "No pudimos cargar tu disponibilidad. Guarda tus ajustes primero.",
      );
    const weeklyMinutes = Number(input.weekly_minutes);
    if (
      !Number.isInteger(weeklyMinutes) ||
      weeklyMinutes < 30 ||
      weeklyMinutes > profile.weekly_minutes
    )
      return json(
        {
          error:
            "El tiempo de la meta debe estar entre 30 minutos y tu disponibilidad semanal total.",
        },
        422,
        headers,
      );
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: profile.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const startDate = ["year", "month", "day"]
      .map((k) => parts.find((x) => x.type === k)!.value)
      .join("-");
    const targetDate = input.target_date || null;
    if (
      targetDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < startDate)
    )
      return json(
        { error: "La fecha objetivo debe ser hoy o posterior." },
        422,
        headers,
      );
    let goal = null;
    if (input.goal_id) {
      const r = await client
        .from("goals")
        .select("*")
        .eq("id", input.goal_id)
        .single();
      if (r.error)
        return json(
          { error: "No encontramos esa meta en tu cuenta." },
          404,
          headers,
        );
      goal = r.data;
    }
    const [taskResult, habitResult, goalResult] = await Promise.all([
      client.from("tasks").select("*"),
      client.from("habits").select("*"),
      client.from("goals").select("id,status"),
    ]);
    if (taskResult.error || habitResult.error || goalResult.error)
      throw new Error(
        "No pudimos consultar tu calendario. Inténtalo de nuevo.",
      );
    const active = new Set(
      goalResult.data.filter((g) => g.status === "active").map((g) => g.id),
    );
    const tasks = taskResult.data.filter(
      (t) =>
        t.status !== "cancelled" &&
        (!t.goal_id || active.has(t.goal_id)) &&
        !(t.goal_id === goal?.id && t.status === "pending"),
    );
    const habits = habitResult.data.filter(
      (h) => h.active && (!h.goal_id || active.has(h.goal_id)),
    );
    const remainingDaily: Record<string, number> = {};
    const remainingWeekly = [0, 0, 0, 0];
    for (let d = 0; d < 28; d++) {
      const date = new Date(startDate + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() + d);
      const day = date.toISOString().slice(0, 10);
      const used =
        tasks
          .filter((t) => t.scheduled_date === day)
          .reduce((sum, t) => sum + t.minutes, 0) +
        habits
          .filter((h) => h.days.includes(date.getUTCDay()))
          .reduce((sum, h) => sum + h.minutes, 0);
      remainingDaily[day] = profile.available_days.includes(date.getUTCDay())
        ? Math.max(
            0,
            Math.ceil(profile.weekly_minutes / profile.available_days.length) -
              used,
          )
        : 0;
      remainingWeekly[Math.floor(d / 7)] += used;
    }
    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const limit = Number(Deno.env.get("AI_DAILY_LIMIT") || 8);
    const reserved = await admin.rpc("reserve_ai_request", {
      p_user_id: user.id,
      p_limit: limit,
    });
    if (reserved.error)
      throw new Error(
        "No pudimos comprobar el límite de uso. Revisa las migraciones de Supabase.",
      );
    if (!reserved.data)
      return json(
        {
          error: `Llegaste al límite de ${limit} propuestas por día. Puedes seguir editando tus metas manualmente.`,
        },
        429,
        headers,
      );
    const proposal = await generateValidatedPlan({
      endpoint: base!.replace(/\/$/, "") + "/chat/completions",
      apiKey: apiKey!,
      model: model!,
      requestData: {
        ...input,
        current_goal: goal,
        completed_actions: tasks.filter(
          (t) => t.goal_id === goal?.id && t.status === "completed",
        ),
      },
      limits: {
        weeklyMinutes,
        remainingDaily,
        remainingWeekly: remainingWeekly.map((used) =>
          Math.max(0, profile.weekly_minutes - used),
        ),
        startDate,
        targetDate,
        availableDays: profile.available_days,
      },
    });
    return json(
      {
        proposal: {
          ...proposal,
          start_date: startDate,
          target_date: targetDate,
          weekly_minutes: weeklyMinutes,
          current_situation: input.current_situation || "",
        },
        constraints: {
          remainingDaily,
          remainingWeekly: remainingWeekly.map((used) =>
            Math.max(0, profile.weekly_minutes - used),
          ),
          availableDays: profile.available_days,
        },
        goal_id: goal?.id || null,
        expected_version: goal?.version || null,
      },
      200,
      headers,
    );
  } catch (error) {
    if (error instanceof PlanGenerationError)
      return json({ error: error.message }, error.status, headers);
    const message =
      error instanceof Error ? error.message : "No pudimos crear la propuesta.";
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      return json(
        {
          error:
            "La IA está tardando demasiado. Puedes reintentarlo o crear la meta manualmente.",
        },
        504,
        headers,
      );
    console.error(
      "goal-plan failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ error: message }, 422, headers);
  }
}
