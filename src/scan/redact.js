/**
 * Redact secret-looking values BEFORE anything is hashed, sent or written.
 * Replacements keep the line count identical so line numbers stay correct.
 * Returns hits with file-relative line numbers and a kind — never the value.
 */

const PLACEHOLDER = /^(?:your|xxx|<|\$\{|\$\(|process\.|env\.|os\.|example|sample|changeme|placeholder|dummy|test|todo|\*{3,}|\.{3,}|%|\{\{)/i

const TOKEN_PATTERNS = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openrouter-key", /sk-or-v1-[A-Za-z0-9]{20,}/g],
  ["openai-key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ["groq-key", /gsk_[A-Za-z0-9]{20,}/g],
  ["xai-key", /xai-[A-Za-z0-9]{20,}/g],
  ["google-key", /AIza[0-9A-Za-z_-]{35}/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["github-token", /github_pat_[A-Za-z0-9_]{30,}/g],
  ["slack-token", /xox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["stripe-key", /\b[sr]k_live_[A-Za-z0-9]{16,}/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
]

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const URL_CREDS = /([a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:)([^/\s@'"]+)(@)/gi
const QUOTED_ASSIGN = /((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)[\w-]*["']?\s*[:=]\s*["'])([^"'\s]{8,})(["'])/gi
const ENV_ASSIGN = /^(\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*)([^\s#'"]{12,})/gm

export function redact(text) {
  let out = text
  const hits = []
  const lineOf = (s, idx) => {
    let n = 1
    for (let i = 0; i < idx; i++) if (s.charCodeAt(i) === 10) n++
    return n
  }
  const apply = (kind, regex, replacer) => {
    out = out.replace(regex, (...args) => {
      const match = args[0]
      const offset = args[args.length - 2]
      const replaced = replacer(...args)
      if (replaced === match) return match // placeholder – left alone
      hits.push({ kind, line: lineOf(out, offset) })
      return replaced
    })
  }

  apply("private-key", PRIVATE_KEY, (m) => `[REDACTED PRIVATE KEY]${"\n".repeat((m.match(/\n/g) || []).length)}`)
  for (const [kind, re] of TOKEN_PATTERNS) apply(kind, new RegExp(re.source, re.flags), () => "[REDACTED]")
  apply("url-credentials", URL_CREDS, (m, pre, pw, at) => (PLACEHOLDER.test(pw) ? m : `${pre}[REDACTED]${at}`))
  apply("hardcoded-secret", QUOTED_ASSIGN, (m, pre, val, q) => (PLACEHOLDER.test(val) || val === "[REDACTED]" ? m : `${pre}[REDACTED]${q}`))
  apply("env-secret", ENV_ASSIGN, (m, pre, val) => (PLACEHOLDER.test(val) || val === "[REDACTED]" ? m : `${pre}[REDACTED]`))

  hits.sort((a, b) => a.line - b.line)
  return { text: out, hits }
}
