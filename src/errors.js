/** Every expected failure is an OwnitError: a message, an optional hint, an exit code. */
export class OwnitError extends Error {
  constructor(message, { hint, code = "OWNIT_ERROR", exitCode = 1, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "OwnitError"
    this.hint = hint
    this.code = code
    this.exitCode = exitCode
  }
}

export class UsageError extends OwnitError {
  constructor(message, opts = {}) {
    super(message, { code: "USAGE", exitCode: 2, ...opts })
    this.name = "UsageError"
  }
}

export class ConfigError extends OwnitError {
  constructor(message, opts = {}) {
    super(message, { code: "CONFIG", ...opts })
    this.name = "ConfigError"
  }
}

/** No model chosen. Carries the resolved provider so the CLI can list live models. */
export class ModelRequiredError extends ConfigError {
  constructor(message, resolved, opts = {}) {
    super(message, opts)
    this.code = "MODEL_REQUIRED"
    this.name = "ModelRequiredError"
    this.resolved = resolved
  }
}

export class ScanError extends OwnitError {
  constructor(message, opts = {}) {
    super(message, { code: "SCAN", ...opts })
    this.name = "ScanError"
  }
}

export class GitError extends OwnitError {
  constructor(message, opts = {}) {
    super(message, { code: "GIT", ...opts })
    this.name = "GitError"
  }
}

/**
 * kind: auth | model | quota | context | rate | param | bad_request | not_found |
 *       server | network | timeout | blocked | empty | aborted | unknown
 */
export class ProviderError extends OwnitError {
  constructor(message, { kind = "unknown", status, ...opts } = {}) {
    super(message, { code: "PROVIDER", ...opts })
    this.name = "ProviderError"
    this.kind = kind
    this.status = status
  }
}
