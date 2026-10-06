import { ProviderError } from "../errors.js"

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529])
const MAX_WAIT_MS = 60_000

const abortError = () => new ProviderError("Cancelled.", { kind: "aborted", exitCode: 130 })

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Map an HTTP failure to a stable `kind` the rest of the app can act on. */
export function classify(status, message = "") {
  const m = message.toLowerCase()
  if (status === 401) return "auth"
  if (status === 403) return /model/.test(m) ? "model" : "auth"
  if (status === 404) return /model/.test(m) ? "model" : "not_found"
  if (status === 413) return "context"
  if (status === 429) {
    if (/quota|billing|credit|insufficient|balance|payment/.test(m)) return "quota"
    if (/request too large|tokens per minute|\btpm\b|too many tokens|context|reduce your/.test(m)) return "context"
    return "rate"
  }
  if (status === 400 || status === 422) {
    if (/context|too long|too large|maximum.*(token|length)|reduce.*(length|prompt|messages)|exceed.*limit|token limit|input.*too/.test(m)) return "context"
    if (/max_tokens|max_completion_tokens/.test(m)) return "param"
    if (/model/.test(m) && /(not found|does not exist|unknown|invalid|not supported|decommission|deprecat)/.test(m)) return "model"
    return "bad_request"
  }
  if (status >= 500) return "server"
  return "unknown"
}

const HINTS = {
  auth: "Check your API key — run `ownit config` to set it again.",
  model: "Run `ownit models` to list the models your key can use, then pass --model <id>.",
  quota: "Your account is out of credits or quota. Check billing with your provider.",
  rate: "You are being rate limited. Wait a minute, or lower --budget to send less per request.",
  not_found: "The URL looks wrong. Check the provider's base URL (`ownit config`).",
  server: "The provider is having problems. Try again in a minute.",
  blocked: "The provider refused this request. Try a different model.",
}

export function extractMessage(data, text, res) {
  const e = data?.error
  const msg =
    (typeof e === "string" && e) ||
    e?.message ||
    data?.message ||
    data?.[0]?.error?.message ||
    (typeof text === "string" && text.trim().slice(0, 300)) ||
    res.statusText ||
    `HTTP ${res.status}`
  return String(msg).replace(/\s+/g, " ").trim()
}

function retryAfterMs(res) {
  const h = res.headers.get("retry-after")
  if (!h) return null
  const secs = Number(h)
  if (Number.isFinite(secs)) return Math.min(secs * 1000, MAX_WAIT_MS)
  const date = Date.parse(h)
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), MAX_WAIT_MS)
}

const backoff = (attempt) => Math.min(1000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 400)

/**
 * JSON request with timeout, retry/backoff, abort support and classified errors.
 * Never puts credentials in error messages.
 */
export async function requestJson(url, { method = "POST", headers = {}, body, timeoutMs = 300_000, signal, retries = 3, onRetry } = {}) {
  const host = new URL(url).host
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError()
    const ctrl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, timeoutMs)
    const onAbort = () => ctrl.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }

    let res, text
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      text = await res.text()
      cleanup()
    } catch (err) {
      cleanup()
      if (signal?.aborted) throw abortError()
      const kind = timedOut ? "timeout" : "network"
      if (attempt < retries) {
        onRetry?.({ attempt: attempt + 1, reason: kind })
        await sleep(backoff(attempt), signal)
        continue
      }
      throw new ProviderError(
        timedOut ? `No response from ${host} after ${Math.round(timeoutMs / 1000)}s.` : `Could not reach ${host} (${err.cause?.code || err.message}).`,
        {
          kind,
          hint: timedOut
            ? "Raise --timeout (seconds), or use a faster model."
            : "Check your internet connection and the provider's base URL.",
        },
      )
    }

    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* non-JSON body */
    }

    if (res.ok) {
      if (data === null) throw new ProviderError(`${host} returned a non-JSON response.`, { kind: "unknown", hint: "Check the base URL — it should point at the API root." })
      return data
    }

    const message = extractMessage(data, text, res)
    const kind = classify(res.status, message)
    const retryable = RETRYABLE_STATUS.has(res.status) && kind !== "quota" && kind !== "context"
    if (retryable && attempt < retries) {
      onRetry?.({ attempt: attempt + 1, reason: `HTTP ${res.status}` })
      await sleep(retryAfterMs(res) ?? backoff(attempt), signal)
      continue
    }
    throw new ProviderError(`${host}: ${message}`, { kind, status: res.status, hint: HINTS[kind] })
  }
}
