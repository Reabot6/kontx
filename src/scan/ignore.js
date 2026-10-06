/**
 * Minimal, spec-faithful .gitignore engine (last matching rule wins, `!` negation,
 * dir-only `/`, anchoring, `*`, `**`, `?`, `[...]`). Three priority tiers:
 *   0 built-in defaults  <  1 .gitignore files  <  2 .ownitignore / --exclude
 */

export const DEFAULT_IGNORES = `
.git/
node_modules/
bower_components/
jspm_packages/
vendor/
.venv/
venv/
env/
__pycache__/
*.pyc
.mypy_cache/
.pytest_cache/
.ruff_cache/
.tox/
.eggs/
*.egg-info/
site-packages/
.gradle/
.terraform/
Pods/
DerivedData/
.dart_tool/
.next/
.nuxt/
.output/
.svelte-kit/
.turbo/
.parcel-cache/
.cache/
.angular/
.idea/
.vscode/
.DS_Store
Thumbs.db
dist/
build/
out/
coverage/
.nyc_output/
tmp/
temp/
*.min.js
*.min.css
*.map
*.log
.ownit/
OWNIT*.md
`

function globToRegexSource(glob) {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const prevSlash = i === 0 || glob[i - 1] === "/"
        if (prevSlash && glob[i + 2] === "/") {
          out += "(?:.*/)?" // **/
          i += 2
        } else if (prevSlash && i + 2 >= glob.length) {
          out += ".*" // trailing /**
          i += 1
        } else {
          out += "[^/]*" // ** not on a segment boundary behaves like *
          i += 1
        }
      } else {
        out += "[^/]*"
      }
    } else if (ch === "?") {
      out += "[^/]"
    } else if (ch === "[") {
      const end = glob.indexOf("]", i + 2)
      if (end === -1) {
        out += "\\["
      } else {
        let cls = glob.slice(i + 1, end)
        if (cls[0] === "!") cls = "^" + cls.slice(1)
        out += `[${cls.replace(/\\/g, "\\\\")}]`
        i = end
      }
    } else if (ch === "\\" && i + 1 < glob.length) {
      out += glob[++i].replace(/[.+^${}()|[\]\\]/g, "\\$&")
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return out
}

function parseLine(raw) {
  let line = raw.replace(/\r$/, "")
  if (!line.trim() || line.startsWith("#")) return null
  line = line.replace(/(?<!\\)\s+$/, "")
  let negate = false
  if (line.startsWith("!")) {
    negate = true
    line = line.slice(1)
  } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
    line = line.slice(1)
  }
  let dirOnly = false
  if (line.endsWith("/")) {
    dirOnly = true
    line = line.slice(0, -1)
  }
  if (!line) return null
  const anchored = line.startsWith("/") || line.includes("/")
  if (line.startsWith("/")) line = line.slice(1)
  const src = globToRegexSource(line)
  const regex = new RegExp(anchored ? `^${src}$` : `^(?:.*/)?${src}$`)
  return { regex, negate, dirOnly }
}

export class IgnoreMatcher {
  constructor() {
    this.tiers = [[], [], []]
  }

  /** Add the lines of an ignore file that lives in directory `base` (posix, "" = root). */
  add(text, base = "", tier = 1) {
    for (const line of String(text).split("\n")) {
      const rule = parseLine(line)
      if (rule) this.tiers[tier].push({ ...rule, base })
    }
    return this
  }

  /** `relPath` is posix, relative to the scan root. */
  ignores(relPath, isDir = false) {
    let ignored = false
    for (const tier of this.tiers) {
      for (const r of tier) {
        if (r.dirOnly && !isDir) continue
        let sub = relPath
        if (r.base) {
          if (!relPath.startsWith(r.base + "/")) continue
          sub = relPath.slice(r.base.length + 1)
        }
        if (r.regex.test(sub)) ignored = !r.negate
      }
    }
    return ignored
  }
}

export function defaultMatcher() {
  return new IgnoreMatcher().add(DEFAULT_IGNORES, "", 0)
}
