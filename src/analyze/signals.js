import { lineIndex, isTestPath } from "./facts.js"

/** Static "smells" with exact file:line evidence. The AI later triages them — it does not find them. */
const R = (id, kind, sev, title, re, fams) => ({ id, kind, sev, title, re, fams })

export const RULES = [
  R("eval", "risk", "high", "Dynamic code execution (eval / new Function)", /\beval\s*\(|new\s+Function\s*\(/g, ["js", "py"]),
  R("exec-js", "risk", "medium", "Shell / process execution", /child_process|(?<![.\w])(?:execSync|spawnSync|execFileSync)\s*\(/g, ["js"]),
  R("exec-py", "risk", "high", "Shell execution", /\bos\.system\s*\(|\bos\.popen\s*\(|subprocess\.\w+\([^)\n]*shell\s*=\s*True/g, ["py"]),
  R("sql-concat", "risk", "high", "SQL built from strings (injection risk)", /\b(?:SELECT\s[^;\n]*\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^;\n]*(?:\$\{|["'`]\s*\+|%s|\.format\(|\bf["'])/gi, null),
  R("xss", "risk", "medium", "Raw HTML injection", /dangerouslySetInnerHTML|\.innerHTML\s*=|\bv-html\b|document\.write\s*\(/g, ["js"]),
  R("tls-off", "risk", "high", "TLS verification disabled", /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED|InsecureSkipVerify:\s*true/g, null),
  R("cors-open", "risk", "medium", "CORS open to every origin", /origin\s*:\s*(?:['"]\*['"]|true)\b|Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*|\bcors\(\s*\)/g, null),
  R("weak-hash", "risk", "medium", "Weak hash (MD5 / SHA-1)", /createHash\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\(/g, null),
  R("http-url", "risk", "low", "Plain http:// URL", /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[^'"\s]+/g, null),
  R("deserialize", "risk", "high", "Unsafe deserialization", /\bpickle\.loads?\(|\byaml\.load\((?![^)\n]*Loader)|\bunserialize\(/g, ["py", "php"]),
  R("weak-random", "risk", "medium", "Math.random() used for something secret-like", /(?:token|secret|password|session|nonce|apikey|key)[^\n]{0,60}Math\.random|Math\.random[^\n]{0,60}(?:token|secret|password|session|nonce)/gi, ["js"]),
  R("path-traversal", "risk", "high", "User input flows into a file path", /(?:path\.join|readFile(?:Sync)?|createReadStream|open)\([^)\n]*\b(?:req|request|ctx)\.(?:params|query|body)/g, ["js", "py"]),
  R("debug-on", "risk", "medium", "Debug mode enabled", /\bdebug\s*=\s*True\b/g, ["py"]),
  R("empty-catch", "bug", "medium", "Error swallowed (empty catch / except: pass)", /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\s*)?\}|except[^\n:]*:\s*\n\s*pass\b/g, ["js", "py"]),
  R("async-foreach", "bug", "medium", "async callback inside forEach (never awaited)", /\.forEach\(\s*async\b/g, ["js"]),
  R("json-parse", "bug", "low", "JSON.parse — check it is guarded", /JSON\.parse\(/g, ["js"]),
  R("todo", "bug", "low", "TODO / FIXME left in code", /\b(?:TODO|FIXME|HACK|XXX)\b/g, null),
]

const SEV = { high: 0, medium: 1, low: 2 }
const PER_RULE = 12

export function scanSignals(files, { kinds = ["risk", "bug"], includeTests = false, redactions = [] } = {}) {
  const found = []
  const counts = {}
  for (const f of files) {
    if (f.kind !== "code" || (!includeTests && isTestPath(f.path))) continue
    const at = lineIndex(f.content)
    const lines = f.content.split("\n")
    for (const rule of RULES) {
      if (!kinds.includes(rule.kind) || (rule.fams && !rule.fams.includes(f.family))) continue
      const seen = new Set()
      for (const m of f.content.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
        const line = at(m.index)
        if (seen.has(line)) continue
        seen.add(line)
        counts[rule.id] = (counts[rule.id] || 0) + 1
        found.push({ rule: rule.id, kind: rule.kind, sev: rule.sev, title: rule.title, file: f.path, line, snippet: (lines[line - 1] || "").trim().slice(0, 140) })
      }
    }
  }
  if (kinds.includes("risk")) {
    for (const r of redactions) {
      counts.secret = (counts.secret || 0) + 1
      found.push({ rule: "secret", kind: "risk", sev: "high", title: `Hardcoded secret (${r.kind})`, file: r.file, line: r.line, snippet: "[value redacted]" })
    }
  }
  // cap per rule, sort by severity, then assign stable ids
  const perRule = {}
  const kept = found
    .sort((a, b) => SEV[a.sev] - SEV[b.sev] || a.file.localeCompare(b.file) || a.line - b.line)
    .filter((s) => (perRule[s.rule] = (perRule[s.rule] || 0) + 1) <= PER_RULE)
  kept.forEach((s, i) => (s.id = `S${i + 1}`))
  return { signals: kept, counts }
}
