import { getKeyValue } from "./get-key-value";

type Context = Record<string, unknown> | Map<string, unknown>;

export function resolveTemplateExpressions<T extends Record<string, unknown>>(
  obj: T,
  contexts: Record<string, Context>
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = Array.isArray(obj) ? [] : {};

  Object.entries(obj).forEach(([key, value]) => {
    // If the value is a string and contains a template expression, resolve it
    const expressionRegex = /\{\{\s*([^}]+\s*)\}\}/g;
    if (typeof value === "string" && expressionRegex.test(value)) {
      Object.defineProperty(result, key, {
        get: () => {
          return value.replace(expressionRegex, (match, expression) => {
            const resolved = getKeyValue(contexts, expression.trim());
            if (!resolved) return match;
            if (typeof resolved === "object" && resolved !== null) {
              return JSON.stringify(resolved);
            }
            return String(resolved);
          });
        },
      });
    } else if (typeof value === "string") {
      result[key] = value;
    } else if (typeof value === "object" && value !== null) {
      // Recursively resolve nested objects
      result[key] = resolveTemplateExpressions(
        value as Record<string, unknown>,
        contexts
      );
    } else {
      result[key] = value;
    }
  });

  return result as T;
}
