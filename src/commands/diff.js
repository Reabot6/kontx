import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { UsageError, GitError } from "../errors.js"

export const meta = {
  name: "diff",
  description: "Review staged changes or a branch diff.",
  usage: "ownit diff [--staged] [--base <branch>] [--model <id>]",
}

function getDiff(cwd, opts) {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (err) {
      const msg = String(err.stderr || err.message).trim().split("\n")[0]
      if (/not a git repository/i.test(msg)) throw new UsageError("This folder is not inside a git repo.", { hint: "cd into a git project, or use a different command." })
      if (err.code === "ENOBUFS") throw new GitError("The diff is too large.", { hint: "Use a narrower --base, or split your changes into smaller commits." })
      throw new GitError(msg || "git failed")
    }
  }
  if (opts.base) {
    const merge = run(["merge-base", opts.base, "HEAD"]).trim()
    const d = run(["diff", merge, "HEAD", "--", ":(exclude)package-lock.json", ":(exclude)*.lock"])
    if (!d.trim()) throw new UsageError(`No diff between ${opts.base} and HEAD.`)
    return { diff: d, label: `${opts.base}…HEAD` }
  }
  let d = run(["diff", "--staged", "--", ":(exclude)package-lock.json", ":(exclude)*.lock"])
  if (d.trim()) return { diff: d, label: "staged changes" }
  if (opts.staged) throw new UsageError("No staged changes. Stage some files with `git add` first.")
  d = run(["diff", "HEAD", "--", ":(exclude)package-lock.json", ":(exclude)*.lock"])
  if (!d.trim()) throw new UsageError("No changes to review. Nothing is staged or modified.")
  return { diff: d, label: "working tree vs HEAD" }
}

export async function prepare({ project, facts, opts }) {
  const ctx = projectContext(project, facts)
  const { diff, label } = getDiff(project.root, opts)
  const diffTok = Math.ceil(diff.length / 3.5)
  const diffMd = `### 🧮 Git Diff (${label})\n\`\`\`diff\n${diff.slice(0, 120_000)}\n\`\`\``

  return {
    title: `Code Review — ${label}`,
    subtitle: `AI review of ${label}.`,
    output: ".ownit/DIFF.md",
    factsMd: diffMd,
    units: [{
      id: "diff",
      label: "Code review",
      files: [],
      context: ctx,
      system: makeSystem("You are a thorough code reviewer. Base every comment on the diff shown. Do not invent issues you can't see."),
      task: `Review the diff shown in <project_facts>. Provide a concrete, actionable review.

## Summary
What this change does, in 2–3 sentences.

## Issues
Format: severity (critical/major/minor) — \`file:line\` — description — suggested fix. Only things visible in the diff.

## Positive Changes
Any good patterns, improvements or clean-ups worth noting (1–5 bullet points).

## Checklist
Answer yes / no / not applicable for:
- [ ] Tests added or updated for changed behaviour?
- [ ] New env vars documented in .env.example?
- [ ] Error handling present for new failure paths?
- [ ] No secrets or debug code left in?`,
      expect: ["Summary", "Issues", "Checklist"],
    }],
  }
}
