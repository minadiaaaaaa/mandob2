import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Generated evidence stays local; resolve defaults independently of the caller's cwd.
const reportsDirectory = fileURLToPath(
  new URL("../../../.qa-reports/", import.meta.url),
);

export function reportFile(name, override) {
  const target = override ? resolve(override) : resolve(reportsDirectory, name);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}
