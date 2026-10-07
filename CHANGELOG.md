# Changelog

## [1.0.0] — 2026-10-06

### Added
- Multi-provider support: Anthropic, OpenAI/OpenAI-compatible, Google Gemini, Groq, OpenRouter, Together, Mistral, DeepSeek, xAI, Fireworks, Cerebras, Ollama, LM Studio, any custom endpoint
- `kontx config` — interactive provider + model setup (live model listing per provider)
- `kontx models` — list available models for the current key
- `kontx cache` — show token savings; `--clear` to wipe
- 11 commands: full, risk, readme, qa, bug, env, diff, stack, flow, add, mix
- Static analysis engine: import graph (JS/TS/Python/Go), symbol extraction, env var scanner, route detection, 15 security/quality signal rules — all computed before any AI call
- Secret redaction: 12 token patterns, private key blocks, URL credentials, env assignments — redacted before hashing or sending
- Prompt caching: SHA-256 keyed on full prompt content; re-runs after no-op saves cost 0 tokens
- Auto-fit: files ranked by relevance; too-large ones shown as declaration skeletons; prompt auto-shrinks on context errors
- Consent gate: shows file count + token estimate; asks once per provider host, remembers the answer
- `--dry-run` to inspect what would be sent without sending
- `--no-ai` for static-facts-only output
- Typed errors with user-facing hints; clean Ctrl-C handling; cursor restore on all exit paths
- 41 unit tests, zero dependencies beyond Node.js built-ins

### Changed
- Output written to `.kontx/` (auto-gitignored) instead of scattered markdown files in the project root
- Config stored at `~/.kontx/config.json` (mode 0600) with v0.1 format auto-migrated
- Google provider uses `x-goog-api-key` header (key no longer appears in URLs / logs)
- `mix` uses `kontx mix a.js b.js` syntax (was `%`-separated)
