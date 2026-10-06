import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { reachable, skeleton } from "../analyze/facts.js"
import { UsageError } from "../errors.js"
import path from "node:path"

export const meta = {
  name: "mix",
  description: "Compare or contrast two files.",
  usage: "ownit mix <file-a> <file-b> [--model <id>]",
}

export async function prepare({ project, facts, opts }) {
  const [a, b] = (opts._args || []).slice(0, 2)
  if (!a || !b) throw new UsageError("Specify two files: ownit mix src/a.js src/b.js")
  const relA = path.relative(project.root, path.resolve(project.root, a)).split(path.sep).join("/")
  const relB = path.relative(project.root, path.resolve(project.root, b)).split(path.sep).join("/")
  for (const r of [relA, relB]) if (!facts.byPath.has(r)) throw new UsageError(`File not found in scan: ${r}`, { hint: "Paths should be relative to the project root and not ignored." })
  const ctx = projectContext(project, facts)
  const files = [relA, relB].map((r) => facts.byPath.get(r))

  return {
    title: `Compare — ${relA} vs ${relB}`,
    subtitle: `Comparison of \`${relA}\` and \`${relB}\`.`,
    output: ".ownit/MIX.md",
    units: [{
      id: "mix",
      label: "Comparison",
      files,
      context: ctx,
      system: makeSystem("You are a senior engineer comparing two modules. Be precise and code-grounded."),
      task: `Compare \`${relA}\` and \`${relB}\` in detail.

## Purpose
What each file does. Are they related, complementary, or do they overlap?

## Similarities
Shared patterns, shared dependencies, structural overlap.

## Differences
Where they diverge in approach, API surface, error handling, performance characteristics.

## Code Quality
Which is cleaner and why? Any issues in either?

## Recommendation
Should one replace the other? Should they be merged? Should one wrap the other? Be concrete.`,
      expect: ["Purpose", "Similarities", "Differences", "Recommendation"],
    }],
  }
}
