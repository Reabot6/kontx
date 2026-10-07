#!/usr/bin/env node
const major = Number(process.versions.node.split(".")[0])
if (major < 20) {
  console.error(`kontx needs Node.js 20 or newer (you have ${process.versions.node}).`)
  process.exit(1)
}
const { main } = await import("../src/cli.js")
await main(process.argv.slice(2))
