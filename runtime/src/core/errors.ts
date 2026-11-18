export class GhlError extends Error {
  readonly code: string;
  readonly category: "unsupported" | "configuration";
  readonly details: Record<string, unknown>;
  constructor(code: string, category: "unsupported" | "configuration", message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.category = category;
    this.details = details;
  }
  toJSON(): Record<string, unknown> {
    return { code: this.code, category: this.category, message: this.message, details: this.details };
  }
}

export class UnsupportedRule extends GhlError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("UnsupportedRule", "unsupported", message, details);
  }
}

export class ConfigError extends GhlError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("ConfigError", "configuration", message, details);
  }
}
