import { execFileSync } from "node:child_process"
import { GitError } from "./errors.js"

export function git(cwd, args, { allowFail = false, maxBuffer = 256 * 1024 * 1024 } = {}) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  } catch (err) {
    if (allowFail) return null
    if (err.code === "ENOBUFS") throw new GitError("The git diff is too large to read.", { hint: "Use --staged, or --base with a closer branch." })
    throw new GitError(String(err.stderr || err.message).trim().split("\n")[0] || "git failed")
  }
}

export function gitInfo(cwd) {
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"], { allowFail: true })?.trim() !== "true") return null
  const commit = git(cwd, ["rev-parse", "--short", "HEAD"], { allowFail: true })?.trim() || null
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true })?.trim() || null
  const dirty = Boolean(git(cwd, ["status", "--porcelain"], { allowFail: true })?.trim())
  return { commit, branch, dirty }
}

export const isTracked = (cwd, file) => git(cwd, ["ls-files", "--error-unmatch", "--", file], { allowFail: true }) !== null
export const isGitIgnored = (cwd, file) => git(cwd, ["check-ignore", "-q", "--", file], { allowFail: true }) !== null
