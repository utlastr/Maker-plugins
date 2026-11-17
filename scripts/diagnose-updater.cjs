const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.join(process.env.LOCALAPPDATA, "MakerWorkflow");
const request = Buffer.from(JSON.stringify({ action: "status" }));
const header = Buffer.alloc(4); header.writeUInt32LE(request.length);
const result = cp.spawnSync(path.join(root, "NativeHost.exe"), [], {
  input: Buffer.concat([header, request]), windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Native launcher failed: " + result.stderr.toString().slice(0, 1200));
const output = result.stdout;
if (output.length < 4 || output.readUInt32LE(0) !== output.length - 4) throw new Error("Invalid native response framing.");
const native = JSON.parse(output.subarray(4).toString("utf8"));
const marker = JSON.parse(fs.readFileSync(path.join(root, "extension/installation.json"), "utf8"));
console.log(JSON.stringify({ native, markerMatches: native.installId === marker.installId }, null, 2));
