import fs from "node:fs"
import path from "node:path"
import { scanProject } from "./scan/project.js"
import { analyzeProject } from "./analyze/facts.js"
import { resolveProvider } from "./config.js"
import { createProvider } from "./providers/index.js"
import { Cache, ensureOwnitDir, readState, writeState } from "./cache.js"
import { gitInfo } from "./git.js"
import { buildHeader, footer, cleanAi, missingHeadings, estimateTokens as tok, fmt, relTime } from "./render.js"
import { c, spinner, ok, warn, note, log, confirm, isInteractive } from "./ui.js"
import { UsageError, OwnitError } from "./errors.js"
import { PROMPT_VERSION } from "./prompts.js"

const numberLines = (text) => {
  const lines = text.split("\n")
  const w = String(lines.length).length
  return lines.map((l, i) => `${String(i + 1).padStart(w)}| ${l}`).join("\n")
}
const safe = (s) => s.replace(/<\/(file|files|task|project_facts|skeletons|not_shown|diff)>/g, "<\\/$1>")

/**
 * Fit a unit into `budget` tokens. Deterministic tiers — no extra AI calls:
 *   1. full source for the highest-priority files
 *   2. one-line skeletons (declarations + imports) for the rest
 *   3. bare paths for whatever still doesn't fit
 * Files marked `must` (ones the user named) are truncated rather than dropped.
 */
export function buildPrompt(unit, budget) {
  const fixed = tok(unit.system) + tok(unit.context) + tok(unit.task) + 300
  const remaining = Math.max(1500, budget - fixed)
  const order = [...unit.files].sort((a, b) => (b.must ? 1 : 0) - (a.must ? 1 : 0) || (b.priority || 0) - (a.priority || 0) || a.path.localeCompare(b.path))
  const full = []
  const deferred = []
  const truncated = []
  let used = 0
  for (const f of order) {
    const body = unit.numbered ? numberLines(f.content) : f.content
    const t = tok(body)
    const limit = f.must ? remaining : remaining * 0.85
    if (used + t <= limit) {
      full.push({ f, body })
      used += t
    } else if (f.must && remaining - used > 400) {
      const keep = Math.floor((remaining - used) * 3.5 * 0.95)
      const lines = body.split("\n")
      let acc = 0
      let n = 0
      while (n < lines.length && acc + lines[n].length + 1 <= keep) acc += lines[n++].length + 1
      full.push({ f, body: lines.slice(0, n).join("\n"), shown: `1-${n}`, total: lines.length })
      truncated.push(f.path)
      used = remaining
    } else deferred.push(f)
  }
  let left = remaining - used
  const skels = []
  const listed = []
  for (const f of deferred) {
    const s = unit.skeleton?.(f.path)
    if (s && tok(s) + 2 <= left) {
      skels.push(s)
      left -= tok(s) + 2
    } else listed.push(f.path)
  }
  const parts = [`<project_facts>\n${safe(unit.context)}\n</project_facts>`]
  if (full.length) {
    parts.push("<files>\n" + full.map(({ f, body, shown, total }) => `<file path="${f.path}" lines="${total ?? body.split("\n").length}" mode="${shown ? `truncated, showing lines ${shown}` : "full"}">\n${safe(body)}\n</file>`).join("\n") + "\n</files>")
  }
  if (skels.length) parts.push(`<skeletons note="declarations only — bodies not shown. * = exported">\n${safe(skels.join("\n"))}\n</skeletons>`)
  if (listed.length) parts.push(`<not_shown note="paths only — too large to include">\n${listed.slice(0, 300).join("\n")}${listed.length > 300 ? `\n… +${listed.length - 300} more` : ""}\n</not_shown>`)
  parts.push(`<task>\n${unit.task}\n</task>`)
  const user = parts.join("\n\n")
  return { system: unit.system, user, tokens: tok(unit.system) + tok(user), counts: { full: full.length, skeleton: skels.length, listed: listed.length }, truncated }
}

export function writeOut(root, rel, content, { backupIfExists = false } = {}) {
  const abs = path.resolve(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (path.relative(root, abs).split(path.sep)[0] === ".ownit") ensureOwnitDir(root)
  if (backupIfExists && fs.existsSync(abs)) {
    const bak = path.join(root, ".ownit", `${path.basename(rel)}.backup`)
    ensureOwnitDir(root)
    fs.copyFileSync(abs, bak)
  }
  fs.writeFileSync(abs, content)
  return path.relative(root, abs).split(path.sep).join("/")
}

export async function runReport(cmd, ctx) {
  const { opts, cwd, signal } = ctx
  const aiOff = Boolean(opts.noAi)
  const resolved = aiOff ? null : resolveProvider(opts)
  resolved?.warnings.forEach(warn)
  const provider = resolved ? createProvider(resolved) : null

  const sp = spinner("Reading your project…")
  let project
  try {
    project = scanProject({ cwd, exclude: opts.exclude, maxFileKb: opts.maxFileKb })
  } catch (e) {
    sp.fail("Could not read this folder")
    throw e
  }
  const skippedN = Object.entries(project.counts).filter(([k]) => ["too-large", "minified", "generated", "data-file", "binary", "secret"].includes(k))
  if (!project.files.length && !cmd.allowEmpty) {
    sp.fail("No source files found")
    throw new UsageError("There's nothing to analyse in this folder.", { hint: "Run ownit from your project root. Check .gitignore / .ownitignore aren't excluding everything." })
  }
  sp.succeed(`Read ${fmt(project.files.length)} files · ${fmt(project.totalLines)} lines` + (skippedN.length ? c.dim(` · skipped ${skippedN.map(([k, n]) => `${n} ${k}`).join(", ")}`) : ""))
  if (project.redactions.length) warn(`Redacted ${project.redactions.length} secret-looking value(s) in ${new Set(project.redactions.map((r) => r.file)).size} file(s) — they are never sent or saved.`)

  const facts = analyzeProject(project)
  const git = gitInfo(cwd)
  const job = await cmd.prepare({ ...ctx, project, facts, git, provider })
  if (job.empty) return log(job.empty)

  const cache = new Cache(project.root)
  const state = readState(project.root)
  const results = []
  const totals = { calls: 0, input: 0, output: 0, reused: 0, savedTokens: 0 }
  let truncatedOutput = false
  const dry = []

  const consentOk = async (prompts) => {
    if (provider.local || opts.yes || state.consent?.[provider.host]) return
    const files = new Set(prompts.flatMap((p) => p.paths)).size
    const total = prompts.reduce((s, p) => s + p.tokens, 0)
    if (!isInteractive()) throw new UsageError(`ownit would send code to ${provider.host}, and nobody is here to confirm.`, { hint: "Re-run with --yes to allow it (or use --no-ai / --dry-run)." })
    log(`\nownit will send ${c.bold(`~${fmt(total)} tokens`)} of this project (${files} files, secrets redacted) to ${c.bold(provider.host)}.`)
    if (!(await confirm("Continue?", true))) throw new OwnitError("Cancelled — nothing was sent.", { exitCode: 130 })
    state.consent = { ...state.consent, [provider.host]: new Date().toISOString() }
    writeState(project.root, state)
  }

  if (!aiOff) {
    // Plan every unit first, so cache hits never trigger a consent prompt.
    let budget = provider.contextTokens
    for (const unit of job.units) {
      for (let attempt = 0; ; attempt++) {
        const p = buildPrompt(unit, budget)
        const key = cache.key([PROMPT_VERSION, provider.protocol, provider.host, provider.model, p.system, p.user])
        const hit = opts.fresh ? null : cache.get(key)
        const info = { unit, p, key, hit, paths: unit.files.map((f) => f.path) }
        if (hit || opts.dryRun) {
          dry.push(info)
          break
        }
        await consentOk([info])
        const s = spinner(`${unit.label || "Asking"} ${c.dim(provider.model)}…`)
        try {
          const res = await provider.complete({
            system: p.system,
            user: p.user,
            maxTokens: opts.maxOutput || provider.maxOutput,
            signal,
            onRetry: ({ attempt: n, reason }) => s.update(`${reason} — retrying (${n}/3)…`),
          })
          s.succeed(`${unit.label || "Answer"} received ${c.dim(`(${fmt(res.usage.input)} in / ${fmt(res.usage.output)} out)`)}`)
          totals.calls++
          totals.input += res.usage.input
          totals.output += res.usage.output
          const truncated = res.stopReason === "length"
          if (truncated) truncatedOutput = true
          else cache.set(key, { text: res.text, usage: res.usage, model: provider.model, command: cmd.name })
          cache.record({ call: 1, used: res.usage.input + res.usage.output })
          dry.push({ ...info, res, truncated })
          break
        } catch (err) {
          s.fail(err.kind === "context" ? "Request too large for this model/plan" : "Request failed")
          if (err.kind === "context" && attempt < 4 && budget > 3000) {
            budget = Math.floor(budget / 2)
            warn(`Retrying with a smaller context budget (${fmt(budget)} tokens) — less code per request, more skeletons.`)
            continue
          }
          throw err
        }
      }
    }
  }

  if (opts.dryRun) {
    log(`\n${c.bold("Dry run")} — nothing was sent.`)
    if (aiOff) return note("--no-ai: only the computed facts would be written.")
    for (const d of dry) {
      log(`  ${d.unit.label || d.unit.id}: ~${fmt(d.p.tokens)} tokens → ${provider.host}/${provider.model}  [${d.p.counts.full} full, ${d.p.counts.skeleton} skeleton, ${d.p.counts.listed} path-only]${d.hit ? c.green("  (cached — would cost 0)") : ""}`)
    }
    return log(c.dim(`  Budget per request: ${fmt(provider.contextTokens)} tokens. Change with --budget.`))
  }

  const texts = []
  for (const d of dry) {
    if (d.hit) {
      totals.reused++
      totals.savedTokens += (d.hit.usage?.input || 0) + (d.hit.usage?.output || 0)
      cache.record({ hit: 1, saved: (d.hit.usage?.input || 0) + (d.hit.usage?.output || 0) })
      texts.push({ text: d.hit.text, cachedAt: d.hit.createdAt, unit: d.unit })
    } else texts.push({ text: d.res.text, unit: d.unit })
    const miss = missingHeadings(texts.at(-1).text, d.unit.expect)
    if (miss.length) warn(`The model skipped section(s): ${miss.join(", ")}. Try --fresh, or a stronger model.`)
    if (d.p.truncated.length) warn(`Too big to show fully (cut to fit the budget): ${d.p.truncated.join(", ")}`)
  }

  const header = job.raw ? "" : buildHeader({ command: cmd.name, title: job.title, subtitle: job.subtitle, project: project.name, git, model: provider?.model, aiUsed: !aiOff })
  const body = []
  if (job.factsMd) body.push(job.factsMd)
  job.units.forEach((u, i) => {
    if (u.heading) body.push(`## ${u.heading}`)
    if (u.factsMd) body.push(u.factsMd)
    if (texts[i]) body.push(cleanAi(texts[i].text, u.headingLevel || 2))
  })
  if (truncatedOutput) body.push("> ⚠️ The model hit its output limit, so this report may be cut off. Re-run with a higher `--max-output`.")
  if (aiOff && job.units.length) body.push("> ℹ️ Run without `--no-ai` to add the AI-written explanation.")

  const writes = job.finalize
    ? job.finalize({ texts: texts.map((t) => t?.text || ""), header, body: body.join("\n\n"), aiOff })
    : [{ path: job.output, content: `${header}\n${body.join("\n\n")}\n${footer()}` }]
  const written = []
  for (const w of writes) {
    if (w.skipIfExists && fs.existsSync(path.resolve(project.root, w.path))) continue
    written.push(writeOut(project.root, opts.output && w === writes[0] ? opts.output : w.path, w.content, { backupIfExists: w.backup }))
  }

  // summary
  const everythingCached = !aiOff && job.units.length > 0 && totals.calls === 0 && totals.reused === job.units.length
  if (everythingCached) {
    const oldest = Math.min(...texts.map((t) => t.cachedAt))
    ok(`${c.bold("Nothing changed")} since your last ${cmd.name} run (${relTime(oldest)}) — reused the saved result. ${c.green("0 tokens used")}${totals.savedTokens ? c.dim(` (saved ≈ ${fmt(totals.savedTokens)})`) : ""}`)
    note("Want a fresh answer anyway? Add --fresh.")
  } else if (!aiOff) {
    ok(`Done — ${totals.calls} API call${totals.calls === 1 ? "" : "s"}, ${fmt(totals.input)} in / ${fmt(totals.output)} out tokens` + (totals.reused ? c.dim(` · reused ${totals.reused} cached (saved ≈ ${fmt(totals.savedTokens)})`) : ""))
  } else ok("Done — no AI used, 0 tokens.")
  for (const w of written) log(`  ${c.cyan("→")} ${w}`)
}
