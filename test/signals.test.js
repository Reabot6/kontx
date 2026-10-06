import { test } from "node:test"
import assert from "node:assert/strict"
import { scanSignals } from "../src/analyze/signals.js"

const f = (content, family = "js") => ({ path: "src/f.js", content, lang: "JavaScript", family, kind: "code" })

test("detects eval", () => {
  const { signals } = scanSignals([f("eval(userInput)")])
  assert.ok(signals.some((s) => s.rule === "eval"))
})
test("detects sql injection", () => {
  const { signals } = scanSignals([f('db.query("SELECT * FROM users WHERE id=" + req.params.id)')])
  assert.ok(signals.some((s) => s.rule === "sql-concat"), JSON.stringify(signals.map((s)=>s.rule)))
})
test("detects empty catch", () => {
  const { signals } = scanSignals([f("try { x() } catch (e) {}")])
  assert.ok(signals.some((s) => s.rule === "empty-catch"))
})
test("detects async-forEach", () => {
  const { signals } = scanSignals([f("items.forEach(async (x) => { await doThing(x) })")])
  assert.ok(signals.some((s) => s.rule === "async-foreach"))
})
test("respects kinds filter", () => {
  const { signals } = scanSignals([f("eval(x)")], { kinds: ["bug"] })
  assert.ok(!signals.some((s) => s.rule === "eval"))
})
test("skips test paths by default", () => {
  const tf = { ...f("eval(x)"), path: "src/__tests__/foo.test.js" }
  const { signals } = scanSignals([tf])
  assert.equal(signals.length, 0)
})
