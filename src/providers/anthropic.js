import { requestJson } from "./http.js"
import { ProviderError } from "../errors.js"

export function anthropicAdapter(cfg) {
  const root = cfg.baseUrl.replace(/\/v1$/, "")
  const headers = {
    "content-type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01",
  }

  return {
    async complete({ system, user, model, maxTokens, signal, timeoutMs, onRetry }) {
      const data = await requestJson(`${root}/v1/messages`, {
        headers,
        signal,
        timeoutMs,
        onRetry,
        body: { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
      })
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim()
      if (!text) {
        throw new ProviderError("The model returned an empty response.", {
          kind: data.stop_reason === "refusal" ? "blocked" : "empty",
          hint: "Try again, or pick a different model.",
        })
      }
      return {
        text,
        stopReason: data.stop_reason === "max_tokens" ? "length" : "end",
        usage: {
          input: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
          output: data.usage?.output_tokens ?? 0,
        },
      }
    },

    async listModels({ signal, timeoutMs = 30_000 } = {}) {
      const data = await requestJson(`${root}/v1/models?limit=100`, { method: "GET", headers, signal, timeoutMs, retries: 1 })
      return (data.data || []).map((m) => ({ id: m.id, created: Date.parse(m.created_at) || 0 })).sort((a, b) => b.created - a.created)
    },
  }
}
