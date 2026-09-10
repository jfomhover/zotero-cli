export type ErrorCode =
  "USAGE" | "AUTH" | "NOT_FOUND" | "TEMPORARY" | "PROVIDER" | "CANCELLED";

export class CliError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const exitCode: Record<ErrorCode, number> = {
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  TEMPORARY: 5,
  PROVIDER: 6,
  CANCELLED: 130,
};

export function safeMessage(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u001b]/g, "")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]");
}

// Remote text must not be able to rewrite a terminal or spoof a status line.
export function safeDisplay(value: unknown): string {
  return String(value)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\r\n]/g, " ");
}
