import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PRESETS, PRESET_ORDER, detectPresetFromKey, isLocalUrl } from "./providers/presets.js"
import { ConfigError, ModelRequiredError, UsageError } from "./errors.js"

export const configDir = () => process.env.kontx_CONFIG_DIR || path.join(os.homedir(), ".kontx")
export const configFile = () => path.join(configDir(), "config.json")

const empty = () => ({ version: 1, default: null, profiles: {} })

export function loadConfig() {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(configFile(), "utf8"))
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ConfigError(`Config file is corrupted: ${configFile()}`, { hint: "Delete it and run `kontx config` again." })
    }
    return empty() // missing / unreadable → treat as not configured
  }
  // Migrate v0.1 format: { key, provider }
  if (raw && raw.key && raw.provider && !raw.profiles) {
    return { version: 1, default: raw.provider, profiles: { [raw.provider]: { provider: raw.provider, apiKey: raw.key } } }
  }
  return { ...empty(), ...raw, profiles: raw?.profiles || {} }
}

export function saveConfig(cfg) {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = configFile()
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
  try {
    fs.chmodSync(file, 0o600) // `mode` is ignored when the file already exists
  } catch {
    /* Windows */
  }
  return file
}

const normalizeBase = (u) => String(u).trim().replace(/\/+$/, "")
const cleanKey = (k) => String(k).trim().replace(/^["']|["']$/g, "")

/**
 * Decide which provider/model/key to use. Precedence (highest first):
 *   1. CLI flags  (--provider --key --model --base-url)
 *   2. Environment (kontx_PROVIDER, kontx_API_KEY, kontx_MODEL, kontx_BASE_URL, ANTHROPIC_API_KEY, …)
 *   3. ~/.kontx/config.json (default profile)
 *   4. Auto-detect from whichever provider API-key env var is set
 */
export function resolveProvider(opts = {}, { env = process.env, config = loadConfig(), needModel = true } = {}) {
  let name = opts.provider || null
  if (!name && opts.key) {
    name = detectPresetFromKey(opts.key)
    if (!name) {
      throw new UsageError("Can't tell which provider that API key belongs to.", {
        hint: "Add --provider (e.g. --provider groq). For any other OpenAI-compatible API use --provider custom --base-url <url>.",
      })
    }
  }
  if (!name && env.kontx_PROVIDER) name = env.kontx_PROVIDER
  if (!name && config.default && config.profiles[config.default]) name = config.default
  if (!name) {
    for (const id of PRESET_ORDER) {
      if ((PRESETS[id].envVars || []).some((k) => env[k])) {
        name = id
        break
      }
    }
  }
  if (!name) {
    throw new ConfigError("No AI provider is set up yet.", {
      hint: "Run `kontx config`, or export a key such as ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or GROQ_API_KEY.",
    })
  }

  const profile = config.profiles[name] || null
  const presetId = profile?.provider || name
  const preset = PRESETS[presetId]
  if (!preset) {
    throw new UsageError(`Unknown provider "${name}".`, {
      hint: `Built in: ${PRESET_ORDER.join(", ")}. Run \`kontx config\` to add your own endpoint.`,
    })
  }

  const protocol = profile?.protocol || opts.protocol || preset.protocol
  const rawBase = opts.baseUrl || env.kontx_BASE_URL || profile?.baseUrl || preset.baseUrl
  if (!rawBase) {
    throw new UsageError(`"${name}" needs a base URL.`, { hint: "Pass --base-url https://your-host/v1 (or run `kontx config`)." })
  }
  const baseUrl = normalizeBase(rawBase)
  let host
  try {
    host = new URL(baseUrl).host
  } catch {
    throw new UsageError(`"${rawBase}" is not a valid URL.`, { hint: "It should look like https://api.example.com/v1" })
  }
  const local = Boolean(preset.local) || isLocalUrl(baseUrl)
  const warnings = []
  if (/^http:\/\//.test(baseUrl) && !local) warnings.push(`${host} uses plain http:// — your API key will be sent unencrypted.`)

  // API key
  let apiKey = opts.key || env.kontx_API_KEY || null
  let keySource = opts.key ? "--key" : apiKey ? "$kontx_API_KEY" : null
  if (!apiKey) {
    for (const k of [...(preset.envVars || []), profile?.apiKeyEnv].filter(Boolean)) {
      if (env[k]) {
        apiKey = env[k]
        keySource = `$${k}`
        break
      }
    }
  }
  if (!apiKey && profile?.apiKey) {
    apiKey = profile.apiKey
    keySource = "saved config"
  }
  if (apiKey) apiKey = cleanKey(apiKey)
  if (!apiKey && !preset.keyOptional && !local) {
    throw new ConfigError(`No API key found for ${preset.label}.`, {
      hint: `Run \`kontx config\`${preset.envVars?.[0] ? `, or export ${preset.envVars[0]}` : ""}.`,
    })
  }

  const model = opts.model || env.kontx_MODEL || profile?.model || preset.defaultModel || null
  const resolved = {
    id: name,
    preset: presetId,
    label: profile?.label || preset.label,
    protocol,
    baseUrl,
    host,
    apiKey,
    keySource,
    model,
    local,
    contextTokens: opts.budget || profile?.contextTokens || (local ? 8_000 : 60_000),
    maxOutput: opts.maxOutput || profile?.maxOutput || 8_000,
    timeoutMs: (opts.timeout || profile?.timeout || 300) * 1000,
    warnings,
  }

  if (!model && needModel) {
    throw new ModelRequiredError(`No model chosen for ${resolved.label}.`, resolved, {
      hint: "Pass --model <id>, or run `kontx config` to pick one from the live list.",
    })
  }
  return resolved
}
