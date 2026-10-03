import { loadEnv } from "vite";
const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
for (const [key, value] of Object.entries(env))
  if (key.startsWith("VITE_") && value) {
    if (
      /SECRET|PASSWORD|SERVICE_ROLE|AI_.*KEY|OPENAI|TOKEN/.test(key) ||
      value.startsWith("sb_secret_") ||
      value.startsWith("sk-")
    )
      throw new Error(
        "Una variable VITE_ contiene una clave privada. Retírala antes de compilar.",
      );
    if (key === "VITE_SUPABASE_PUBLISHABLE_KEY" && value.includes(".")) {
      try {
        if (
          JSON.parse(Buffer.from(value.split(".")[1], "base64url")).role !==
          "anon"
        )
          throw new Error("role");
      } catch {
        throw new Error(
          "Solo se permite la clave pública publishable/anon de Supabase.",
        );
      }
    }
  }
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)
  console.warn(
    "Sin configuración pública de Supabase: la web mostrará qué falta y no simulará datos ni IA.",
  );
