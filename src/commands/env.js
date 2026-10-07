import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { mdTable } from "../render.js"

export const meta = {
  name: "env",
  description: "Audit environment variables — which are used, required, and undocumented.",
  usage: "kontx env [--no-ai] [--model <id>]",
}

export async function prepare({ project, facts }) {
  const ctx = projectContext(project, facts)
  const vars = [...facts.envVars.values()]
  if (!vars.length) return { empty: "No environment variable usage found in this codebase." }

  const tableRows = vars.map((e) => [
    e.name,
    e.uses.some((u) => !u.hasDefault) ? "required" : "optional",
    e.uses.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(", "),
  ])
  const factsMd = "### 🧮 Env Var Usage (computed from code)\n" + mdTable(["Name", "Required?", "Used at"], tableRows)

  return {
    title: "Environment Variables",
    subtitle: "All env vars found in the code, with required/optional status and usage locations.",
    output: ".kontx/ENV.md",
    factsMd,
    units: [{
      id: "env",
      label: "Env audit",
      files: [...new Set(vars.flatMap((e) => e.uses.map((u) => u.file)))].map((p) => facts.byPath.get(p)).filter(Boolean),
      context: ctx,
      system: makeSystem("You are a DevOps engineer auditing environment variables and runtime configuration."),
      task: `Using the env var table above and the code, write an environment variable guide.

## Required Variables
For each required var: what it does, where it is consumed, consequences if missing.

## Optional Variables
For each optional var: default behaviour, what changing it controls.

## Missing Template Entries
Cross-reference against .env.example / .env.sample (if visible). List any var used in code that has no entry in the template.

## Recommendations
Any naming inconsistencies, unsafe defaults, or validation that should be added.`,
      expect: ["Required Variables", "Optional Variables"],
    }],
  }
}
