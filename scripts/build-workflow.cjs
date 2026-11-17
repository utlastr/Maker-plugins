const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
require("esbuild").buildSync({
  entryPoints: [path.join(root, "native/workflow.ts")],
  outfile: path.join(root, "distribution/WorkflowHost.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node20",
  nodePaths: [path.join(root, "node_modules"), "D:/Users/KLEI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"],
  minify: true, legalComments: "eof",
  plugins: []
});
fs.copyFileSync(path.join(root, "NOTICE.md"), path.join(root, "distribution/NOTICE.md"));
