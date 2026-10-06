import { test } from "node:test"
import assert from "node:assert/strict"
import { redact } from "../src/scan/redact.js"

test("redacts anthropic key", () => {
  const { text, hits } = redact('const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz01234567"')
  assert.ok(text.includes("[REDACTED]"), text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, "anthropic-key")
})
test("redacts private key block", () => {
  const { text, hits } = redact("-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----")
  assert.ok(text.includes("[REDACTED PRIVATE KEY]"))
  assert.equal(hits.length, 1)
})
test("skips placeholder values", () => {
  const { text, hits } = redact('const k = "your-key-here"')
  assert.ok(text.includes("your-key-here"))
  assert.equal(hits.length, 0)
})
test("redacts env assignment", () => {
  const { text, hits } = redact("API_KEY=realverylongkey1234567890\n")
  assert.ok(text.includes("[REDACTED]"), text)
  assert.ok(hits.length > 0)
})
test("redacts url credentials", () => {
  const { text } = redact("postgres://user:secretpassword@host/db")
  assert.ok(!text.includes("secretpassword"), text)
})
test("preserves line count", () => {
  const src = 'key="sk-ant-api03-abcdefghijklmnopqrstuvwxyz01234567"\nother\n'
  const { text } = redact(src)
  assert.equal(text.split("\n").length, src.split("\n").length)
})
