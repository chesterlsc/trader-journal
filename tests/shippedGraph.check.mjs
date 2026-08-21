// THE FILE HAS TO SHIP, NOT JUST EXIST.
//
// Production went dark for every logged out visitor because app.js imported
// ./src/lib/sessionReport.js and that file was never tracked by git. It sat on
// disk, so every test passed and every local preview worked; the deploy got the
// import and not the module, and one missing file in an ES module graph fails
// the WHOLE graph. app.js never executed, body classes were never set, and the
// login panel was dead markup on a page with no program behind it.
//
// The blind spot was not the tests. It was that every other check reads the
// FILESYSTEM, and the filesystem is a superset of what ships. This one asks
// GIT instead: `git ls-files` is the set of paths that will exist on the
// server, and any reference resolving outside it is a 404 waiting for a push.
//
// Comparing against that set is exact, which buys a second production-only bug
// for free: a `./src/lib/SessionReport.js` import resolves happily on a
// case-insensitive Mac and 404s on Vercel's case-sensitive Linux. An exact
// string match fails here, on the machine, where it costs a minute instead of
// an outage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, posix, relative, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

let tracked;
try {
  tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  );
} catch {
  // A tarball or a stripped checkout has nothing to say about what ships.
  console.log("shippedGraph.check.mjs: SKIP (not a git work tree)");
  process.exit(0);
}

/* Every way this codebase points at another file it owns. Bare specifiers are
   somebody else's problem: node_modules and CDNs do not come out of this repo. */
const JS_REF = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const HTML_REF = /\b(?:src|href)\s*=\s*"([^"]+)"/g;

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{)/i;

/** Resolve one reference to a repo relative POSIX path, or null if it is not ours. */
function resolveRef(fromFile, spec) {
  if (!spec || EXTERNAL.test(spec)) return null;
  const clean = spec.split("?")[0].split("#")[0].trim();
  if (!clean) return null;
  // Bare specifier: not a path this repo is responsible for.
  if (!clean.startsWith(".") && !clean.startsWith("/")) return null;
  const base = clean.startsWith("/")
    ? resolve(ROOT, "." + clean)
    : resolve(dirname(resolve(ROOT, fromFile)), clean);
  const rel = relative(ROOT, base);
  // Escaping the repo is its own kind of broken, and never shippable.
  if (rel.startsWith("..")) return null;
  return rel.split(/[\\/]/).join(posix.sep);
}

/* THE APP'S RUNTIME GRAPH, and deliberately not one file more.
   docs/ holds archived design-tool exports (frozen <x-dc> markup that no page
   links to and that carries a dangling ./support.js from the tool that made
   it). Holding a historical record to the running app's standard would mean
   either editing the record or carrying a permanent exception, and a check
   people learn to ignore is worse than no check at all. What is guarded here
   is what a browser actually loads when someone opens the site. */
const OUT_OF_GRAPH = /^(?:node_modules|docs)\//;
const sources = [...tracked].filter((f) => /\.(js|mjs|html)$/.test(f) && !OUT_OF_GRAPH.test(f));
const misses = [];

for (const file of sources) {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const pattern = file.endsWith(".html") ? HTML_REF : JS_REF;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(src)) !== null) {
    const target = resolveRef(file, match[1]);
    if (target === null) continue;
    if (!tracked.has(target)) {
      misses.push(`${file} points at ${match[1]} which git does not track (resolves to ${target})`);
    }
  }
}

assert.deepEqual(
  misses,
  [],
  `these references exist on this machine but would 404 in production, because git does not track them.\n  ` +
    misses.join("\n  ") +
    "\n\ngit add the file, or fix the path. A tracked import of an untracked file is an outage on the next push."
);

/* The detector has to be able to fail, or it is decoration. Prove it against a
   path nothing could ever track, through the same resolver the scan uses. */
const canary = resolveRef("app.js", "./src/lib/__definitely_not_tracked__.js");
assert.equal(canary, "src/lib/__definitely_not_tracked__.js", "the resolver must resolve relative specifiers");
assert.ok(!tracked.has(canary), "the canary must not be tracked, or this check proves nothing");

console.log(`shippedGraph.check.mjs: OK — ${sources.length} tracked sources, every local reference ships`);
