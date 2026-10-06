import { test } from "node:test"
import assert from "node:assert/strict"
import { classify } from "../src/scan/project.js"

test("accepts js", () => { assert.ok(!classify("src/foo.js", 100).skip) })
test("skips lockfile", () => { assert.equal(classify("package-lock.json", 100).skip, "lockfile") })
test("skips .env", () => { assert.equal(classify(".env", 100).skip, "secret") })
test("keeps .env.example", () => { assert.ok(!classify(".env.example", 100).skip) })
test("skips too-large", () => { assert.equal(classify("src/big.ts", 300 * 1024).skip, "too-large") })
test("skips unknown extension", () => { assert.ok(classify("foo.xyz", 100).skip) })
test("skips big json", () => { assert.equal(classify("data.json", 25 * 1024).skip, "data-file") })
test("skips service-account.json", () => { assert.equal(classify("service-account.json", 100).skip, "secret") })
