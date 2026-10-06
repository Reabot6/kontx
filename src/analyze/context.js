import { importedByList } from "./facts.js"
import { fmt } from "../render.js"

/** Compact text version of the static facts, fed to the AI so it never has to discover them. */
export function projectContext(project, facts, { maxEdges = 120 } = {}) {
  const L = []
  const m = facts.manifests.find((x) => x.type === "npm") || facts.manifests[0]
  L.push(`PROJECT: ${m?.name || project.name}${m?.version ? ` v${m.version}` : ""} — ${project.files.length} files, ${fmt(project.totalLines)} lines`)
  if (m?.description) L.push(`DESCRIPTION (from manifest): ${m.description}`)
  L.push(`LANGUAGES: ${facts.langs.map((l) => `${l.lang} ${l.files} files/${fmt(l.lines)} lines`).join("; ") || "none"}`)
  if (m?.moduleType) L.push(`MODULE TYPE: ${m.moduleType}${m.engines?.node ? `, node ${m.engines.node}` : ""}`)
  const scripts = Object.entries(m?.scripts || {})
  if (scripts.length) L.push(`SCRIPTS: ${scripts.map(([k, v]) => `${k}="${v}"`).join("; ")}`)
  if (m && Object.keys(m.bin).length) L.push(`BIN: ${Object.entries(m.bin).map(([k, v]) => `${k} → ${v}`).join(", ")}`)
  L.push(`ENTRY POINTS: ${facts.entries.map((e) => `${e.path} (${e.reasons.join("; ")})`).join(" | ") || "none detected"}`)
  if (facts.deps.length) {
    L.push("DEPENDENCIES (declared → where imported):")
    for (const d of facts.deps.slice(0, 60)) L.push(`  ${d.name}@${d.version} [${d.kind}] ${d.usedBy.length ? `used in ${d.usedBy.slice(0, 4).join(", ")}${d.usedBy.length > 4 ? ` +${d.usedBy.length - 4}` : ""}` : d.inScripts ? "used in package scripts" : "NO IMPORT FOUND"}`)
  }
  if (facts.undeclared.length) L.push(`IMPORTED BUT NOT DECLARED: ${facts.undeclared.map((u) => `${u.name} (${u.files[0]})`).join(", ")}`)
  if (facts.hasGraph) {
    const edges = []
    for (const [file, imps] of facts.imports) {
      const t = [...new Set(imps.filter((i) => i.kind === "local").map((i) => i.target))]
      if (t.length) edges.push(`${file} -> ${t.join(", ")}`)
    }
    if (edges.length) L.push(`LOCAL IMPORT GRAPH (importer -> imports)${edges.length > maxEdges ? ` [first ${maxEdges} of ${edges.length}]` : ""}:\n  ${edges.slice(0, maxEdges).join("\n  ")}`)
    const hubs = [...facts.importedBy].map(([p, s]) => [p, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (hubs.length) L.push(`MOST IMPORTED: ${hubs.map(([p, n]) => `${p} (${n})`).join(", ")}`)
  } else if (project.files.some((f) => f.kind === "code")) L.push(`IMPORT GRAPH: not available for ${facts.unsupported.join(", ") || "these languages"}`)
  if (facts.envVars.size) L.push(`ENV VARS: ${[...facts.envVars.values()].map((e) => `${e.name} (${e.uses.slice(0, 2).map((u) => `${u.file}:${u.line}`).join(", ")}${e.uses.every((u) => u.hasDefault) ? "; has default" : ""})`).join("; ")}`)
  if (facts.routes.length) L.push(`ROUTES: ${facts.routes.slice(0, 40).map((r) => `${r.method} ${r.path} (${r.file}:${r.line})`).join("; ")}`)
  L.push(`TESTS: ${facts.testFiles.length} test files${facts.frameworks.length ? ` (${facts.frameworks.join(", ")})` : ""}; ${facts.untested.length} source modules with exports that no test imports`)
  const skipped = Object.entries(project.counts).filter(([k]) => ["too-large", "minified", "generated", "data-file", "binary"].includes(k))
  if (skipped.length) L.push(`SKIPPED (not shown to you): ${skipped.map(([k, n]) => `${n} ${k}`).join(", ")}`)
  if (project.redactions.length) L.push(`REDACTED SECRETS: ${project.redactions.length} (${project.redactions.slice(0, 6).map((r) => `${r.file}:${r.line} ${r.kind}`).join(", ")})`)
  return L.join("\n")
}

export function fileContext(facts, p) {
  const syms = facts.symbols.get(p) || []
  const imps = facts.imports.get(p) || []
  const L = [`FILE: ${p}`]
  if (syms.length) L.push(`DECLARES: ${syms.map((s) => `${s.kind} ${s.name}${s.exported ? " [exported]" : ""} line ${s.line}-${s.endLine}`).join("; ")}`)
  const loc = imps.filter((i) => i.kind === "local")
  if (loc.length) L.push(`IMPORTS LOCAL: ${loc.map((i) => `${i.target}${i.names.length ? ` {${i.names.join(", ")}}` : ""} (line ${i.line})`).join("; ")}`)
  const ext = [...new Set(imps.filter((i) => i.kind === "external").map((i) => i.pkg))]
  if (ext.length) L.push(`IMPORTS PACKAGES: ${ext.join(", ")}`)
  const by = importedByList(facts, p)
  L.push(`IMPORTED BY: ${by.length ? by.join(", ") : "nothing in this project (entry point, script, or unused)"}`)
  return L.join("\n")
}
