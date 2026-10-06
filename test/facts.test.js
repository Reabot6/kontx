import { test } from "node:test"
import assert from "node:assert/strict"
import { extractSymbols, scanEnvLine, isTestPath } from "../src/analyze/facts.js"

const jsFile = (content) => ({ path: "src/foo.js", content, lang: "JavaScript", family: "js", kind: "code" })
const pyFile = (content) => ({ path: "src/foo.py", content, lang: "Python", family: "py", kind: "code" })

test("extracts JS function", () => {
  const s = extractSymbols(jsFile("export function hello() {}"))
  assert.ok(s.some((x) => x.name === "hello" && x.kind === "function" && x.exported))
})
test("extracts arrow exported const", () => {
  const s = extractSymbols(jsFile("export const fn = async (x) => x"))
  assert.ok(s.some((x) => x.name === "fn" && x.exported))
})
test("extracts class", () => {
  const s = extractSymbols(jsFile("class Foo {}"))
  assert.ok(s.some((x) => x.name === "Foo" && x.kind === "class"))
})
test("extracts Python def", () => {
  const s = extractSymbols(pyFile("def my_func(x):\n  return x"))
  assert.ok(s.some((x) => x.name === "my_func" && x.kind === "function"))
})
test("scanEnvLine JS process.env", () => {
  const r = scanEnvLine("const k = process.env.MY_KEY")
  assert.ok(r.some((e) => e.name === "MY_KEY"))
})
test("scanEnvLine with default", () => {
  const r = scanEnvLine("const p = process.env.PORT || 3000")
  assert.ok(r.some((e) => e.name === "PORT" && e.hasDefault))
})
test("scanEnvLine Python os.environ.get", () => {
  const r = scanEnvLine('key = os.environ.get("SECRET", None)')
  assert.ok(r.some((e) => e.name === "SECRET" && e.hasDefault))
})
test("isTestPath", () => {
  assert.ok(isTestPath("src/__tests__/foo.test.ts"))
  assert.ok(isTestPath("test/bar_test.go"))
  assert.ok(!isTestPath("src/index.ts"))
})
