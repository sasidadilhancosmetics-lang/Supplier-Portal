import { randomBytes } from "node:crypto";

/** Cuid-like id without adding a dependency. */
export function createId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}
