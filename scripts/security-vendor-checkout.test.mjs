import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Git preserves vendor bytes and upstream whitespace while checking application whitespace", async () => {
  const tempRoot = await realpath(process.env.HACYPAA_TEST_TMPDIR || os.tmpdir());
  const fixture = await mkdtemp(path.join(tempRoot, "hacypaa-vendor-checkout-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  const runGit = (...args) => {
    const result = spawnSync("git", ["-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args], {
      cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000,
    });
    assert.ifError(result.error);
    return result;
  };
  const git = (...args) => {
    const result = runGit(...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "assets/vendor/admin-dependencies.json"), "utf8"));
    await mkdir(path.join(fixture, "assets/vendor"), { recursive: true });
    await copyFile(path.join(root, "assets/vendor/.gitattributes"), path.join(fixture, "assets/vendor/.gitattributes"));
    for (const entry of manifest) {
      const relative = entry.path.replace(/^\//, "");
      await copyFile(path.join(root, relative), path.join(fixture, relative));
    }
    const control = "// Outside vendor attributes\n// Git should convert this control to CRLF\n";
    await writeFile(path.join(fixture, "control.js"), control);
    git("init", "--quiet");
    git("add", "--", "assets/vendor", "control.js");
    git("diff", "--cached", "--check");
    await writeFile(path.join(fixture, "control.js"), "// Application whitespace must still fail \n");
    git("add", "--", "control.js");
    const rejected = runGit("diff", "--cached", "--check");
    assert.notEqual(rejected.status, 0, "Whitespace checks must remain enabled outside vendor scripts");
    assert.match(rejected.stdout, /control\.js:1: trailing whitespace/);
    assert.ok(!rejected.stdout.includes("assets/vendor/"), "Do not rewrite pinned upstream code to satisfy whitespace lint");
    await writeFile(path.join(fixture, "control.js"), control);
    git("add", "--", "control.js");
    git("diff", "--cached", "--check");
    for (const entry of manifest) await unlink(path.join(fixture, entry.path.replace(/^\//, "")));
    await unlink(path.join(fixture, "assets/vendor/.gitattributes"));
    await unlink(path.join(fixture, "control.js"));
    git("checkout-index", "--all", "--force");
    assert.ok((await readFile(path.join(fixture, "control.js"))).includes(Buffer.from("\r\n")), "Control must demonstrate enabled CRLF conversion");
    for (const entry of manifest) {
      const bytes = await readFile(path.join(fixture, entry.path.replace(/^\//, "")));
      const integrity = "sha384-" + createHash("sha384").update(bytes).digest("base64");
      assert.equal(integrity, entry.integrity, "Checkout changed exact bytes for " + entry.package);
      assert.equal(bytes.length, entry.sizeBytes);
    }
  } finally {
    const resolved = await realpath(fixture);
    assert.equal(path.dirname(resolved), tempRoot, "Cleanup must remain in the temporary directory");
    assert.ok(path.basename(resolved).startsWith("hacypaa-vendor-checkout-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
