import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { scanSignals } from "../analyze/signals.js"
import { renderTree, mdTable, fmt } from "../render.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "full",
  description: "Full codebase audit: architecture, dependencies, env, tests, risks — one report.",
  usage: "ownit full [--model <id>] [--fresh] [--no-ai] [--dry-run]",
}

export async function prepare({ project, facts, git, provider, opts }) {
  const ctx = projectContext(project, facts)
  const { signals } = scanSignals(project.files, { redactions: project.redactions })
  const allFiles = project.files.filter((f) => f.kind === "code" || f.kind === "config")
  const budget = provider?.contextTokens ?? 60_000

  const sigMd = signals.length
    ? "### 🧮 Static Signals\n" + mdTable(["ID", "Severity", "Rule", "File", "Line", "Snippet"], signals.slice(0, 40).map((s) => [s.id, s.sev, s.title, s.file, String(s.line), s.snippet.slice(0, 80)]))
    : "### 🧮 Static Signals\n_None found._"

  const factsMd = [
    "## 🧮 Computed Facts\n",
    `- **Files:** ${fmt(project.files.length)} source · ${fmt(project.totalLines)} lines`,
    `- **Languages:** ${facts.langs.slice(0, 6).map((l) => `${l.lang} (${l.files})`).join(", ")}`,
    `- **Entry points:** ${facts.entries.map((e) => `\`${e.path}\``).join(", ") || "_none_"}`,
    `- **Routes:** ${facts.routes.length ? facts.routes.slice(0, 12).map((r) => `\`${r.method} ${r.path}\``).join(", ") + (facts.routes.length > 12 ? ` +${facts.routes.length - 12}` : "") : "_none detected_"}`,
    `- **Env vars:** ${facts.envVars.size ? [...facts.envVars.keys()].join(", ") : "_none_"}`,
    `- **Tests:** ${facts.testFiles.length} files${facts.frameworks.length ? ` (${facts.frameworks.join(", ")})` : ""}; ${facts.untested.length} untested modules`,
    `- **Unused deps:** ${facts.unusedDeps.slice(0, 8).map((d) => d.name).join(", ") || "_none_"}`,
    `- **Signals:** ${signals.filter((s) => s.sev === "high").length} high / ${signals.filter((s) => s.sev === "medium").length} medium / ${signals.filter((s) => s.sev === "low").length} low`,
    "",
    "### 🧮 File Tree\n```\n" + renderTree(project.files.map((f) => f.path)) + "\n```",
    "",
    sigMd,
  ].join("\n")

  return {
    title: "Full Audit",
    subtitle: "Architecture, dependencies, environment, test coverage and risk — grounded in static analysis.",
    output: ".ownit/FULL.md",
    factsMd,
    units: [
      {
        id: "full",
        label: "Full audit",
        heading: "🤖 AI Analysis",
        files: allFiles,
        skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
        context: ctx,
        system: makeSystem("You are a senior software engineer performing a thorough codebase audit."),
        task: `Write a full technical audit of this codebase. Use the static facts above (already computed — do not repeat them). Provide concrete, code-grounded findings.

## Architecture
Describe the high-level design in 3–6 bullet points. Name the main entry points, layers and how data flows between them. Call out any structural problems (circular deps, tight coupling, missing abstraction).

## Dependencies
Comment only on notable findings: outdated-looking versions, suspicious packages, anything flagged undeclared or unused. Skip packages with nothing interesting to say.

## Environment & Configuration
Which env vars are required to run? Which are optional? Are any consumed but never declared in a template? Note any misconfiguration risk.

## Test Coverage
What is tested, what is not, and what is the biggest coverage gap? Be specific (file names and function names from the facts).

## Risk & Quality
Triage the static signals above by real-world impact. For each high-severity signal give: what it is, where exactly (\`file:line\`), why it matters, and the one-line fix. Group medium/low signals.

## What to do next
Three concrete, prioritised actions in one sentence each.`,
        expect: ["Architecture", "Dependencies", "Environment", "Test Coverage", "Risk", "What to do next"],
        budget,
      },
    ],
  }
}
