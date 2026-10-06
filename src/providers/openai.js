import { requestJson } from "./http.js"
import { ProviderError } from "../errors.js"

const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|transcribe|realtime|audio|image|rerank|guard|sora|omni-mod/i

const joinContent = (content) => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("")
  return ""
}

/** OpenAI-compatible chat/completions. Works for OpenAI, Groq, OpenRouter, Together, Mistral, DeepSeek, xAI, Ollama… */
export function openaiAdapter(cfg) {
  const base = cfg.baseUrl
  const isOpenAI = /(^|\.)api\.openai\.com/.test(base)
  const headers = {
    "content-type": "application/json",
    ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    ...(/openrouter\.ai/.test(base) ? { "x-title": "ownit", "http-referer": "https://github.com/reabot6/ownit" } : {}),
  }

  return {
    async complete({ system, user, model, maxTokens, signal, timeoutMs, onRetry }) {
      // Newer OpenAI models want max_completion_tokens; most compatible servers still want max_tokens.
      let param = isOpenAI ? "max_completion_tokens" : "max_tokens"
      const call = (p) =>
        requestJson(`${base}/chat/completions`, {
          headers,
          signal,
          timeoutMs,
          onRetry,
          body: {
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            [p]: maxTokens,
          },
        })

      let data
      try {
        data = await call(param)
      } catch (err) {
        const mentionsParam = /max_completion_tokens|max_tokens/.test(err.message || "")
        if (err instanceof ProviderError && (err.kind === "param" || err.kind === "bad_request") && mentionsParam) {
          param = param === "max_tokens" ? "max_completion_tokens" : "max_tokens"
          data = await call(param)
        } else {
          throw err
        }
      }

      const choice = data.choices?.[0]
      let text = joinContent(choice?.message?.content)
      text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim() // strip reasoning traces some models inline
      if (!text) {
        throw new ProviderError("The model returned an empty response.", {
          kind: "empty",
          hint: choice?.finish_reason === "length" ? "It ran out of output tokens (reasoning models count thinking). Raise --max-output." : "Try again, or pick a different model.",
        })
      }
      return {
        text,
        stopReason: choice?.finish_reason === "length" ? "length" : "end",
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      }
    },

    async listModels({ signal, timeoutMs = 30_000 } = {}) {
      const data = await requestJson(`${base}/models`, { method: "GET", headers, signal, timeoutMs, retries: 1 })
      const rows = Array.isArray(data) ? data : data.data || data.models || []
      const models = rows
        .map((m) => ({ id: m.id || m.name, created: m.created || 0 }))
        .filter((m) => m.id && !NOT_CHAT.test(m.id))
      const dated = models.every((m) => m.created)
      return models.sort((a, b) => (dated ? b.created - a.created : a.id.localeCompare(b.id)))
    },
  }
}
