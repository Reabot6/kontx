import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const CACHE_VERSION = 1
const MAX_ENTRIES = 100
const MAX_AGE_MS = 60 * 86_400_000

export function ensurekontxDir(root) {
  const dir = path.join(root, ".kontx")
  fs.mkdirSync(dir, { recursive: true })
  const gi = path.join(dir, ".gitignore")
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n") // the folder ignores itself — nothing here is ever committed by accident
  return dir
}

export function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".kontx", "state.json"), "utf8"))
  } catch {
    return { consent: {} }
  }
}
export function writeState(root, state) {
  fs.writeFileSync(path.join(ensurekontxDir(root), "state.json"), JSON.stringify(state, null, 2))
}

/**
 * Result cache keyed on a hash of the *entire prompt* (+ model + prompt version).
 * Same content in → same key → zero API calls. CRLF/BOM are normalised before hashing upstream,
 * so a file that was merely re-saved (or checked out on another OS) still hits.
 */
export class Cache {
  constructor(root) {
    this.root = root
    this.dir = path.join(root, ".kontx", "cache")
  }
  key(parts) {
    return crypto.createHash("sha256").update(JSON.stringify([CACHE_VERSION, ...parts])).digest("hex").slice(0, 32)
  }
  file(key) {
    return path.join(this.dir, `${key}.json`)
  }
  get(key) {
    const f = this.file(key)
    try {
      const e = JSON.parse(fs.readFileSync(f, "utf8"))
      if (typeof e?.text === "string" && e.text) return e
    } catch (err) {
      if (err.code !== "ENOENT") fs.rmSync(f, { force: true }) // corrupted → self-heal
    }
    return null
  }
  set(key, entry) {
    ensurekontxDir(this.root)
    fs.mkdirSync(this.dir, { recursive: true })
    const f = this.file(key)
    const tmp = `${f}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ ...entry, createdAt: Date.now() }))
    fs.renameSync(tmp, f)
    this.prune()
  }
  stats() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, "stats.json"), "utf8"))
    } catch {
      return { hits: 0, calls: 0, tokensSaved: 0, tokensUsed: 0 }
    }
  }
  record({ hit = 0, call = 0, saved = 0, used = 0 }) {
    const s = this.stats()
    s.hits += hit
    s.calls += call
    s.tokensSaved += saved
    s.tokensUsed += used
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(path.join(this.dir, "stats.json"), JSON.stringify(s))
    } catch {
      /* stats are best-effort */
    }
  }
  entries() {
    try {
      return fs.readdirSync(this.dir).filter((n) => n.endsWith(".json") && n !== "stats.json").map((n) => ({ n, st: fs.statSync(path.join(this.dir, n)) }))
    } catch {
      return []
    }
  }
  prune() {
    const all = this.entries().sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    all.forEach(({ n, st }, i) => {
      if (i >= MAX_ENTRIES || Date.now() - st.mtimeMs > MAX_AGE_MS) fs.rmSync(path.join(this.dir, n), { force: true })
    })
  }
  clear() {
    const n = this.entries().length
    fs.rmSync(this.dir, { recursive: true, force: true })
    return n
  }
}
