import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { mdTable, renderTree } from "../render.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "stack",
  description: "Document the tech stack and architecture.",
  usage: "kontx stack [--no-ai] [--model <id>]",
}

export async function prepare({ project, facts }) {
  const ctx = projectContext(project, facts)
  const prodDeps = facts.deps.filter((d) => d.kind === "prod" || d.kind === "direct").slice(0, 50)
  const depMd = "### 🧮 Production Dependencies\n" + mdTable(["Package", "Version", "Used in"], prodDeps.map((d) => [d.name, d.version, d.usedBy.slice(0, 2).join(", ")]))
  const routeMd = facts.routes.length
    ? "\n### 🧮 Routes\n" + mdTable(["Method", "Path", "File", "Line"], facts.routes.slice(0, 40).map((r) => [r.method, r.path, r.file, String(r.line)]))
    : ""
  const treeMd = "\n### 🧮 File Tree\n```\n" + renderTree(project.files.map((f) => f.path)) + "\n```"

  return {
    title: "Tech Stack",
    subtitle: "Languages, frameworks and architecture documented from the code.",
    output: ".kontx/STACK.md",
    factsMd: depMd + routeMd + treeMd,
    units: [{
      id: "stack",
      label: "Stack doc",
      files: project.files.filter((f) => f.kind === "code" || f.kind === "config"),
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a technical writer documenting a codebase for engineers joining the project."),
      task: `Write a tech-stack and architecture document.

## Stack
List: runtime / language versions, frameworks, databases, caches, queues, auth mechanisms, third-party services — only things confirmed by the code and dependencies.

## Architecture
How the pieces fit together. Data flow from request to response (or input to output). Key design patterns in use.

## Key Modules
For the 5–8 most important files/modules: what they do and which other modules depend on them (use the import graph from the facts).

## Development Setup
What a new developer needs to do to run this locally, based on scripts and env vars in the code.`,
      expect: ["Stack", "Architecture", "Key Modules", "Development Setup"],
    }],
  }
}
