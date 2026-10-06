import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { scanSignals } from "../analyze/signals.js"
import { mdTable } from "../render.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "bug",
  description: "Find likely bugs and logic errors.",
  usage: "ownit bug [--model <id>] [--fresh]",
}

export async function prepare({ project, facts }) {
  const ctx = projectContext(project, facts)
  const { signals } = scanSignals(project.files, { kinds: ["bug"] })
  const sigMd = signals.length
    ? "### 🧮 Static Bug Signals\n" + mdTable(["ID", "Sev", "Rule", "File", "Line", "Snippet"], signals.map((s) => [s.id, s.sev, s.title, s.file, String(s.line), s.snippet.slice(0, 80)]))
    : "### 🧮 Static Bug Signals\n_None._"

  return {
    title: "Bug Hunt",
    subtitle: "Likely bugs and logic errors, grounded in static analysis.",
    output: ".ownit/BUGS.md",
    factsMd: sigMd,
    units: [{
      id: "bug",
      label: "Bug hunt",
      numbered: true,
      files: project.files.filter((f) => f.kind === "code"),
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are an experienced engineer hunting for real bugs. Only report things you can verify in the code provided. Do not guess."),
      task: `Analyse the code for likely bugs and logic errors. Do not re-list the static signals; address only findings from the code itself.

## Definite Bugs
Things that will cause incorrect behaviour or crashes, with near certainty. Format: \`file:line\` — description — impact.

## Likely Bugs
Things that will probably cause problems in realistic usage.

## Fragile Code
Code that works today but will break under common conditions (missing null check, assumption that may not hold, race condition, off-by-one, etc.).

## False Positives in Static Signals
If any static signal above is a false positive, say so and explain briefly.`,
      expect: ["Definite Bugs", "Likely Bugs", "Fragile Code"],
    }],
  }
}
