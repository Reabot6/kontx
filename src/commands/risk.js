import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { scanSignals } from "../analyze/signals.js"
import { mdTable, fmt } from "../render.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "risk",
  description: "Security and quality risk audit.",
  usage: "kontx risk [--model <id>] [--fresh]",
}

export async function prepare({ project, facts, provider }) {
  const ctx = projectContext(project, facts)
  const { signals } = scanSignals(project.files, { redactions: project.redactions, kinds: ["risk"] })
  const codeFiles = project.files.filter((f) => f.kind === "code")

  const sigMd = signals.length
    ? "### 🧮 Static Risk Signals\n" + mdTable(["ID", "Sev", "Rule", "File", "Line", "Snippet"], signals.map((s) => [s.id, s.sev, s.title, s.file, String(s.line), s.snippet.slice(0, 80)]))
    : "### 🧮 Static Risk Signals\n_No signals fired._"

  return {
    title: "Security & Risk Audit",
    subtitle: "Potential vulnerabilities and quality risks, grounded in static analysis.",
    output: ".kontx/RISK.md",
    factsMd: sigMd,
    units: [{
      id: "risk",
      label: "Risk audit",
      files: codeFiles,
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a security-focused engineer performing a risk audit. Your findings must be code-grounded and actionable."),
      task: `Using the static signals and project facts above, write a security and risk report.

## Critical Findings
For each high-severity signal: \`file:line\` → what the risk is → real-world impact → one-line fix. If no high signals exist, write that explicitly.

## Medium & Low Findings
Group by category. For each: location, issue, fix.

## Missing Controls
Note the absence of: rate limiting, auth middleware, input validation, output encoding, dependency audit scripts, SAST in CI — but only if there is concrete evidence of absence (e.g. routes with no auth middleware import, package.json scripts with no audit step).

## Risk Summary
One-paragraph overall risk posture, referencing signal counts and severity from the facts.`,
      expect: ["Critical Findings", "Medium", "Missing Controls", "Risk Summary"],
    }],
  }
}
