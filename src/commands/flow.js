import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { reachable, skeleton } from "../analyze/facts.js"
import { UsageError } from "../errors.js"
import path from "node:path"

export const meta = {
  name: "flow",
  description: "Trace the execution flow from an entry point.",
  usage: "kontx flow <file> [--model <id>]",
}

export async function prepare({ project, facts, opts }) {
  const target = opts.target || opts._args?.[0]
  if (!target) throw new UsageError("Specify a file: kontx flow src/index.js")
  const rel = path.relative(project.root, path.resolve(project.root, target)).split(path.sep).join("/")
  if (!facts.byPath.has(rel)) throw new UsageError(`File not found in scan: ${rel}`, { hint: "Make sure the path is relative to the project root, and the file is not ignored." })
  const ctx = projectContext(project, facts)
  const nodes = reachable(facts, rel, 6).slice(0, 40)
  const files = nodes.map((n) => facts.byPath.get(n.path)).filter(Boolean)

  return {
    title: `Flow — ${rel}`,
    subtitle: `Execution flow from \`${rel}\`.`,
    output: ".kontx/FLOW.md",
    units: [{
      id: "flow",
      label: "Flow trace",
      numbered: true,
      files,
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a senior engineer tracing how code executes. Cite every claim with file:line."),
      task: `Trace the execution flow starting from \`${rel}\`.

## Entry
What happens when \`${rel}\` is loaded / called / executed. Name the first functions that run.

## Flow
Step-by-step: which function calls which, in which file, what data moves between them. Use \`file:line\` for every step. Follow the most important path (ignore error handlers and rarely-used branches unless they are architecturally significant).

## Data Transformations
What data comes in, how is it transformed at each stage, what goes out.

## Side Effects
Writes, network calls, state mutations, anything with consequences outside the local call.

## Diagram (text)
A simple text call-graph: \`fn (file) → fn (file) → …\`. One level of depth per line.`,
      expect: ["Entry", "Flow", "Data Transformations", "Side Effects"],
    }],
  }
}
