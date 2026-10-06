import readline from "node:readline"

const COLOR = (() => {
  if (process.env.NO_COLOR || process.argv.includes("--no-color")) return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true
  return Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb"
})()

const paint = (open, close) => (s) => (COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : String(s))
export const c = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  red: paint(31, 39),
  green: paint(32, 39),
  yellow: paint(33, 39),
  cyan: paint(36, 39),
  gray: paint(90, 39),
}

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)

export const log = (msg = "") => console.log(msg)
export const warn = (msg) => console.log(`${c.yellow("!")} ${msg}`)
export const note = (msg) => console.log(c.dim(`  ${msg}`))
export const ok = (msg) => console.log(`${c.green("✔")} ${msg}`)

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** Tiny spinner. Animates on a TTY; prints plain lines in CI / pipes. */
export function spinner(text) {
  const tty = Boolean(process.stdout.isTTY) && !process.env.CI
  let current = text
  let timer = null
  let frame = 0
  let started = Date.now()

  const render = () => {
    const secs = Math.floor((Date.now() - started) / 1000)
    const label = secs >= 3 ? `${current} ${c.dim(`${secs}s`)}` : current
    process.stdout.write(`\r\x1b[K${c.cyan(FRAMES[frame++ % FRAMES.length])} ${label}`)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    if (tty) process.stdout.write("\r\x1b[K\x1b[?25h")
  }
  const finish = (symbol, msg) => {
    stop()
    console.log(`${symbol} ${msg ?? current}`)
  }

  if (tty) {
    process.stdout.write("\x1b[?25l")
    render()
    timer = setInterval(render, 90)
  } else {
    console.log(`… ${current}`)
  }

  return {
    update(t) {
      current = t
      started = Date.now()
      if (!tty) console.log(`… ${t}`)
    },
    succeed: (m) => finish(c.green("✔"), m),
    fail: (m) => finish(c.red("✖"), m),
    warn: (m) => finish(c.yellow("!"), m),
    info: (m) => finish(c.cyan("ℹ"), m),
    stop,
  }
}

process.on("exit", () => {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h")
})

/** Ask a question. Resolves "" on EOF. `mask` hides what is typed (API keys). */
export function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    })
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      rl.close()
      resolve(v)
    }
    rl.on("close", () => finish(""))
    rl.question(question, (answer) => {
      if (mask && process.stdin.isTTY) process.stdout.write("\n")
      finish(answer)
    })
    if (mask && process.stdin.isTTY) {
      rl._writeToOutput = () => {} // swallow echo of typed characters
    }
  })
}

export async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]"
  const a = (await ask(`${question} ${c.dim(hint)} `)).trim().toLowerCase()
  if (!a) return defaultYes
  return a === "y" || a === "yes"
}
