import { requestJson } from "./http.js"
import { ProviderError } from "../errors.js"

const bare = (m) => String(m).replace(/^models\//, "")

export function googleAdapter(cfg) {
  const root = cfg.baseUrl.replace(/\/v1(beta)?$/, "")
  // Key goes in a header, never in the URL (URLs end up in logs and error messages).
  const headers = { "content-type": "application/json", "x-goog-api-key": cfg.apiKey }

  return {
    async complete({ system, user, model, maxTokens, signal, timeoutMs, onRetry }) {
      const data = await requestJson(`${root}/v1beta/models/${encodeURIComponent(bare(model))}:generateContent`, {
        headers,
        signal,
        timeoutMs,
        onRetry,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        },
      })
      const cand = data.candidates?.[0]
      if (!cand) {
        throw new ProviderError(`Gemini blocked the request${data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ""}.`, {
          kind: "blocked",
          hint: "Try again or use a different model.",
        })
      }
      const text = (cand.content?.parts || [])
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim()
      if (!text) {
        throw new ProviderError("The model returned an empty response.", {
          kind: "empty",
          hint: cand.finishReason === "MAX_TOKENS" ? "Thinking models spend output tokens on reasoning. Raise --max-output." : "Try again, or pick a different model.",
        })
      }
      const u = data.usageMetadata || {}
      return {
        text,
        stopReason: cand.finishReason === "MAX_TOKENS" ? "length" : "end",
        usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
      }
    },

    async listModels({ signal, timeoutMs = 30_000 } = {}) {
      const data = await requestJson(`${root}/v1beta/models?pageSize=200`, { method: "GET", headers, signal, timeoutMs, retries: 1 })
      return (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => ({ id: bare(m.name), created: 0 }))
        .filter((m) => !/embed|aqa|imagen|veo|tts|image|live|audio/i.test(m.id))
        .sort((a, b) => b.id.localeCompare(a.id))
    },
  }
}
