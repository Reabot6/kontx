import { openaiAdapter } from "./openai.js"
import { anthropicAdapter } from "./anthropic.js"
import { googleAdapter } from "./google.js"
import { UsageError } from "../errors.js"

const ADAPTERS = { openai: openaiAdapter, anthropic: anthropicAdapter, google: googleAdapter }

/**
 * Build a provider from a resolved config (see config.js#resolveProvider).
 * Every provider exposes the same two methods:
 *   complete({ system, user, maxTokens, signal }) → { text, stopReason: "end"|"length", usage: { input, output } }
 *   listModels() → [{ id }]
 */
export function createProvider(resolved) {
  const make = ADAPTERS[resolved.protocol]
  if (!make) throw new UsageError(`Unknown protocol "${resolved.protocol}".`, { hint: "Use one of: openai, anthropic, google." })
  const adapter = make(resolved)
  return {
    id: resolved.id,
    label: resolved.label,
    protocol: resolved.protocol,
    host: resolved.host,
    model: resolved.model,
    local: resolved.local,
    contextTokens: resolved.contextTokens,
    maxOutput: resolved.maxOutput,
    timeoutMs: resolved.timeoutMs,
    complete: (req) => adapter.complete({ model: resolved.model, timeoutMs: resolved.timeoutMs, ...req }),
    listModels: (req) => adapter.listModels(req),
  }
}
