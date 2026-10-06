import { makeSystem } from "../prompts.js"
import { projectContext, fileContext } from "../analyze/context.js"
import { reachable, skeleton } from "../analyze/facts.js"
import { UsageError } from "../errors.js"
import path from "node:path"

export const meta = {
  name: "add",
  description: "Plan how to add a feature to this codebase.",
  usage: "ownit add '<feature description>' [--model <id>]",
}

export async function prepare({ project, facts, opts, cwd }) {
  const feature = opts.feature || opts._args?.[0]
  if (!feature?.trim()) throw new UsageError("Describe the feature: ownit add 'add a login endpoint'")
  const ctx = projectContext(project, facts)
  const codeFiles = project.files.filter((f) => f.kind === "code" && !facts.testFiles.includes(f.path))

  return {
    title: `Feature Plan — ${feature.slice(0, 60)}`,
    subtitle: "Concrete implementation plan grounded in the codebase.",
    output: ".ownit/ADD.md",
    units: [{
      id: "add",
      label: "Feature plan",
      numbered: true,
      files: codeFiles,
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a senior engineer planning a feature addition. Every recommendation must reference real files and real functions from the code provided."),
      task: `Plan the implementation of: **${feature}**

## Where to make changes
For each file that needs changing: exact path, which functions to add/modify, and why.

## New files needed
If new files are needed, give: path, what it exports, why a separate file makes sense (don't add files just to add files).

## Step-by-step implementation
Numbered steps. Each step: what to do, in which file/function, and what to watch out for. Be specific — use the real function and variable names from the facts.

## Tests
What tests to write and where (use the existing test framework: ${facts.frameworks.join(", ") || "none detected"}).

## Risk
What could go wrong with this approach, and what to validate before merging.`,
      expect: ["Where to make changes", "Step-by-step", "Tests", "Risk"],
    }],
  }
}
