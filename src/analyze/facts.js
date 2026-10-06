import path from "node:path"
import { builtinModules } from "node:module"

/**
 * Static analysis. Everything here is computed by code (regex + graph walking), not by an AI,
 * so it is exact where it claims to be and honest about what it can't see.
 */

const posix = path.posix
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]))
const JS_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".json"]
const PY_ALIASES = { pil: "pillow", yaml: "pyyaml", cv2: "opencv-python", sklearn: "scikit-learn", bs4: "beautifulsoup4", dotenv: "python-dotenv", jwt: "pyjwt", dateutil: "python-dateutil", attr: "attrs", serial: "pyserial", psycopg2: "psycopg2-binary", mysqldb: "mysqlclient" }

export function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (idx) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

export const isTestPath = (p) =>
  /(^|\/)(__tests__|tests?|spec|e2e|cypress)\//i.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(p)

/* ───────────────────────────── manifests / dependencies ───────────────────────────── */

const normPy = (n) => n.toLowerCase().replace(/[-_.]+/g, "-")

function parseManifest(file) {
  const base = posix.basename(file.path)
  const c = file.content
  const m = { path: file.path, type: null, name: null, version: null, description: null, deps: [], scripts: {}, bin: {}, main: null, engines: null, license: null, moduleName: null }
  try {
    if (base === "package.json") {
      const j = JSON.parse(c)
      m.type = "npm"
      m.name = j.name ?? null
      m.version = j.version ?? null
      m.description = j.description ?? null
      m.license = typeof j.license === "string" ? j.license : null
      m.scripts = j.scripts && typeof j.scripts === "object" ? j.scripts : {}
      m.bin = typeof j.bin === "string" ? { [j.name || "bin"]: j.bin } : j.bin || {}
      m.main = j.main || (typeof j.module === "string" ? j.module : null)
      m.engines = j.engines || null
      m.moduleType = j.type || "commonjs"
      for (const [field, kind] of [["dependencies", "prod"], ["devDependencies", "dev"], ["peerDependencies", "peer"], ["optionalDependencies", "optional"]]) {
        for (const [name, version] of Object.entries(j[field] || {})) m.deps.push({ name, version: String(version), kind })
      }
    } else if (base === "composer.json") {
      const j = JSON.parse(c)
      m.type = "composer"
      m.name = j.name ?? null
      for (const [field, kind] of [["require", "prod"], ["require-dev", "dev"]]) {
        for (const [name, version] of Object.entries(j[field] || {})) if (name !== "php") m.deps.push({ name, version: String(version), kind })
      }
    } else if (/^requirements.*\.txt$/i.test(base)) {
      m.type = "pip"
      for (const raw of c.split("\n")) {
        const line = raw.split("#")[0].trim()
        if (!line || line.startsWith("-") || /^(git\+|https?:)/.test(line)) continue
        const mm = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*([<>=!~].*)?$/)
        if (mm) m.deps.push({ name: normPy(mm[1]), version: (mm[2] || "*").trim(), kind: /dev|test/i.test(base) ? "dev" : "prod" })
      }
    } else if (base === "pyproject.toml") {
      m.type = "pyproject"
      m.name = (c.match(/^name\s*=\s*["']([^"']+)["']/m) || [])[1] ?? null
      m.version = (c.match(/^version\s*=\s*["']([^"']+)["']/m) || [])[1] ?? null
      const arr = c.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)
      if (arr) for (const s of arr[1].matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*([<>=!~][^"']*)?["']/g)) m.deps.push({ name: normPy(s[1]), version: (s[2] || "*").trim(), kind: "prod" })
      const poetry = c.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)
      if (poetry) for (const s of poetry[1].matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*(?:["']([^"']+)["']|\{[^}]*version\s*=\s*["']([^"']+)["'])/gm)) if (s[1] !== "python") m.deps.push({ name: normPy(s[1]), version: s[2] || s[3] || "*", kind: "prod" })
    } else if (base === "go.mod") {
      m.type = "go"
      m.moduleName = (c.match(/^module\s+(\S+)/m) || [])[1] ?? null
      m.name = m.moduleName
      const block = [...c.matchAll(/^require\s*\(([\s\S]*?)\)/gm)].map((x) => x[1]).join("\n")
      for (const s of (block + "\n" + [...c.matchAll(/^require\s+(\S+\s+v\S+)/gm)].map((x) => x[1]).join("\n")).matchAll(/^\s*(\S+)\s+(v\S+)(\s*\/\/\s*indirect)?/gm)) {
        m.deps.push({ name: s[1], version: s[2], kind: s[3] ? "indirect" : "prod" })
      }
    } else if (base === "Cargo.toml") {
      m.type = "cargo"
      m.name = (c.match(/^name\s*=\s*["']([^"']+)["']/m) || [])[1] ?? null
      m.version = (c.match(/^version\s*=\s*["']([^"']+)["']/m) || [])[1] ?? null
      for (const [section, kind] of [["dependencies", "prod"], ["dev-dependencies", "dev"], ["build-dependencies", "dev"]]) {
        const sec = c.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?:\\n\\[|$)`))
        if (sec) for (const s of sec[1].matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:["']([^"']+)["']|\{[^}]*version\s*=\s*["']([^"']+)["'])?/gm)) m.deps.push({ name: s[1], version: s[2] || s[3] || "*", kind })
      }
    } else if (base === "Gemfile") {
      m.type = "gem"
      for (const s of c.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) m.deps.push({ name: s[1], version: s[2] || "*", kind: "prod" })
    } else {
      return null
    }
  } catch {
    return null
  }
  return m
}

const MANIFEST_RE = /^(package\.json|composer\.json|requirements.*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$/i

/* ───────────────────────────── imports ───────────────────────────── */

function resolveJs(from, spec, paths) {
  const bases = []
  if (spec.startsWith(".")) bases.push(posix.join(posix.dirname(from), spec))
  else if (spec.startsWith("@/") || spec.startsWith("~/")) bases.push(posix.join("src", spec.slice(2)), spec.slice(2))
  else return null
  for (const b of bases) {
    const cands = [b, ...JS_EXTS.map((e) => b + e), ...JS_EXTS.map((e) => posix.join(b, "index" + e))]
    const swap = b.replace(/\.(m|c)?jsx?$/, (_, mc) => (mc ? `.${mc}ts` : ".ts"))
    if (swap !== b) cands.push(swap, swap + "x")
    for (const cand of cands) if (paths.has(cand)) return cand
  }
  return null
}

const pkgOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0])

function extractJsImports(file, paths) {
  const { content, path: from } = file
  const at = lineIndex(content)
  const out = []
  const push = (spec, idx, names = []) => {
    const base = { spec, line: at(idx), names }
    if (spec.startsWith("node:") || NODE_BUILTINS.has(spec)) return out.push({ ...base, kind: "builtin", pkg: spec.replace(/^node:/, "") })
    if (/^(\.|@\/|~\/)/.test(spec)) {
      const target = resolveJs(from, spec, paths)
      return out.push(target ? { ...base, kind: "local", target } : { ...base, kind: "unresolved" })
    }
    if (/^(https?:|data:|virtual:|#)/.test(spec)) return
    out.push({ ...base, kind: "external", pkg: pkgOf(spec) })
  }
  const namesOf = (clause) => {
    const names = []
    const braces = clause.match(/\{([^}]*)\}/)
    if (braces) for (const part of braces[1].split(",")) { const n = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""); if (n) names.push(n) }
    const def = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+\w+/, "*").split(",")[0].trim()
    if (def && def !== "*" && /^[\w$]+$/.test(def)) names.push("default")
    if (/\*\s+as\s+\w+/.test(clause)) names.push("*")
    return names
  }
  for (const m of content.matchAll(/^[ \t]*import\s+(?:type\s+)?([^'";]+?)\s+from\s*['"]([^'"]+)['"]/gm)) push(m[2], m.index, namesOf(m[1]))
  for (const m of content.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) push(m[1], m.index)
  for (const m of content.matchAll(/^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/gm)) push(m[2], m.index, m[1] ? namesOf(`{${m[1]}}`) : ["*"])
  for (const m of content.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index)
  for (const m of content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index)
  return out
}

function extractPyImports(file, paths) {
  const out = []
  const lines = file.content.split("\n")
  const dir = posix.dirname(file.path)
  const tryMod = (base) => [base + ".py", posix.join(base, "__init__.py")].find((c) => paths.has(c)) || null
  lines.forEach((line, i) => {
    let m = line.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+?)\s*(?:#.*)?$/)
    if (m) {
      const [, dots, mod, rest] = m
      const names = rest.replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter((s) => s && s !== "*")
      if (dots) {
        let d = dir
        for (let k = 1; k < dots.length; k++) d = posix.dirname(d)
        const modPath = mod ? posix.join(d, ...mod.split(".")) : d
        const target = mod ? tryMod(modPath) : null
        if (target) return out.push({ spec: dots + mod, line: i + 1, names, kind: "local", target })
        // `from . import x` → x may be a module
        const hits = names.map((n) => tryMod(posix.join(modPath, n))).filter(Boolean)
        if (hits.length) return hits.forEach((t) => out.push({ spec: dots + mod, line: i + 1, names, kind: "local", target: t }))
        return out.push({ spec: dots + mod, line: i + 1, names, kind: "unresolved" })
      }
      const parts = mod.split(".")
      const target = [tryMod(posix.join(...parts)), tryMod(posix.join("src", ...parts)), tryMod(posix.join(dir, ...parts))].find(Boolean)
      if (target) return out.push({ spec: mod, line: i + 1, names, kind: "local", target })
      return out.push({ spec: mod, line: i + 1, names, kind: "external", pkg: parts[0] })
    }
    m = line.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/)
    if (m) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0]
        const parts = mod.split(".")
        const target = [tryMod(posix.join(...parts)), tryMod(posix.join("src", ...parts))].find(Boolean)
        out.push(target ? { spec: mod, line: i + 1, names: [], kind: "local", target } : { spec: mod, line: i + 1, names: [], kind: "external", pkg: parts[0] })
      }
    }
  })
  return out
}

function extractGoImports(file, paths, goModule) {
  const out = []
  const at = lineIndex(file.content)
  const specs = []
  for (const b of file.content.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const s of b[1].matchAll(/"([^"]+)"/g)) specs.push([s[1], b.index + b[0].indexOf(s[0])])
  for (const s of file.content.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) specs.push([s[1], s.index])
  for (const [spec, idx] of specs) {
    const line = at(idx)
    if (goModule && (spec === goModule || spec.startsWith(goModule + "/"))) {
      const dir = spec === goModule ? "." : spec.slice(goModule.length + 1)
      const targets = [...paths].filter((p) => posix.dirname(p) === dir && p.endsWith(".go") && !p.endsWith("_test.go"))
      if (targets.length) for (const t of targets) out.push({ spec, line, names: [], kind: "local", target: t })
      else out.push({ spec, line, names: [], kind: "unresolved" })
    } else if (!spec.split("/")[0].includes(".")) out.push({ spec, line, names: [], kind: "builtin", pkg: spec })
    else out.push({ spec, line, names: [], kind: "external", pkg: spec })
  }
  return out
}

/* ───────────────────────────── symbols ───────────────────────────── */

const J = (re, fn) => [re, fn]
const JS_SYMBOLS = [
  J(/^(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/, (m) => ({ name: m[2], kind: "function", exported: !!m[1] })),
  J(/^(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, (m) => ({ name: m[2], kind: "class", exported: !!m[1] })),
  J(/^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, (m) => ({ name: m[2], kind: "function", exported: !!m[1] })),
  J(/^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/, (m) => ({ name: m[2], kind: "function", exported: !!m[1] })),
  J(/^(export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\s*=/, (m) => ({ name: m[2], kind: "const", exported: !!m[1] })),
  J(/^export\s+(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/, (m) => ({ name: m[2], kind: m[1], exported: true })),
  J(/^exports\.([A-Za-z_$][\w$]*)\s*=/, (m) => ({ name: m[1], kind: "export", exported: true })),
  J(/^module\.exports\s*=/, () => ({ name: "module.exports", kind: "export", exported: true })),
  J(/^export\s+default\s+(?!(?:async\s+)?function\b|class\b)/, () => ({ name: "default", kind: "export", exported: true })),
]
const PY_SYMBOLS = [
  J(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, (m) => ({ name: m[1], kind: "function", exported: !m[1].startsWith("_") })),
  J(/^class\s+([A-Za-z_]\w*)/, (m) => ({ name: m[1], kind: "class", exported: !m[1].startsWith("_") })),
  J(/^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/, (m) => ({ name: m[1], kind: "const", exported: true })),
]
const GO_SYMBOLS = [
  J(/^func\s+\(\s*\w*\s*\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*([A-Za-z_]\w*)\s*[(\[]/, (m) => ({ name: `${m[1]}.${m[2]}`, kind: "method", exported: /^[A-Z]/.test(m[2]) })),
  J(/^func\s+([A-Za-z_]\w*)\s*[(\[]/, (m) => ({ name: m[1], kind: "function", exported: /^[A-Z]/.test(m[1]) })),
  J(/^type\s+([A-Za-z_]\w*)\s+(struct|interface)/, (m) => ({ name: m[1], kind: m[2], exported: /^[A-Z]/.test(m[1]) })),
]
const RUST_SYMBOLS = [
  J(/^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, (m) => ({ name: m[2], kind: "function", exported: !!m[1] })),
  J(/^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_]\w*)/, (m) => ({ name: m[3], kind: m[2], exported: !!m[1] })),
]
const TYPE_SYMBOLS = [J(/^\s*(?:(?:public|private|protected|internal|abstract|final|static|sealed|data|open|partial)\s+)*(class|interface|enum|record|object|trait|struct)\s+([A-Za-z_]\w*)/, (m) => ({ name: m[2], kind: m[1], exported: !/\bprivate\b/.test(m[0]) }))]
const RB_SYMBOLS = [
  J(/^\s*(class|module)\s+([A-Z][\w:]*)/, (m) => ({ name: m[2], kind: m[1], exported: true })),
  J(/^\s*def\s+(self\.)?([A-Za-z_]\w*[?!=]?)/, (m) => ({ name: m[2], kind: "function", exported: true })),
]
const PHP_SYMBOLS = [
  J(/^\s*(?:abstract\s+|final\s+)?(class|interface|trait)\s+([A-Za-z_]\w*)/, (m) => ({ name: m[2], kind: m[1], exported: true })),
  J(/^\s*(?:(?:public|static|protected|private)\s+)*function\s+([A-Za-z_]\w*)/, (m) => ({ name: m[1], kind: "function", exported: !/private|protected/.test(m[0]) })),
]
const SH_SYMBOLS = [J(/^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, (m) => ({ name: m[1], kind: "function", exported: true }))]

const SYMBOL_RULES = { js: JS_SYMBOLS, py: PY_SYMBOLS, go: GO_SYMBOLS, rust: RUST_SYMBOLS, jvm: TYPE_SYMBOLS, dotnet: TYPE_SYMBOLS, rb: RB_SYMBOLS, php: PHP_SYMBOLS, sh: SH_SYMBOLS }

export function extractSymbols(file) {
  const rules = SYMBOL_RULES[file.family]
  if (!rules) return []
  const lines = file.content.split("\n")
  const out = []
  const named = new Set()
  for (let i = 0; i < lines.length && out.length < 300; i++) {
    const line = lines[i]
    for (const [re, fn] of rules) {
      const m = line.match(re)
      if (m) {
        out.push({ ...fn(m), line: i + 1 })
        break
      }
    }
    if (file.family === "js") {
      const ex = line.match(/^export\s*\{([^}]*)\}\s*;?\s*$/)
      if (ex) for (const part of ex[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) named.add(n) }
    }
  }
  for (const n of named) {
    const s = out.find((x) => x.name === n)
    if (s) s.exported = true
    else out.push({ name: n, kind: "export", line: 1, exported: true })
  }
  out.forEach((s, i) => { s.endLine = (out[i + 1]?.line ?? lines.length + 1) - 1 })
  return out
}

/* ───────────────────────────── env vars ───────────────────────────── */

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_LINE_RULES = [
  [/process\.env\.([A-Za-z_]\w*)(\s*(?:\|\||\?\?))?/g, 2],
  [/process\.env\[\s*['"`]([A-Za-z0-9_]+)['"`]\s*\](\s*(?:\|\||\?\?))?/g, 2],
  [/import\.meta\.env\.([A-Za-z_]\w*)(\s*(?:\|\||\?\?))?/g, 2],
  [/Deno\.env\.get\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)(\s*(?:\|\||\?\?))?/g, 2],
  [/Bun\.env\.([A-Za-z_]\w*)(\s*(?:\|\||\?\?))?/g, 2],
  [/os\.environ\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g, 0],
  [/os\.environ\.get\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?/g, 2],
  [/os\.getenv\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?/g, 2],
  [/os\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z0-9_]+)"/g, 0],
  [/\bENV\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g, 0],
  [/\bENV\.fetch\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?/g, 2],
  [/\bgetenv\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?/g, 2],
  [/\$_ENV\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g, 0],
  [/env::var\(\s*"([A-Za-z0-9_]+)"/g, 0],
  [/System\.getenv\(\s*"([A-Za-z0-9_]+)"/g, 0],
  [/Environment\.GetEnvironmentVariable\(\s*"([A-Za-z0-9_]+)"/g, 0],
]

export function scanEnvLine(line) {
  const out = []
  for (const [re, defGroup] of ENV_LINE_RULES) {
    re.lastIndex = 0
    for (const m of line.matchAll(re)) if (ENV_NAME.test(m[1])) out.push({ name: m[1], hasDefault: defGroup ? Boolean(m[defGroup]) : false })
  }
  return out
}

function scanEnv(file, add) {
  const lines = file.content.split("\n")
  lines.forEach((line, i) => {
    for (const e of scanEnvLine(line)) add(e.name, { file: file.path, line: i + 1, hasDefault: e.hasDefault })
  })
  if (file.family === "js") {
    const at = lineIndex(file.content)
    for (const m of file.content.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g)) {
      for (const part of m[1].split(",")) {
        const [lhs, def] = part.split("=")
        const name = lhs.split(":")[0].trim().replace(/^\.\.\./, "")
        if (ENV_NAME.test(name)) add(name, { file: file.path, line: at(m.index), hasDefault: def !== undefined })
      }
    }
  }
}

/* ───────────────────────────── routes ───────────────────────────── */

function scanRoutes(file) {
  const out = []
  const lines = file.content.split("\n")
  const p = file.path
  if (file.family === "js") {
    const next = p.match(/(?:^|\/)app\/(.*)\/route\.[jt]sx?$/)
    if (next) {
      const route = "/" + next[1].split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")
      const methods = [...file.content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1])
      for (const method of methods.length ? methods : ["ANY"]) out.push({ method, path: route, file: p, line: 1 })
    }
    const pages = p.match(/(?:^|\/)pages\/api\/(.*)\.[jt]sx?$/)
    if (pages) out.push({ method: "ANY", path: "/api/" + pages[1].replace(/\/index$/, ""), file: p, line: 1 })
  }
  lines.forEach((line, i) => {
    let m
    if (file.family === "js" && (m = line.match(/\b(?:app|router|server|api|fastify|route|routes|r|hono)\.(get|post|put|patch|delete|all|options|head)\(\s*['"`]([^'"`]+)['"`]/i))) out.push({ method: m[1].toUpperCase(), path: m[2], file: p, line: i + 1 })
    else if (file.family === "py" && (m = line.match(/^\s*@\w+\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/))) out.push({ method: m[1] === "route" ? "ANY" : m[1].toUpperCase(), path: m[2], file: p, line: i + 1 })
    else if (file.family === "go" && (m = line.match(/\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/))) out.push({ method: /^[A-Z]+$/.test(m[1]) ? m[1] : "ANY", path: m[2], file: p, line: i + 1 })
    else if (file.family === "rb" && (m = line.match(/^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/))) out.push({ method: m[1].toUpperCase(), path: m[2], file: p, line: i + 1 })
  })
  return out
}

/* ───────────────────────────── main ───────────────────────────── */

export function analyzeProject(project) {
  const files = project.files
  const byPath = new Map(files.map((f) => [f.path, f]))
  const paths = new Set(byPath.keys())

  // 1. manifests (also needed for Go module resolution)
  const manifests = files.filter((f) => MANIFEST_RE.test(posix.basename(f.path))).map(parseManifest).filter(Boolean)
  const goModule = manifests.find((m) => m.type === "go")?.moduleName || null

  // 2. per-file symbols + imports
  const symbols = new Map()
  const imports = new Map()
  const importedBy = new Map()
  const unresolved = []
  for (const f of files) {
    if (f.kind !== "code") continue
    symbols.set(f.path, extractSymbols(f))
    let imps = []
    if (f.family === "js") imps = extractJsImports(f, paths)
    else if (f.family === "py") imps = extractPyImports(f, paths)
    else if (f.family === "go") imps = extractGoImports(f, paths, goModule)
    imports.set(f.path, imps)
    for (const i of imps) {
      if (i.kind === "local") {
        if (!importedBy.has(i.target)) importedBy.set(i.target, new Set())
        importedBy.get(i.target).add(f.path)
      } else if (i.kind === "unresolved") unresolved.push({ file: f.path, ...i })
    }
  }

  // 3. dependency usage
  const usage = new Map() // external pkg key → Set(files)
  for (const [file, imps] of imports) {
    for (const i of imps) if (i.kind === "external") {
      const key = byPath.get(file).family === "py" ? PY_ALIASES[i.pkg.toLowerCase()] || normPy(i.pkg) : i.pkg
      if (!usage.has(key)) usage.set(key, new Set())
      usage.get(key).add(file)
    }
  }
  const scriptText = manifests.flatMap((m) => Object.values(m.scripts)).join("\n")
  const deps = []
  const seen = new Set()
  for (const m of manifests) for (const d of m.deps) {
    const key = `${m.type}:${d.name}`
    if (seen.has(key)) continue
    seen.add(key)
    let usedBy = usage.get(d.name) ? [...usage.get(d.name)] : []
    if (m.type === "go") usedBy = [...usage.entries()].filter(([k]) => k === d.name || k.startsWith(d.name + "/")).flatMap(([, v]) => [...v])
    const bare = d.name.replace(/^@[^/]+\//, "")
    const inScripts = m.type === "npm" && (scriptText.includes(d.name) || new RegExp(`(^|[\\s;&|])${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "m").test(scriptText))
    deps.push({ ...d, ecosystem: m.type, manifest: m.path, usedBy: [...new Set(usedBy)].sort(), inScripts })
  }
  const declaredNpm = new Set(deps.filter((d) => d.ecosystem === "npm").map((d) => d.name))
  const selfNames = new Set(manifests.map((m) => m.name).filter(Boolean))
  const undeclared = []
  if (declaredNpm.size || manifests.some((m) => m.type === "npm")) {
    for (const [pkg, fs] of usage) {
      const jsFiles = [...fs].filter((p) => byPath.get(p).family === "js")
      if (jsFiles.length && !declaredNpm.has(pkg) && !selfNames.has(pkg) && !pkg.startsWith("@types/")) undeclared.push({ name: pkg, files: jsFiles.sort() })
    }
  }
  const unusedDeps = deps.filter((d) => ["npm", "pip", "cargo", "gem", "composer"].includes(d.ecosystem) && d.kind !== "peer" && !d.usedBy.length && !d.inScripts && !d.name.startsWith("@types/"))

  // 4. env vars
  const envVars = new Map()
  const addEnv = (name, use) => {
    if (!envVars.has(name)) envVars.set(name, { name, uses: [] })
    const e = envVars.get(name)
    if (!e.uses.some((u) => u.file === use.file && u.line === use.line)) e.uses.push(use)
  }
  for (const f of files) if (f.kind === "code" && !isTestPath(f.path)) scanEnv(f, addEnv)

  // 5. routes
  const routes = files.filter((f) => f.kind === "code" && !isTestPath(f.path)).flatMap(scanRoutes)

  // 6. tests
  const testFiles = files.filter((f) => isTestPath(f.path) && f.kind === "code").map((f) => f.path)
  const testSet = new Set(testFiles)
  const depNames = new Set(deps.map((d) => d.name))
  const frameworks = []
  for (const n of ["jest", "vitest", "mocha", "ava", "tap", "playwright", "@playwright/test", "cypress", "pytest", "rspec", "phpunit"]) if (depNames.has(n)) frameworks.push(n)
  if ([...imports.values()].some((l) => l.some((i) => i.spec === "node:test" || i.spec === "node:assert"))) frameworks.push("node:test")
  if (files.some((f) => f.family === "go" && f.path.endsWith("_test.go"))) frameworks.push("go test")
  if (files.some((f) => f.family === "py" && /^\s*import unittest|^\s*import pytest/m.test(f.content))) frameworks.push(frameworks.includes("pytest") ? "unittest" : "pytest/unittest")
  const untested = files
    .filter((f) => f.kind === "code" && !testSet.has(f.path) && (symbols.get(f.path) || []).some((s) => s.exported) && !/(^|\/)(bin|scripts?|config|migrations?)\//.test(f.path) && !/\.(config|d)\.[jt]s$/.test(f.path))
    .filter((f) => ![...(importedBy.get(f.path) || [])].some((p) => testSet.has(p)))
    .map((f) => f.path)

  // 7. entry points
  const entries = findEntries({ files, byPath, manifests })

  // 8. languages
  const langMap = new Map()
  for (const f of files) {
    if (f.kind === "doc") continue
    const l = langMap.get(f.lang) || { lang: f.lang, files: 0, lines: 0 }
    l.files++
    l.lines += f.lines
    langMap.set(f.lang, l)
  }
  const langs = [...langMap.values()].sort((a, b) => b.lines - a.lines)
  const graphFamilies = ["js", "py", "go"]
  const hasGraph = files.some((f) => graphFamilies.includes(f.family))
  const unsupported = [...new Set(files.filter((f) => f.kind === "code" && !graphFamilies.includes(f.family)).map((f) => f.lang))]

  return { manifests, deps, undeclared, unusedDeps, symbols, imports, importedBy, unresolved, envVars, routes, testFiles, frameworks, untested, entries, langs, hasGraph, unsupported, byPath }
}

function findEntries({ files, byPath, manifests }) {
  const out = new Map()
  const add = (p, reason) => {
    const f = posix.normalize(String(p).replace(/^\.\//, ""))
    if (byPath.has(f)) out.set(f, [...(out.get(f) || []), reason])
  }
  for (const m of manifests) {
    if (m.type !== "npm") continue
    const dir = posix.dirname(m.path)
    const rel = (p) => (dir === "." ? p : posix.join(dir, p))
    for (const [k, v] of Object.entries(m.bin)) add(rel(v), `package.json bin "${k}"`)
    if (m.main) add(rel(m.main), "package.json main")
    for (const [k, v] of Object.entries(m.scripts)) {
      const mm = String(v).match(/\b(?:node|tsx|ts-node|nodemon|bun(?: run)?|deno run)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./-]+\.(?:m?js|cjs|m?ts))/)
      if (mm) add(rel(mm[1]), `package.json script "${k}"`)
    }
  }
  for (const f of files) {
    if (f.kind !== "code") continue
    const first = f.content.slice(0, 120)
    if (first.startsWith("#!") && !f.path.includes("node_modules")) add(f.path, "has a #! shebang (runnable script)")
    if (f.family === "py" && /^if\s+__name__\s*==\s*["']__main__["']/m.test(f.content)) add(f.path, 'has `if __name__ == "__main__"`')
    if (f.family === "py" && /(^|\/)(manage|wsgi|asgi|__main__)\.py$/.test(f.path)) add(f.path, "conventional Python entry")
    if (f.family === "go" && /^package main\b/m.test(f.content) && /^func main\(\)/m.test(f.content)) add(f.path, "Go `func main()`")
    if (f.family === "rust" && /^\s*fn main\(\)/m.test(f.content)) add(f.path, "Rust `fn main()`")
  }
  if (!out.size) {
    for (const f of files) if (f.kind === "code" && /^(?:src\/)?(?:index|main|app|server|cli)\.[a-z]+$/.test(f.path)) add(f.path, "conventional entry file name")
  }
  return [...out].map(([p, reasons]) => ({ path: p, reasons: [...new Set(reasons)] }))
}

/* ───────────────────────────── graph helpers (used by commands) ───────────────────────────── */

export function importedByList(facts, p) {
  return [...(facts.importedBy.get(p) || [])].sort()
}

export function localImportsOf(facts, p) {
  return [...new Set((facts.imports.get(p) || []).filter((i) => i.kind === "local").map((i) => i.target))].sort()
}

/** BFS over local imports from `start`. Returns [{path, depth, parent}] in visit order. */
export function reachable(facts, start, maxDepth = 8) {
  const seen = new Map([[start, { path: start, depth: 0, parent: null }]])
  const q = [start]
  while (q.length) {
    const cur = q.shift()
    const d = seen.get(cur).depth
    if (d >= maxDepth) continue
    for (const t of localImportsOf(facts, cur)) {
      if (!seen.has(t)) {
        seen.set(t, { path: t, depth: d + 1, parent: cur })
        q.push(t)
      }
    }
  }
  return [...seen.values()]
}

/** Shortest import path a → … → b (following imports), or null. */
export function importPath(facts, a, b, maxDepth = 6) {
  const hit = reachable(facts, a, maxDepth).find((n) => n.path === b)
  if (!hit) return null
  const chain = []
  const map = new Map(reachable(facts, a, maxDepth).map((n) => [n.path, n]))
  for (let n = hit; n; n = n.parent ? map.get(n.parent) : null) chain.unshift(n.path)
  return chain
}

/** Files in the project that depend (transitively) on `p`. */
export function transitiveDependents(facts, p, limit = 60) {
  const seen = new Set([p])
  const q = [p]
  while (q.length && seen.size <= limit) {
    const cur = q.shift()
    for (const d of facts.importedBy.get(cur) || []) if (!seen.has(d)) { seen.add(d); q.push(d) }
  }
  seen.delete(p)
  return [...seen].sort()
}

/** A one-line, deterministic description of a file's shape (used when a file is too big to include). */
export function skeleton(facts, file) {
  const syms = facts.symbols.get(file.path) || []
  const imps = facts.imports.get(file.path) || []
  const local = [...new Set(imps.filter((i) => i.kind === "local").map((i) => i.target))]
  const ext = [...new Set(imps.filter((i) => i.kind === "external").map((i) => i.pkg))]
  const parts = [`${file.path} (${file.lines} lines)`]
  if (local.length) parts.push(`imports: ${local.slice(0, 8).join(", ")}${local.length > 8 ? ` +${local.length - 8}` : ""}`)
  if (ext.length) parts.push(`packages: ${ext.slice(0, 8).join(", ")}${ext.length > 8 ? ` +${ext.length - 8}` : ""}`)
  if (syms.length) parts.push(`declares: ${syms.slice(0, 25).map((s) => `${s.kind === "function" || s.kind === "method" ? "" : s.kind + " "}${s.name}${s.exported ? "*" : ""}:${s.line}`).join(", ")}${syms.length > 25 ? ` +${syms.length - 25}` : ""}`)
  return parts.join(" | ")
}
