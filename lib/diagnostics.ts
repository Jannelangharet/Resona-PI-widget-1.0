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
      message:
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null
            ? e
            : "API-anropet misslyckades",
    });
    throw e;
  }
}
