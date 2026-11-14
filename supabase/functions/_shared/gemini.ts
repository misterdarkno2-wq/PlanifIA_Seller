const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiEndpoint = (model: string) => `${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent`;

export type ChatMessage = { role: string; content: string };
type TextPart = { text: string };
type Turn = { role: "user" | "model"; parts: TextPart[] };
type GenerationConfig = {
  maxOutputTokens: number;
  responseMimeType?: "application/json";
  responseJsonSchema?: object;
};

export function fetchGemini({ model, apiKey, messages, generationConfig, signal, fetchImpl }: {
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  generationConfig: GenerationConfig;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}) {
  const systemParts: TextPart[] = [];
  const contents: Turn[] = [];
  for (const message of messages) {
    const part = { text: message.content };
    if (message.role === "system") {
      systemParts.push(part);
      continue;
    }
    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(part);
    else contents.push({ role, parts: [part] });
  }

  return fetchImpl(geminiEndpoint(model), {
    method: "POST",
    redirect: "error",
    signal,
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
      contents,
      generationConfig,
    }),
  });
}

type GeminiResponse = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: unknown; thought?: boolean }[] };
  }[];
};

export function geminiCompletion(response: GeminiResponse | null) {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((part) => !part?.thought && typeof part?.text === "string").map((part) => part.text).join("")
    : "";
  return { complete: candidate?.finishReason === "STOP", text };
}
