const fs = require("node:fs");
const path = require("node:path");
const { connect } = require("./install.cjs");
const ids = ["kmebnpmacppaknnmegeechjipkjmjebe", "paljodokppnglgolfflffpggdefjdkbm"];
async function main() {
  const targets = await fetch("http://127.0.0.1:9222/json/list").then(response => response.json());
  const target = targets.find(item => item.type === "page" && item.url.includes("127.0.0.1:64929"));
  if (!target) throw new Error("Maker page is not open.");
  const clients = [];
  try {
    const browser = await connect(target.webSocketDebuggerUrl); clients.push(browser);
    const stores = [];
    for (const id of ids) {
      try {
        const reply = await browser.send("Extensions.getStorageItems", { id, storageArea: "local" });
        if (!reply.data) throw new Error("Cannot read extension data.");
        stores.push(reply.data);
      } catch (error) {
        if (id !== ids[0]) throw error;
        stores.push(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../backups/native-rebuild/extension-storage.json"), "utf8")));
      }
    }
    const directory = path.resolve(__dirname, "../backups/duplicate-instances");
    fs.mkdirSync(directory, { recursive: true });
    for (let i = 0; i < ids.length; i++)
      fs.writeFileSync(path.join(directory, ids[i] + "-" + Date.now() + ".json"), JSON.stringify(stores[i]));
    const updates = {};
    for (const [key, old] of Object.entries(stores[0])) {
      if (!key.startsWith("maker-workflow-3:")) continue;
      const current = stores[1][key];
      if (!current) { updates[key] = old; continue; }
      const history = {};
      for (const id of new Set([...Object.keys(old.history || {}), ...Object.keys(current.history || {})])) {
        const records = new Map([...(old.history?.[id] || []), ...(current.history?.[id] || [])].map(batch => [batch.batchId, batch]));
        history[id] = [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
      }
      const edges = new Map([...(old.edges || []), ...(current.edges || [])].map(edge => [edge.from + ":" + edge.to, edge]));
      updates[key] = { ...old, ...current, nodes: { ...old.nodes, ...current.nodes },
        edges: [...edges.values()], runs: { ...old.runs, ...current.runs }, history };
    }
    for (const [key, values] of Object.entries(stores[0])) {
      if (/^maker-workflow-(?:owned|owned:)/.test(key) && Array.isArray(values))
        updates[key] = [...new Set([...values, ...(stores[1][key] || [])])];
    }
    await browser.send("Extensions.setStorageItems", { id: ids[1], storageArea: "local", values: updates });
    console.log(JSON.stringify({ mergedCanvases: Object.keys(updates).filter(key => key.startsWith("maker-workflow-3:")).length, backup: directory }));
  } finally { for (const client of clients) client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
