// Custom Node ESM loader for tests.
// Resolves extension-less specifiers like `./config` → `./config.ts`
// so tests can import src/*.ts under --experimental-strip-types on
// Node 25, without editing every import in src/.

import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, extname, resolve as pathResolve } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
    try {
      const parent = fileURLToPath(context.parentURL);
      const parentDir = dirname(parent);
      const withTs = pathResolve(parentDir, specifier + ".ts");
      if (existsSync(withTs)) {
        return nextResolve(pathToFileURL(withTs).href, context);
      }
      const withMts = pathResolve(parentDir, specifier + ".mts");
      if (existsSync(withMts)) {
        return nextResolve(pathToFileURL(withMts).href, context);
      }
    } catch { /* fall through */ }
  }
  return nextResolve(specifier, context);
}
