import path from "node:path"
import fs from "node:fs"
import process from "node:process"
import { c, log, warn, note, ok, spinner, ask, confirm, isInteractive } from "./ui.js"
import { VERSION } from "./version.js"
import { kontxError, UsageError, ConfigError, ModelRequiredError } from "./errors.js"
import { runReport } from "./run.js"
import { loadConfig, saveConfig, resolveProvider, configDir } from "./config.js"
import { createProvider } from "./providers/index.js"
import { PRESETS, PRESET_ORDER } from "./providers/presets.js"
import { Cache, readState } from "./cache.js"

const COMMANDS = {
  full: () => import("./commands/full.js"),
  risk: () => import("./commands/risk.js"),
  readme: () => import("./commands/readme.js"),
  qa: () => import("./commands/qa.js"),
  bug: () => import("./commands/bug.js"),
  env: () => import("./commands/env.js"),
  diff: () => import("./commands/diff.js"),
  add: () => import("./commands/add.js"),
  stack: () => import("./commands/stack.js"),
  flow: () => import("./commands/flow.js"),
  mix: () => import("./commands/mix.js"),
}

const HELP = `
${c.bold("kontx")} v${VERSION} — understand, audit and document any codebase with AI

${c.bold("USAGE")}
  kontx <command> [options]

${c.bold("COMMANDS")}
  full        Full codebase audit (architecture, deps, env, tests, risk)
  risk        Security and quality risk report
  readme      Generate or refresh README.md
  qa          QA checklist — coverage gaps and edge cases
  bug         Hunt for bugs and logic errors
  env         Audit environment variables
  diff        Review staged changes or a branch diff
  stack       Document the tech stack and architecture
  flow <file> Trace execution flow from a file
  add <feat>  Plan how to add a feature
  mix <a> <b> Compare two files
  config      Set up or change your AI provider
  models      List models available with your current key
  cache       Show cache stats  (--clear to wipe)

${c.bold("GLOBAL OPTIONS")}
  --model <id>        Override the model (e.g. claude-sonnet-5-5, gpt-4o, llama3-70b-8192)
  --provider <name>   Force a provider (anthropic, openai, google, groq, openrouter, ollama…)
  --key <key>         API key for this run (not saved)
  --base-url <url>    Custom OpenAI-compatible base URL
  --budget <tokens>   Context token budget (default: 60000)
  --max-output <n>    Max output tokens per request (default: 8000)
  --timeout <secs>    Request timeout (default: 300)
  --exclude <glob>    Extra ignore pattern (repeatable)
  --output <file>     Write output to this path instead of .kontx/
  --fresh             Ignore cache and make a new request
  --no-ai             Only compute static facts, skip AI
  --dry-run           Show what would be sent without sending
  --yes               Skip consent prompt (CI / scripts)
  --no-color          Disable colour output

${c.bold("EXAMPLES")}
  kontx config
  kontx full
  kontx risk --model gemini-2.5-pro
  kontx diff --base main
  kontx flow src/index.js
  kontx add 'add rate limiting to all routes'
  kontx mix src/auth.js src/middleware.js
  ANTHROPIC_API_KEY=sk-ant-... kontx full --dry-run
`.trim()

function parseArgs(argv) {
  const opts = { _args: [], exclude: [] }
  let i = 0
  const take = () => argv[++i]
  while (i < argv.length) {
    const a = argv[i]
    if (a === "--model" || a === "-m") opts.model = take()
    else if (a === "--provider") opts.provider = take()
    else if (a === "--key") opts.key = take()
    else if (a === "--base-url") opts.baseUrl = take()
    else if (a === "--budget") opts.budget = Number(take())
    else if (a === "--max-output") opts.maxOutput = Number(take())
    else if (a === "--timeout") opts.timeout = Number(take())
    else if (a === "--output") opts.output = take()
    else if (a === "--exclude") opts.exclude.push(take())
    else if (a === "--base") opts.base = take()
    else if (a === "--target") opts.target = take()
    else if (a === "--feature") opts.feature = take()
    else if (a === "--overwrite") opts.overwrite = true
    else if (a === "--staged") opts.staged = true
    else if (a === "--fresh") opts.fresh = true
    else if (a === "--no-ai") opts.noAi = true
    else if (a === "--dry-run") opts.dryRun = true
    else if (a === "--yes" || a === "-y") opts.yes = true
    else if (a === "--no-color") {} // handled by ui.js
    else if (a === "--clear") opts.clear = true
    else if (a === "--verbose") opts.verbose = true
    else if (!a.startsWith("-")) opts._args.push(a)
    i++
  }
  return opts
}

/* ── built-in commands ─────────────────────────────────── */

async function runConfig(opts) {
  const cfg = loadConfig()
  log(`\n${c.bold("kontx config")} — AI provider setup\n`)
  log("Providers:")
  PRESET_ORDER.forEach((id, i) => {
    const p = PRESETS[id]
    const saved = cfg.profiles[id]
    const tick = saved ? c.green("✔") : " "
    const star = cfg.default === id ? c.cyan(" (default)") : ""
    log(`  ${tick} ${String(i + 1).padStart(2)}. ${p.label}${star}`)
  })
  const choice = (await ask(`\nPick a number (or press Enter to keep current default): `)).trim()
  const idx = parseInt(choice, 10) - 1
  if (!choice || isNaN(idx) || idx < 0 || idx >= PRESET_ORDER.length) {
    if (cfg.default) { note(`Keeping ${c.bold(cfg.default)}`); return }
    throw new UsageError("No provider selected.")
  }
  const id = PRESET_ORDER[idx]
  const preset = PRESETS[id]
  let apiKey = cfg.profiles[id]?.apiKey || null
  if (!preset.keyOptional) {
    const hint = preset.envVars?.[0] ? ` (or set ${preset.envVars[0]})` : ""
    const current = apiKey ? ` [leave blank to keep current]` : ""
    const raw = await ask(`${preset.label} API key${hint}${current}: `, { mask: true })
    if (raw.trim()) apiKey = raw.trim()
    if (!apiKey) { log(c.red("No key entered.")); return }
  }
  let model = cfg.profiles[id]?.model || preset.defaultModel || null
  log("\nFetching available models…")
  let models = []
  try {
    const tmp = createProvider({ id, preset: id, protocol: preset.protocol, baseUrl: preset.baseUrl, apiKey, model: model || "x", host: new URL(preset.baseUrl || "http://x").host, contextTokens: 60000, maxOutput: 8000, timeoutMs: 30000, local: preset.local || false })
    models = (await tmp.listModels()).slice(0, 40)
  } catch (e) {
    warn(`Could not list models (${e.message}). You can set one manually.`)
  }
  if (models.length) {
    log("\nAvailable models:")
    models.slice(0, 25).forEach((m, i) => log(`  ${String(i + 1).padStart(2)}. ${m.id}`))
    if (models.length > 25) note(`  … and ${models.length - 25} more`)
    const mc = (await ask(`\nPick a model number (or type an id, or press Enter for default): `)).trim()
    const mi = parseInt(mc, 10) - 1
    if (!isNaN(mi) && mi >= 0 && mi < models.length) model = models[mi].id
    else if (mc && !/^\d+$/.test(mc)) model = mc
    else if (!mc && (preset.defaultModel || models[0])) model = preset.defaultModel || models[0].id
  } else {
    const typed = (await ask(`Model id (e.g. ${preset.defaultModel || "gpt-4o"}): `)).trim()
    if (typed) model = typed
  }
  cfg.profiles[id] = { ...cfg.profiles[id], provider: id, apiKey, model }
  cfg.default = id
  const file = saveConfig(cfg)
  ok(`Saved to ${file}`)
  log(`  provider: ${c.bold(preset.label)}  model: ${c.bold(model)}`)
}

async function runModels(opts) {
  const resolved = resolveProvider(opts, { needModel: false })
  const provider = createProvider({ ...resolved, model: resolved.model || "x" })
  const sp = spinner(`Fetching models from ${resolved.host}…`)
  let models
  try {
    models = await provider.listModels()
    sp.succeed(`${models.length} models`)
  } catch (e) {
    sp.fail("Failed")
    throw e
  }
  models.forEach((m) => log(`  ${m.id}`))
}

async function runCache(opts) {
  const cwd = process.cwd()
  const cache = new Cache(cwd)
  if (opts.clear) {
    const n = cache.clear()
    ok(`Cleared ${n} cache entries from ${cwd}`)
    return
  }
  const s = cache.stats()
  const entries = cache.entries()
  log(`\n${c.bold("kontx cache")} — ${cwd}\n`)
  log(`  Entries: ${entries.length}`)
  log(`  Cache hits: ${s.hits}`)
  log(`  API calls: ${s.calls}`)
  log(`  Tokens used: ${s.tokensUsed.toLocaleString()}`)
  log(`  Tokens saved: ${s.tokensSaved.toLocaleString()}`)
  log(`\n  ${c.dim("Run with --clear to wipe.")}`)
}

/* ── main ─────────────────────────────────── */

export async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { log(HELP); return }
  if (cmd === "--version" || cmd === "-v") { log(`kontx v${VERSION}`); return }
  const opts = parseArgs(rest)

  const ctrl = new AbortController()
  const onSig = () => ctrl.abort()
  process.once("SIGINT", onSig)
  process.once("SIGTERM", onSig)

  try {
    if (cmd === "config") return await runConfig(opts)
    if (cmd === "models") return await runModels(opts)
    if (cmd === "cache") return await runCache(opts)

    const loader = COMMANDS[cmd]
    if (!loader) {
      // did user type a file path as the command? (kontx src/index.js)
      if (fs.existsSync(path.resolve(process.cwd(), cmd))) {
        opts._args.unshift(cmd)
        const { prepare, meta } = await COMMANDS.flow()
        return await runReport({ ...meta, prepare }, { opts, cwd: process.cwd(), signal: ctrl.signal })
      }
      log(c.red(`Unknown command: ${cmd}\n`))
      log(HELP)
      process.exitCode = 2
      return
    }
    const mod = await loader()
    await runReport({ ...mod.meta, prepare: mod.prepare }, { opts, cwd: process.cwd(), signal: ctrl.signal })
  } catch (err) {
    process.removeListener("SIGINT", onSig)
    process.removeListener("SIGTERM", onSig)
    if (err?.name === "AbortError" || err?.kind === "aborted") {
      log(`\n${c.yellow("Cancelled.")}`)
      process.exitCode = 130
      return
    }
    if (err instanceof ModelRequiredError) {
      log(c.red(`\n✖ ${err.message}`))
      note("Available models:")
      try {
        const tmp = createProvider({ ...err.resolved, model: "x" })
        const ms = (await tmp.listModels()).slice(0, 20)
        ms.forEach((m) => note(`  ${m.id}`))
      } catch {
        note("(Could not fetch — check your API key)")
      }
      note(`\nRe-run with: --model <id>   or run: kontx config`)
      process.exitCode = 1
      return
    }
    if (err instanceof kontxError) {
      log(c.red(`\n✖ ${err.message}`))
      if (err.hint) note(err.hint)
      if (opts.verbose && err.cause) note(String(err.cause))
      process.exitCode = err.exitCode ?? 1
      return
    }
    // Unexpected error
    log(c.red(`\n✖ Unexpected error: ${err?.message || err}`))
    if (err?.stack && opts.verbose) log(c.dim(err.stack))
    else note("Re-run with --verbose for a stack trace.")
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", onSig)
    process.removeListener("SIGTERM", onSig)
  }
}
