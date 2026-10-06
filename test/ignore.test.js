import { test } from "node:test"
import assert from "node:assert/strict"
import { IgnoreMatcher, defaultMatcher } from "../src/scan/ignore.js"

test("basic glob", () => {
  const m = new IgnoreMatcher().add("*.log\n", "", 1)
  assert.ok(m.ignores("foo.log"))
  assert.ok(!m.ignores("foo.txt"))
})
test("negation", () => {
  const m = new IgnoreMatcher().add("*.log\n!keep.log\n", "", 1)
  assert.ok(m.ignores("a.log"))
  assert.ok(!m.ignores("keep.log"))
})
test("dir-only slash", () => {
  const m = new IgnoreMatcher().add("node_modules/\n", "", 1)
  assert.ok(m.ignores("node_modules", true))
  assert.ok(!m.ignores("node_modules.js"))
})
test("anchored /build", () => {
  const m = new IgnoreMatcher().add("/build\n", "", 1)
  assert.ok(m.ignores("build", true))
  assert.ok(!m.ignores("src/build", true))
})
test("double-star", () => {
  const m = new IgnoreMatcher().add("docs/**/*.tmp\n", "", 1)
  assert.ok(m.ignores("docs/a/b/c.tmp"))
  assert.ok(!m.ignores("docs/a/b/c.md"))
})
test("default ignores skip node_modules and dist dirs", () => {
  const m = defaultMatcher()
  assert.ok(m.ignores("node_modules", true))
  assert.ok(m.ignores("dist", true))
  assert.ok(m.ignores(".next", true))
  // package-lock.json is caught by the classify() lockfile rule, not by the ignore engine
  assert.ok(!m.ignores("package-lock.json"))
})
