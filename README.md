# ownit

> Understand, audit and document any codebase — yours or AI-written.

ownit reads your project with static analysis first (import graph, symbols, env vars, routes, security signals — all computed from code, zero AI calls). It then sends those facts, plus the source, to the AI model of your choice. The AI explains, not discovers.

**Works with any AI:** Claude, GPT-4o, Gemini, Groq, Mistral, DeepSeek, Ollama, LM Studio, or any OpenAI-compatible endpoint.

**Token-efficient:** Results are cached by a hash of the full prompt. Re-running after a save with no real changes costs 0 tokens.

**Safe by default:** Secrets are redacted before anything leaves your machine. You confirm before any code is sent.

---

## Install

```bash
npm install -g ownit
```

Requires Node.js 20 or newer.

## Quick start

```bash
# 1. Pick your AI provider once
ownit config

# 2. Run from any project root
cd my-project
ownit full         # full audit
ownit risk         # security scan
ownit readme       # generate README
ownit diff         # review staged changes
```

Output lands in `.ownit/` (gitignored automatically). Nothing is committed without you copying it out.

## Commands

| Command | What it produces |
|---------|-----------------|
| `full` | Architecture, dependencies, env, test coverage, risk — one report |
| `risk` | Security vulnerabilities and quality risks |
| `readme` | README.md generated from the actual code |
| `qa` | Test coverage gaps, edge cases, missing assertions |
| `bug` | Likely bugs and logic errors |
| `env` | All env vars — required/optional, where used, what's missing from `.env.example` |
| `diff` | Code review of staged changes or a branch diff |
| `stack` | Tech stack and architecture reference |
| `flow <file>` | Execution flow from an entry point |
| `add '<feature>'` | Step-by-step plan to add a feature |
| `mix <a> <b>` | Compare two files |

## Options

```
--model <id>        Model to use (e.g. claude-sonnet-5-5, gpt-4o, llama3-70b-8192)
--provider <name>   Force a provider (anthropic, openai, google, groq, openrouter, ollama…)
--key <key>         API key for this run only (not saved)
--base-url <url>    Any OpenAI-compatible endpoint (vLLM, LM Studio, Together, etc.)
--budget <tokens>   Context token budget per request (default: 60000)
--max-output <n>    Max output tokens (default: 8000)
--timeout <secs>    Request timeout (default: 300)
--exclude <glob>    Extra ignore pattern (repeatable)
--output <file>     Write output here instead of .ownit/
--fresh             Ignore the cache and make a new request
--no-ai             Only compute static facts, skip the AI call
--dry-run           Show what would be sent, without sending it
--yes               Skip the consent prompt (for CI / scripts)
```

## Providers

ownit supports three wire protocols that cover all major providers:

**Anthropic** — `ANTHROPIC_API_KEY=sk-ant-...`  
**OpenAI / OpenAI-compatible** — `OPENAI_API_KEY=sk-...`  
Also: Groq (`GROQ_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), Together, Mistral, DeepSeek, xAI, Fireworks, Cerebras  
**Google** — `GEMINI_API_KEY=AIza...`  
**Local** — Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`) need no key  
**Custom** — `ownit full --base-url https://your-host/v1 --model your-model`

```bash
# Groq (fast, cheap)
GROQ_API_KEY=gsk_... ownit full --model llama-3.3-70b-versatile

# Ollama (fully local, free)
ownit full --provider ollama --model llama3.2

# Any OpenAI-compatible API
ownit full --base-url https://api.together.xyz/v1 --key <key> --model meta-llama/Llama-3-70b-chat-hf
```

## Caching

Results are cached in `.ownit/cache/` keyed on a SHA-256 of the full prompt (including every file's content, the model name, and the prompt version). If nothing changed, the next run costs 0 tokens.

```bash
ownit cache          # show stats
ownit cache --clear  # wipe the cache
ownit full --fresh   # bypass the cache once
```

## What gets sent (and what doesn't)

ownit sends: source files (code, config, markup — not lockfiles, binaries, minified files, or files over 256 KB), with secret-looking values **redacted** before they leave your machine.

ownit never sends: `.env` files, `*.pem`/`*.key` files, `service-account.json`, `credentials.*`, private keys, or anything matching `.gitignore` / `.ownitignore`.

You are shown a token count and prompted to confirm before any code is sent. Use `--yes` to skip the prompt in CI, and `--dry-run` to see exactly what would be sent.

## Configuration file

Config is saved to `~/.ownit/config.json` (mode 0600). API keys are stored in plaintext — use environment variables if that's a concern.

```bash
ownit config   # interactive setup
```

## .ownitignore

Create `.ownitignore` in your project root (same syntax as `.gitignore`) to exclude additional files. It takes precedence over `.gitignore`.

## CI

```yaml
# .github/workflows/ownit.yml
- name: ownit risk
  run: npx ownit risk --yes
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## License

MIT
