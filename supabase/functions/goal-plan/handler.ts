import { createClient } from "npm:@supabase/supabase-js@2.58.0";

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
  if (!origin || !origins.includes(origin)) {
    return json(
      {
        error: "Origen no autorizado. Configura ALLOWED_ORIGINS para esta web.",
      },
      403,
      {},
    );
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido." }, 405, headers);
  }
  try {
    const token = req.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) {
      return json({ error: "Inicia sesión para crear un plan." }, 401, headers);
    }
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
    if (authError || !user) {
      return json(
        { error: "Tu sesión terminó. Vuelve a iniciar sesión." },
        401,
        headers,
      );
    }
    if (Number(req.headers.get("content-length")) > 20000) {
      return json(
        { error: "La descripción es demasiado larga." },
        413,
        headers,
      );
    }
    const raw = await req.text();
    if (raw.length > 20000) {
      return json(
        { error: "La descripción es demasiado larga." },
        413,
        headers,
      );
    }
    const input = JSON.parse(raw);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.request_id || "",
      )
    ) {
      return json(
        { error: "Falta un identificador válido para recuperar la solicitud." },
        422,
        headers,
      );
    }
    if (
      typeof input.idea !== "string" ||
      input.idea.trim().length < 3 ||
      input.idea.length > 2000 ||
      String(input.current_situation || "").length > 2000 ||
      String(input.outcome || "").length > 1000 ||
      String(input.reason || "").length > 1000
    ) {
      return json(
        { error: "Describe tu meta en 3 a 2.000 caracteres." },
        422,
        headers,
      );
    }
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("*")
      .single();
    if (profileError || !profile) {
      throw new Error(
        "No pudimos cargar tu disponibilidad. Guarda tus ajustes primero.",
      );
    }
    const weeklyMinutes = Number(input.weekly_minutes);
    if (
      !Number.isInteger(weeklyMinutes) ||
      weeklyMinutes < 30 ||
      weeklyMinutes > profile.weekly_minutes
    ) {
      return json(
        {
          error:
            "El tiempo de la meta debe estar entre 30 minutos y tu disponibilidad semanal total.",
        },
        422,
        headers,
      );
    }
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
    ) {
      return json(
        { error: "La fecha objetivo debe ser hoy o posterior." },
        422,
        headers,
      );
    }
    let goal = null;
    if (input.goal_id) {
      const r = await client
        .from("goals")
        .select("*")
        .eq("id", input.goal_id)
        .single();
      if (r.error) {
        return json(
          { error: "No encontramos esa meta en tu cuenta." },
          404,
          headers,
        );
      }
      goal = r.data;
    }
    const [taskResult, habitResult, goalResult] = await Promise.all([
      client.from("tasks").select("*"),
      client.from("habits").select("*"),
      client.from("goals").select("id,status"),
    ]);
    if (taskResult.error || habitResult.error || goalResult.error) {
      throw new Error(
        "No pudimos consultar tu calendario. Inténtalo de nuevo.",
      );
    }
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
    const limits = {
      weeklyMinutes,
      remainingDaily,
      remainingWeekly: remainingWeekly.map((used) =>
        Math.max(0, profile.weekly_minutes - used),
      ),
      startDate,
      targetDate,
      availableDays: profile.available_days,
    };
    // Whitelist user input: priority, plan and payload cannot be injected by clients.
    const clientInput = {
      idea: input.idea.trim(),
      current_situation: String(input.current_situation || ""),
      outcome: String(input.outcome || ""),
      reason: String(input.reason || ""),
      weekly_minutes: weeklyMinutes,
      target_date: targetDate,
      goal_id: goal?.id || null,
    };
    const queued = await admin.rpc("enqueue_ai_job", {
      p_user_id: user.id,
      p_request_id: input.request_id,
      p_kind: goal ? "adjustment" : "generation",
      p_input: clientInput,
      p_payload: {
        requestData: {
          ...clientInput,
          current_goal: goal,
          completed_actions: tasks.filter(
            (t) => t.goal_id === goal?.id && t.status === "completed",
          ),
        },
        limits,
        goal_id: goal?.id || null,
        expected_version: goal?.version || null,
      },
    });
    if (queued.error) {
      const message =
        queued.error.code === "P0001"
          ? queued.error.message
          : "No pudimos guardar la solicitud. Revisa la migración de la cola.";
      return json(
        { error: message },
        queued.error.code === "P0001" ? 429 : 503,
        headers,
      );
    }
    return json({ job: queued.data }, 202, headers);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No pudimos crear la propuesta.";
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    ) {
      return json(
        {
          error:
            "La IA está tardando demasiado. Puedes reintentarlo o crear la meta manualmente.",
        },
        504,
        headers,
      );
    }
    console.error(
      "goal-plan failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ error: message }, 422, headers);
  }
}
