import { makeSystem } from "../prompts.js"
import { projectContext } from "../analyze/context.js"
import { renderTree, fmt } from "../render.js"
import { skeleton } from "../analyze/facts.js"

export const meta = {
  name: "readme",
  description: "Generate or refresh README.md from the actual code.",
  usage: "kontx readme [--model <id>] [--fresh] [--overwrite]",
}

export async function prepare({ project, facts, opts }) {
  const ctx = projectContext(project, facts)
  const m = facts.manifests.find((x) => x.type === "npm") || facts.manifests[0]
  const binEntries = Object.entries(m?.bin || {})
  const factsMd = [
    "<!-- kontx facts (not shown in final README, used by AI) -->",
    `- name: ${m?.name || project.name}  version: ${m?.version || "?"}`,
    `- entry: ${facts.entries.map((e) => e.path).join(", ") || "none"}`,
    `- bin: ${binEntries.map(([k, v]) => `${k} → ${v}`).join(", ") || "none"}`,
    `- languages: ${facts.langs.slice(0, 4).map((l) => l.lang).join(", ")}`,
    `- scripts: ${Object.keys(m?.scripts || {}).join(", ") || "none"}`,
    `- tree:\n\`\`\`\n${renderTree(project.files.map((f) => f.path), { maxDepth: 2, maxLines: 40 })}\n\`\`\``,
  ].join("\n")

  return {
    title: "README",
    subtitle: "README.md generated from the actual codebase.",
    raw: true,
    units: [{
      id: "readme",
      label: "README",
      files: project.files.filter((f) => f.kind === "code" || f.kind === "config"),
      skeleton: (p) => skeleton(facts, facts.byPath.get(p)),
      context: ctx,
      system: makeSystem("You are a developer writing clear, honest documentation for a real project. Every claim must be backed by code you can see."),
      task: `Write a complete, accurate README.md for this project. Use only what you can verify in the code.

# ${m?.name || project.name}

One-sentence description.

## What it does
2–4 sentences. Concrete, specific. Name the main things it actually does.

## Install
Exact commands, taken from package manager files or scripts you can see.

## Usage
If there is a CLI (bin entry or shebang file): show the real commands and flags. If it is a library: show a minimal import + call. Use only things you can verify exist in the code.

## Configuration
List env vars the code actually reads. For each: name, what it controls, whether it is required or optional (infer from defaults).

## Project layout
Paste the file tree from the facts. Add one-line descriptions for important files/folders.

## Development
Real scripts from package.json / Makefile / Justfile. Add nothing you can't see.

## License
${m?.license ? `${m.license} — confirmed from manifest.` : "Not specified in the manifest."}`,
      expect: ["What it does", "Install", "Usage", "Configuration"],
    }],
    finalize: ({ texts, aiOff }) => [{
      path: opts.overwrite ? "README.md" : ".kontx/README.md",
      content: (aiOff ? "" : texts[0] || "") + (!aiOff && texts[0] ? "" : "\n"),
      backup: opts.overwrite,
    }],
  }
}
