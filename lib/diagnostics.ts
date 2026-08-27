export type ApiLog = {
  id: number;
  at: string;
  operation: string;
  request: unknown;
  state: "pending" | "success" | "error";
  durationMs?: number;
  summary?: unknown;
};
let entries: ApiLog[] = [];
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[max depth]";
  if (typeof value === "string")
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
      .replace(
        /([?&](?:access_token|token|api_key|authorization)=)[^&\s]+/gi,
        "$1[redacted]",
      );
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /authorization|cookie|password|token|secret|api.?key/i.test(k)
          ? "[redacted]"
          : sanitize(v, depth + 1),
      ]),
    );
  return value;
}
export const getLogs = () => entries;
// RPC errors are often plain objects, not Error instances. Preserve useful server details.
export function errorMessage(error: unknown, depth = 0): string {
  if (depth > 4) return "StreamBIM kunde inte slutföra anropet";
  if (error instanceof Error) return String(sanitize(error.message)).slice(0, 800);
  if (typeof error === "string") {
    try { return errorMessage(JSON.parse(error), depth + 1); } catch { /* plain text */ }
    return String(sanitize(error)).slice(0, 800);
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const status = value.status ?? value.statusCode;
    const prefix = status ? `HTTP ${status}: ` : "";
    if (Array.isArray(value.errors) && value.errors.length)
      return prefix + errorMessage(value.errors[0], depth + 1);
    if (value.responseText) return prefix + errorMessage(value.responseText, depth + 1);
    const detail = value.detail ?? value.message ?? value.title;
    if (detail) return prefix + errorMessage(detail, depth + 1);
    if (value.code) return prefix + `StreamBIM-fel: ${String(sanitize(value.code))}`;
    if (status) return `HTTP ${status}: StreamBIM kunde inte slutföra anropet`;
  }
  return "StreamBIM kunde inte slutföra anropet";
}
export const clearLogs = () => {
  entries = [];
  emit();
};
export function subscribeLogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function traced<T>(
  operation: string,
  request: unknown,
  action: () => Promise<T>,
  summarize: (result: T) => unknown = () => ({ ok: true }),
): Promise<T> {
  const id = ++serial,
    start = Date.now();
  entries = [
    ...entries,
    {
      id,
      at: new Date().toISOString(),
      operation,
      request: sanitize(request),
      state: "pending" as const,
    },
  ].slice(-60);
  emit();
  const finish = (state: ApiLog["state"], summary: unknown) => {
    entries = entries.map((e) =>
      e.id === id
        ? {
            ...e,
            state,
            durationMs: Date.now() - start,
            summary: sanitize(summary),
          }
        : e,
    );
    emit();
  };
  try {
    const result = await action();
    finish("success", summarize(result));
    return result;
  } catch (e) {
    finish("error", {
      message: errorMessage(e),
      details: e instanceof Error ? undefined : e,
    });
    throw e;
  }
}
