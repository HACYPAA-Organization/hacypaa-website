import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(root, "admin/index.html"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "assets/vendor/admin-dependencies.json"), "utf8"));
function assert(condition, message) { if (!condition) throw new Error(message); }
for (const entry of manifest) {
  assert(/^\/assets\/vendor\/[\w.-]+$/.test(entry.path), "Unexpected dependency path");
  const bytes = await readFile(path.join(root, entry.path));
  const integrity = "sha384-" + createHash("sha384").update(bytes).digest("base64");
  assert(entry.integrity === integrity, "Dependency bytes changed: " + entry.package);
  const tag = [...html.matchAll(/<script\b[^>]*>/gs)].map(match => match[0])
    .find(script => script.includes(`src="${entry.path}"`));
  assert(tag?.includes(`integrity="${integrity}"`), "Dependency integrity missing: " + entry.package);
  assert(tag?.includes('crossorigin="anonymous"'), "Dependency crossorigin missing: " + entry.package);
}
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  assert(/\bsrc\s*=\s*["'](?:\/|\.\.\/)/.test(match[1]), "Admin scripts must be self-hosted");
  assert(!match[2].trim(), "Inline administrative scripts are forbidden");
}
assert(/script-src 'self';/.test(html), "Restrictive administrative script policy missing");
assert(!/unsafe-inline|unsafe-eval|cdn\.jsdelivr/.test(html), "Unsafe administrative source policy");
assert(/object-src 'none'/.test(html) && /base-uri 'none'/.test(html), "Administrative CSP baseline weakened");
const testConfig = JSON.parse(await readFile(path.join(root, "conference-api/wrangler.test.jsonc"), "utf8"));
assert(testConfig.vars.FULFILLMENT_MODE === "disabled", "Test fulfillment must remain disabled");
assert(!testConfig.queues, "Tests must not bind production queues");
assert(testConfig.d1_databases.every(db => db.database_id.startsWith("00000000-")), "Test D1 bindings must be isolated");
console.log("Security static checks passed: pinned dependency bytes, admin CSP, and isolated test bindings.");
