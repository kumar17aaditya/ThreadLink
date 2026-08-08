// Resolves the "@/*" -> "./*" path alias (defined in tsconfig.json)
// for plain `node --test`/`node` runs, so unit tests can import the
// real frontend source files directly instead of duplicating logic
// or requiring a full Next.js/webpack build step just to run tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTEND_ROOT = fileURLToPath(new URL("../", import.meta.url));
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    for (const ext of EXTENSIONS) {
      const candidate = path.join(FRONTEND_ROOT, relative + ext);
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    throw new Error(`aliasResolver: could not resolve '${specifier}' under ${FRONTEND_ROOT}`);
  }
  return nextResolve(specifier, context);
}
