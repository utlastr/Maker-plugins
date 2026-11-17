const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
async function main() {
  const root = path.resolve(__dirname, "..");
  const session = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, ".taptap-maker/console/session.json")));
  const state = await fetch(session.origin + "/api/state").then(response => response.json());
  const project = state.projects.find(item => item.path.replace(/\\/g, "/").endsWith("/HelloWorld"));
  if (!project) throw new Error("HelloWorld project unavailable.");
  const image = fs.readdirSync(path.join(project.path, "assets/image"))
    .find(name => /^canvas-.*\.png$/.test(name) && fs.statSync(path.join(project.path, "assets/image", name)).size < 100000);
  if (!image) throw new Error("No existing test image.");
  const outputs = [];
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
  for (const operation of ["refine", "name"]) {
    const request = { operation, origin: session.origin, project: project.key,
      value: { requestId: randomUUID(), image: { path: "assets/image/" + image },
        previousPrompt: "红色花朵，白色背景，保持花朵数量和位置。",
        instructions: "花朵改成蓝色，其他保持不变。", name: "红色花朵",
        context: { prefixes: ["红色花朵"], tasks: [{ prompt: "红色花朵" }] } } };
    const result = spawnSync(process.execPath, [path.join(root, "distribution/WorkflowHost.cjs")], {
      input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024
    });
    const output = JSON.parse(result.stdout || "{}");
    outputs.push({ operation, requestId: request.value.requestId, ...output });
    console.log(JSON.stringify(outputs.at(-1)));
    fs.writeFileSync(path.join(root, "evidence/refinement-cloud.json"), JSON.stringify(outputs, null, 2));
    if (!output.ok) throw new Error(output.error || result.error?.message || "Cloud verification failed.");
  }
  fs.writeFileSync(path.join(root, "evidence/refinement-cloud.json"), JSON.stringify(outputs, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
