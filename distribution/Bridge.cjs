const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const root = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(root, "bridge-config.json"), "utf8"));
const server = http.createServer((request, response) => {
  const send = (status, value) => {
    if (response.destroyed) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  };
  if (request.headers.authorization !== "Bearer " + config.token) return send(403, { error: "Local processor authentication failed." });
  if (request.method === "GET" && request.url === "/health") return send(200, { ready: true });
  if (request.method !== "POST" || request.url !== "/workflow") return send(404, { error: "Unknown processor operation." });
  const buffers = [];
  request.on("data", buffer => buffers.push(buffer));
  request.on("error", error => send(400, { error: error.message }));
  request.on("end", () => {
    let input;
    try { input = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
    catch { return send(400, { error: "Invalid workflow request." }); }
    const worker = spawn(process.execPath, [path.join(root, "WorkflowHost.cjs")], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    const output = [], errors = [];
    worker.stdout.on("data", bytes => output.push(bytes));
    worker.stderr.on("data", bytes => errors.push(bytes));
    worker.on("error", error => send(500, { error: error.message }));
    worker.on("close", () => {
      try {
        const result = JSON.parse(Buffer.concat(output).toString("utf8"));
        send(result.ok ? 200 : 500, result.ok ? { status: "workflow", value: result.value } : { error: result.error });
      } catch { send(500, { error: Buffer.concat(errors).toString("utf8").slice(-2000) || "Workflow processor returned no result." }); }
    });
    worker.stdin.on("error", () => {});
    worker.stdin.end(JSON.stringify(input));
  });
});
server.on("error", error => {
  fs.appendFileSync(path.join(root, "bridge.log"), new Date().toISOString() + " " + error.message + "\n");
  process.exitCode = 1;
});
server.listen(config.port, "127.0.0.1");
