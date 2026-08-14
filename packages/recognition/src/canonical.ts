import { createHash } from "node:crypto";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function serialize(value: CanonicalJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON forbids non-finite numbers");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`).join(",")}}`;
}

export function canonicalize(value: unknown): Uint8Array {
  function validate(input: unknown): CanonicalJson {
    if (
      input === null ||
      typeof input === "boolean" ||
      typeof input === "string"
    )
      return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input))
        throw new TypeError("Canonical JSON forbids non-finite numbers");
      return input;
    }
    if (Array.isArray(input)) return input.map(validate);
    if (typeof input === "object") {
      const prototype = Object.getPrototypeOf(input) as unknown;
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError("Canonical JSON requires plain objects");
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => {
          if (item === undefined)
            throw new TypeError(`Canonical JSON forbids undefined at ${key}`);
          return [key, validate(item)];
        }),
      );
    }
    throw new TypeError(`Canonical JSON cannot encode ${typeof input}`);
  }
  return new TextEncoder().encode(serialize(validate(value)));
}

export function sha256Commitment(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

export function sha256Bytes(...values: readonly Uint8Array[]): `0x${string}` {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value);
  return `0x${hash.digest("hex")}`;
}
