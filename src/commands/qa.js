import { makeSystem } from "../prompts.js"
import { projectContext, fileContext } from "../analyze/context.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "qa",
  description: "QA checklist — test coverage, edge cases, and missing assertions.",
  usage: "ownit qa [--model <id>] [--fresh]",
}

export async function prepare({ project, facts }) {
  const ctx = projectContext(project, facts)
  const codeFiles = project.files.filter((f) => f.kind === "code")
  const untestedMd = facts.untested.length
    ? "### 🧮 Untested Modules (exported symbols, no test imports found)\n" + facts.untested.map((p) => `- \`${p}\``).join("\n")
    : "### 🧮 Untested Modules\n_All exported modules appear to have test coverage._"

  return {
    title: "QA Checklist",
    subtitle: "Test coverage gaps, edge cases and missing assertions — grounded in the import graph.",
    output: ".ownit/QA.md",
    factsMd: untestedMd,
    units: [{
      id: "qa",
      label: "QA analysis",
      files: codeFiles,
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a QA engineer reviewing a codebase for gaps in test coverage and missing edge-case handling."),
      task: `Review the test coverage and quality of this codebase.

## Coverage Gaps
For each untested module listed above: name 2–3 specific test cases (function + scenario) that would add the most value. Use the actual function names from the static facts.

## Edge Cases Not Handled
Look at the code directly. For each function/handler you can see: list edge cases not guarded (null inputs, empty arrays, network errors, malformed data, race conditions). Cite \`file:line\`.

## Existing Test Quality
Are the existing tests meaningful? Do they test behaviour or just execution? Note anything that looks like a tautological test or a test that cannot fail.

## Suggested Test Plan
Prioritised list of 5–10 concrete tests to write next, with the file they should go in.`,
      expect: ["Coverage Gaps", "Edge Cases", "Existing Test Quality", "Suggested Test Plan"],
    }],
  }
}
