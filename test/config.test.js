import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveProvider } from "../src/config.js"
import { UsageError, ConfigError } from "../src/errors.js"

const noConfig = { version: 1, default: null, profiles: {} }

test("auto-detects provider from ANTHROPIC_API_KEY", () => {
  const r = resolveProvider({}, { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, config: noConfig, needModel: false })
  assert.equal(r.preset, "anthropic")
})
test("auto-detects groq from GROQ_API_KEY", () => {
  const r = resolveProvider({}, { env: { GROQ_API_KEY: "gsk_test" }, config: noConfig, needModel: false })
  assert.equal(r.preset, "groq")
})
test("flag --provider wins over env", () => {
  const r = resolveProvider({ provider: "openai", key: "sk-12345678901234567890123456789012" }, { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, config: noConfig, needModel: false })
  assert.equal(r.preset, "openai")
})
test("throws ConfigError when no provider or key", () => {
  assert.throws(() => resolveProvider({}, { env: {}, config: noConfig, needModel: false }), ConfigError)
})
test("throws UsageError for unknown provider name", () => {
  assert.throws(() => resolveProvider({ provider: "fakeprovider" }, { env: {}, config: noConfig, needModel: false }), UsageError)
})
test("reads model from saved profile", () => {
  const cfg = { version: 1, default: "anthropic", profiles: { anthropic: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" } } }
  const r = resolveProvider({}, { env: {}, config: cfg, needModel: true })
  assert.equal(r.model, "claude-haiku-4-5-20251001")
})
test("--model flag wins over saved profile", () => {
  const cfg = { version: 1, default: "anthropic", profiles: { anthropic: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" } } }
  const r = resolveProvider({ model: "claude-opus-5-5" }, { env: {}, config: cfg, needModel: true })
  assert.equal(r.model, "claude-opus-5-5")
})
