const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
async function main() {
  const baseline = path.resolve(process.argv[2] || path.join(root, "dist/package-4.5.1"));
  const fixture = path.join(root, "backups/updater-verification-" + crypto.randomUUID());
  fs.cpSync(baseline, fixture, { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(fixture, "update-config.json"), "utf8"));
  config.installId = crypto.randomUUID();
  config.nodePath = process.execPath;
  fs.writeFileSync(path.join(fixture, "update-config.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(fixture, "native-host.json"), JSON.stringify({
    name: "cn.maker.workflow.updater", path: path.join(fixture, "NativeHost.exe"), type: "stdio",
    allowed_origins: ["chrome-extension://" + config.extensionId + "/"]
  }));
  function request(value) {
    return new Promise((resolve, reject) => {
      // Match a normal browser launch, without PowerShell Core's inherited module path.
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
      const processChild = spawn(path.join(fixture, "NativeHost.exe"), [], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: environment
      });
      const chunks = [];
      const timer = setTimeout(() => { processChild.kill(); reject(new Error("Native update check timed out.")); }, 180000);
      processChild.stdout.on("data", chunk => chunks.push(chunk));
      processChild.stderr.on("data", () => {});
      processChild.on("error", error => { clearTimeout(timer); reject(error); });
      processChild.on("close", () => {
        clearTimeout(timer);
        try {
          const output = Buffer.concat(chunks);
          assert.equal(output.readUInt32LE(0), output.length - 4);
          resolve(JSON.parse(output.subarray(4).toString("utf8")));
        } catch (error) { reject(error); }
      });
      const body = Buffer.from(JSON.stringify({ ...value, extensionId: config.extensionId, installId: config.installId }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      processChild.stdin.on("error", () => {});
      processChild.stdin.end(Buffer.concat([header, body]));
    });
  }
  const before = JSON.parse(fs.readFileSync(path.join(fixture, "extension/manifest.json"))).version;
  const desired = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"))).version;
  const check = await request({ action: "check", version: before });
  console.log(JSON.stringify({ phase: "check", from: before, status: check.status, version: check.version, message: check.message }));
  assert.equal(check.status, "ready");
  assert.equal(check.version, desired);
  const apply = await request({ action: "apply", version: check.version });
  console.log(JSON.stringify({ phase: "apply", status: apply.status, version: apply.version, message: apply.message }));
  assert.equal(apply.status, "installed");
  const after = JSON.parse(fs.readFileSync(path.join(fixture, "extension/manifest.json"))).version;
  assert.equal(after, desired);
  for (const file of ["update.html", "update.js", "update.css", "update-trigger.js"])
    assert.ok(fs.existsSync(path.join(fixture, "extension", file)), file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, "native-host.json"))).path,
    path.join(fixture, "NativeHost-" + desired + ".exe"));
  console.log(JSON.stringify({ verified: true, from: before, to: after, isolatedDirectory: fixture }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
