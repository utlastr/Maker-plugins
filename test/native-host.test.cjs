const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

test("native host replies while browser keeps its input pipe open", { skip: process.platform !== "win32" }, async () => {
  const binary = process.env.MAKER_NATIVE_HOST || JSON.parse(fs.readFileSync(
    path.join(process.env.LOCALAPPDATA, "MakerWorkflow/native-host.json"), "utf8")).path;
  const child = spawn(binary, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = Buffer.alloc(0);
  try {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Native response blocked by open browser input pipe")), 5000);
      child.stdout.on("data", bytes => {
        output = Buffer.concat([output, bytes]);
        if (output.length >= 4 && output.length >= 4 + output.readUInt32LE(0)) {
          clearTimeout(timer);
          resolve(JSON.parse(output.subarray(4, 4 + output.readUInt32LE(0))));
        }
      });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("exit", code => {
        if (!output.length) { clearTimeout(timer); reject(new Error("Host exited without a response: " + code)); }
      });
    });
    const request = Buffer.from(JSON.stringify({ action: "status" }));
    const header = Buffer.alloc(4); header.writeUInt32LE(request.length);
    child.stdin.write(Buffer.concat([header, request]));
    const result = await response;
    assert.equal(result.status, "ok");
    assert.match(result.installedVersion, /^\d+\.\d+\.\d+$/);
  } finally {
    child.stdin.destroy();
    child.kill();
  }
});
