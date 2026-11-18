// Registers synchronous module-resolution hooks so GHL code can import the pinned
// upstream packages ("gakumas-engine", "gakumas-data") straight from the local
// checkout in ./upstream without vendoring or installing them.
//
// Upstream sources use extensionless ESM imports and import JSON as default
// exports (they are bundled by Next.js in their own project). These hooks add
// exactly those two behaviours, mirroring upstream's own
// scripts/extensionless-loader.mjs. Load with: node --import ./src/upstream/register.ts
import { registerHooks } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const UPSTREAM_PACKAGES_DIR =
  process.env.GHL_UPSTREAM_DIR ?? path.join(REPO_ROOT, "upstream", "gakumas-tools", "packages");
const UPSTREAM_URL_PREFIX = pathToFileURL(UPSTREAM_PACKAGES_DIR).href;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveFile(base: string): string | null {
  if (isFile(base)) return base;
  if (isFile(`${base}.js`)) return `${base}.js`;
  if (isFile(path.join(base, "index.js"))) return path.join(base, "index.js");
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const pkg of ["gakumas-data", "gakumas-engine"]) {
      if (specifier === pkg || specifier.startsWith(`${pkg}/`)) {
        if (!existsSync(UPSTREAM_PACKAGES_DIR)) {
          throw new Error(
            `GHL: upstream checkout missing at ${UPSTREAM_PACKAGES_DIR}. Run the data preparation steps in the project README`,
          );
        }
        const sub = specifier === pkg ? "index" : specifier.slice(pkg.length + 1);
        const resolved = resolveFile(path.join(UPSTREAM_PACKAGES_DIR, pkg, sub));
        if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
    const parent = context.parentURL ?? "";
    if (parent.startsWith(UPSTREAM_URL_PREFIX) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      const base = fileURLToPath(new URL(specifier, parent));
      const resolved = resolveFile(base);
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(UPSTREAM_URL_PREFIX) && url.endsWith(".json")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${source};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
