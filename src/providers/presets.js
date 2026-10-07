/**
 * Provider presets. A "provider" is just (protocol + base URL + key source).
 * Three wire protocols cover essentially every LLM API:
 *   openai    → POST {base}/chat/completions   (OpenAI, Groq, OpenRouter, Together, Mistral,
 *                                               DeepSeek, xAI, Fireworks, Cerebras, Ollama, LM Studio, vLLM…)
 *   anthropic → POST {base}/v1/messages
 *   google    → POST {base}/v1beta/models/{model}:generateContent
 *
 * Model IDs go stale fast, so we only ship a default where the ID is a stable alias.
 * Everywhere else the model comes from `kontx config` (which lists the provider's live models)
 * or --model.
 */
export const PRESETS = {
  anthropic: {
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envVars: ["ANTHROPIC_API_KEY"],
    keyPattern: /^sk-ant-/,
    defaultModel: "claude-sonnet-5-5",
  },
  openai: {
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    envVars: ["OPENAI_API_KEY"],
    keyPattern: /^sk-(?!ant-|or-)/,
  },
  google: {
    label: "Google (Gemini)",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyPattern: /^AIza/,
  },
  groq: {
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envVars: ["GROQ_API_KEY"],
    keyPattern: /^gsk_/,
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envVars: ["OPENROUTER_API_KEY"],
    keyPattern: /^sk-or-/,
  },
  together: {
    label: "Together AI",
    protocol: "openai",
    baseUrl: "https://api.together.xyz/v1",
    envVars: ["TOGETHER_API_KEY"],
  },
  mistral: {
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envVars: ["MISTRAL_API_KEY"],
    defaultModel: "mistral-large-latest",
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envVars: ["DEEPSEEK_API_KEY"],
    defaultModel: "deepseek-chat",
  },
  xai: {
    label: "xAI (Grok)",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    envVars: ["XAI_API_KEY"],
    keyPattern: /^xai-/,
  },
  fireworks: {
    label: "Fireworks AI",
    protocol: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envVars: ["FIREWORKS_API_KEY"],
    keyPattern: /^fw_/,
  },
  cerebras: {
    label: "Cerebras",
    protocol: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    envVars: ["CEREBRAS_API_KEY"],
    keyPattern: /^csk-/,
  },
  ollama: {
    label: "Ollama (local)",
    protocol: "openai",
    baseUrl: "http://localhost:11434/v1",
    envVars: [],
    keyOptional: true,
    local: true,
  },
  lmstudio: {
    label: "LM Studio (local)",
    protocol: "openai",
    baseUrl: "http://localhost:1234/v1",
    envVars: [],
    keyOptional: true,
    local: true,
  },
  custom: {
    label: "Custom endpoint",
    protocol: "openai",
    baseUrl: null,
    envVars: [],
  },
}

/** Order matters for env auto-detection and the config menu. */
export const PRESET_ORDER = [
  "anthropic", "openai", "google", "groq", "openrouter", "together", "mistral",
  "deepseek", "xai", "fireworks", "cerebras", "ollama", "lmstudio", "custom",
]

/** Detect a preset from an API key prefix. Specific prefixes are tested before the generic `sk-`. */
export function detectPresetFromKey(key) {
  if (!key) return null
  const k = key.trim()
  for (const id of PRESET_ORDER) {
    const p = PRESETS[id]
    if (p.keyPattern && p.keyPattern.test(k)) return id
  }
  return null
}

export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname
    return h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]" || /^127\./.test(h) || h.endsWith(".local")
  } catch {
    return false
  }
}
