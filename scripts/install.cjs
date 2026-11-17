const path = require("node:path");
const WebSocket = globalThis.WebSocket || require(require.resolve("ws", {
  paths: ["D:/Users/KLEI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"]
}));

async function connect(url) {
  const socket = new WebSocket(url), calls = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = event => {
    const reply = JSON.parse(event.data), pending = calls.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer); calls.delete(reply.id);
    if (reply.error) pending.reject(new Error(reply.error.message));
    else pending.resolve(reply.result);
  };
  socket.onclose = () => {
    for (const pending of calls.values()) {
      clearTimeout(pending.timer); pending.reject(new Error("Debugger disconnected."));
    }
    calls.clear();
  };
  return {
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { calls.delete(id); reject(new Error(method + " timed out.")); }, 5000);
        calls.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    }
  };
}
async function main() {
  const root = "http://127.0.0.1:9222";
  const version = await fetch(root + "/json/version").then(r => r.json());
  const browser = await connect(version.webSocketDebuggerUrl);
  try {
    if (process.argv[2] === "--load-installed") {
      const installedPath = path.join(process.env.LOCALAPPDATA, "MakerWorkflow/extension");
      const result = await browser.send("Extensions.loadUnpacked", { path: installedPath });
      console.log(JSON.stringify(result)); return;
    }
    const extensionPath = path.resolve(__dirname, "../extension");
    const expectedVersion = JSON.parse(require("node:fs").readFileSync(path.join(extensionPath, "manifest.json"), "utf8")).version;
    const find = result => result.extensions.find(e => path.resolve(e.path).toLowerCase() === extensionPath.toLowerCase() &&
      (!process.env.MAKER_EXTENSION_ID || e.id === process.env.MAKER_EXTENSION_ID));
    if (process.argv[2] === "--list-maker") {
      const { extensions } = await browser.send("Extensions.getExtensions");
      console.log(JSON.stringify(extensions.filter(extension => /maker|workflow/i.test(extension.name))));
      return;
    }
    const previous = find(await browser.send("Extensions.getExtensions"));
    if (process.argv[2] === "--repair-extension") {
      await browser.send("Extensions.loadUnpacked", { path: extensionPath });
      const installed = find(await browser.send("Extensions.getExtensions"));
      if (!installed?.enabled || installed.version !== expectedVersion) throw new Error("Extension repair did not complete.");
      console.log(JSON.stringify(installed)); return;
    }
    if (previous) {
      let targets = await fetch(root + "/json/list").then(r => r.json());
      let target = targets.find(t => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${previous.id}/`));
      if (!target) {
        const page = targets.find(t => t.type === "page" && t.url.startsWith("http://127.0.0.1:"));
        if (!page) throw new Error("Open the Maker console before reloading its extension.");
        const manager = await connect(page.webSocketDebuggerUrl);
        try {
          await manager.send("ServiceWorker.enable");
          await manager.send("ServiceWorker.startWorker", { scopeURL: `chrome-extension://${previous.id}/` });
        } finally { manager.close(); }
        for (let i = 0; i < 20 && !target; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          targets = await fetch(root + "/json/list").then(r => r.json());
          target = targets.find(t => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${previous.id}/`));
        }
      }
      if (!target) throw new Error("Extension worker could not start; refresh the extension in its manager.");
      const worker = await connect(target.webSocketDebuggerUrl);
      try {
        if (process.argv[2] === "--node-diagnose") {
          const id = process.argv[3];
          if (!/^[a-f0-9-]{36}$/i.test(id || "")) throw new Error("Provide a node UUID.");
          const result = await worker.send("Runtime.evaluate", {
            expression: `chrome.storage.local.get(null).then(values=>Object.entries(values).filter(([key,graph])=>key.startsWith("maker-workflow-3:")&&graph.nodes?.[${JSON.stringify(id)}]).map(([key,graph])=>({canvas:key,node:graph.nodes[${JSON.stringify(id)}],incoming:graph.edges.filter(edge=>edge.to===${JSON.stringify(id)}).map(edge=>graph.nodes[edge.from]),batches:(graph.history?.[${JSON.stringify(id)}]||[graph.runs?.[${JSON.stringify(id)}]]).filter(Boolean).slice(-3)})))`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Could not inspect this node.");
          console.log(JSON.stringify(result.result?.value)); return;
        }
        if (process.argv[2] === "--backup-store") {
          const directory = path.resolve(__dirname, "../backups/native-rebuild");
          const result = await worker.send("Runtime.evaluate", {
            expression: "chrome.storage.local.get(null)", awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Extension data backup failed.");
          require("node:fs").mkdirSync(directory, { recursive: true });
          require("node:fs").writeFileSync(path.join(directory, "extension-storage.json"), JSON.stringify(result.result.value, null, 2));
          console.log(JSON.stringify({ backedUp: true, directory })); return;
        }
        if (process.argv[2] === "--refresh-canvases") {
          await worker.send("Runtime.evaluate", { expression: "void installIntoOpenPages(true)" });
          console.log(JSON.stringify({ requested: true })); return;
        }
        if (process.argv[2] === "--bbox-media-diagnose") {
          const origin = process.argv[3], project = process.argv[4];
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") || !/^[a-f0-9]{64}$/i.test(project || ""))
            throw new Error("Provide the local Maker origin and project key.");
          const inspect = async function (origin, project) {
            const values = await chrome.storage.local.get(null), results = [];
            for (const [key, graph] of Object.entries(values)) {
              if (!key.startsWith("maker-workflow-3:" + project + ":")) continue;
              for (const node of Object.values(graph.nodes || {})) {
                if (node.kind !== "bbox") continue;
                for (const image of graph.runs[node.id]?.items || []) {
                  const response = await fetch(origin + "/api/projects/" + project + "/canvas-media?path=" + encodeURIComponent(image.path));
                  const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
                  results.push({ path: image.path, status: response.status,
                    png: Boolean(bytes && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) });
                }
              }
            }
            return { images: results.length, readable: results.filter(item => item.status === 200 && item.png).length,
              failures: results.filter(item => item.status !== 200 || !item.png) };
          };
          const result = await worker.send("Runtime.evaluate", {
            expression: `(${inspect.toString()})(${JSON.stringify(origin)},${JSON.stringify(project)})`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "BBox media diagnostic failed.");
          console.log(JSON.stringify(result.result?.value)); return;
        }
        if (process.argv[2] === "--bbox-plan-diagnose") {
          const origin = process.argv[3], project = process.argv[4];
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") || !/^[a-f0-9]{64}$/i.test(project || ""))
            throw new Error("Provide the local Maker origin and project key.");
          const inspect = async function (origin, project) {
            const values = await chrome.storage.local.get(null);
            for (const [key, graph] of Object.entries(values)) {
              if (!key.startsWith("maker-workflow-3:" + project + ":")) continue;
              for (const node of Object.values(graph.nodes || {})) {
                if (node.kind !== "bbox") continue;
                const bbox = graph.runs[node.id]?.payload?.steps?.recognize?.images?.[0]?.workflow?.bbox;
                if (!bbox) continue;
                const result = await workflowRequest({ origin, project, operation: "plan",
                  value: { bbox, background: node.config.background, artText: node.config.artText } });
                if (result.status !== "workflow") return result;
                return { design: { width: bbox.design.width, height: bbox.design.height },
                  plans: result.value.plans.length,
                  independent: result.value.plans.filter(item => item.plan.standalone)
                    .map(item => ({ category: item.category, region: item.plan.standalone.rect })) };
              }
            }
            return { found: false };
          };
          const result = await worker.send("Runtime.evaluate", {
            expression: `(${inspect.toString()})(${JSON.stringify(origin)},${JSON.stringify(project)})`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "BBox plan diagnostic failed.");
          console.log(JSON.stringify(result.result?.value)); return;
        }
        if (process.argv[2] === "--bridge-diagnose") {
          const origin = process.argv[3], project = process.argv[4];
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") || !/^[a-f0-9]{64}$/i.test(project || ""))
            throw new Error("Provide the local Maker origin and project key.");
          const request = { operation: "health", origin, project, value: {} };
          const result = await worker.send("Runtime.evaluate", {
            expression: `workflowRequest(${JSON.stringify(request)}).then(result=>({connected:result.status==="workflow"&&result.value?.ready===true})).catch(error=>({connected:false,error:error.message}))`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Processor bridge diagnostic failed.");
          console.log(JSON.stringify(result.result?.value)); return;
        }
        if (process.argv[2] === "--connect-bridge") {
          const config = JSON.parse(require("node:fs").readFileSync(
            path.join(process.env.LOCALAPPDATA, "MakerWorkflow/extension/bridge.json"), "utf8"));
          const result = await worker.send("Runtime.evaluate", {
            expression: `chrome.storage.local.set({"maker-native-bridge":${JSON.stringify(config)}}).then(()=>({configured:true}))`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Could not configure the installed local processor.");
          console.log(JSON.stringify(result.result?.value)); return;
        }
        if (process.argv[2] === "--workflow-diagnose") {
          const result = await worker.send("Runtime.evaluate", {
            expression: `(async()=>{const result=[];for(const tab of await chrome.tabs.query({url:["http://127.0.0.1/*","http://localhost/*"]})){if(${JSON.stringify(process.argv[3] || "")} && new URL(tab.url).origin!==${JSON.stringify(process.argv[3] || "")})continue;try{for(const frame of await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>{const root=document.getElementById("mw-workflow"),shadow=root?.shadowRoot;if(!shadow)return null;return {url:location.href,version:document.documentElement.dataset.makerWorkflowVersion,busy:root.dataset.busy,notice:shadow.querySelector(".notice")?.textContent,nodes:[...shadow.querySelectorAll(".node")].map(node=>({id:node.dataset.node,title:node.querySelector(".node-title")?.textContent,status:node.querySelector(".status")?.textContent,selected:node.classList.contains("selected"),x:node.style.transform,buttons:[...node.querySelectorAll("button")].map(button=>({text:button.textContent,disabled:button.disabled,hidden:button.hidden}))}))}}})){if(frame.result)result.push(frame.result)}}catch(error){result.push({error:error.message})}}return result})()`,
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Could not read workflow diagnostics.");
          console.log(JSON.stringify(result.result?.value));
          return;
        }
        if (process.argv[2] === "--update-diagnose") {
          const result = await worker.send("Runtime.evaluate", {
            expression: "(async()=>({version:chrome.runtime.getManifest().version,extensionId:chrome.runtime.id,permissions:await chrome.permissions.getAll(),release:!!chrome.runtime.getManifest().key,native:await chrome.runtime.sendNativeMessage('cn.maker.workflow.updater',{action:'status'}).catch(error=>({error:error.message})),update:(await chrome.storage.local.get('maker-update-status'))['maker-update-status']}))()",
            awaitPromise: true, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error("Could not read updater diagnostics.");
          console.log(JSON.stringify(result.result?.value));
          return;
        }
        if (process.argv[2] === "--claim") {
          const project = process.argv[3], ids = process.argv.slice(4);
          if (!/^[a-f0-9]{64}$/i.test(project || "") || !ids.length || ids.some(id => !/^[a-f0-9-]{36}$/i.test(id)))
            throw new Error("Claim requires a project key and confirmed attempt UUIDs.");
          const key = `maker-workflow-owned:${project}`;
          const expression = `(async()=>{const key=${JSON.stringify(key)}, ids=${JSON.stringify(ids)};const data=await chrome.storage.local.get(key);const all=[...new Set([...(data[key]||[]),...ids])];await chrome.storage.local.set({[key]:all});return {claimed:ids.length,total:all.length}})()`;
          const result = await worker.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw new Error("Could not store confirmed result ownership.");
          console.log(JSON.stringify(result.result?.value));
          return;
        }
        const status = await worker.send("Runtime.evaluate", {
          expression: "chrome.storage.local.get(null).then(values => Object.entries(values).filter(([key, graph]) => key.startsWith('maker-workflow-3:') && [...Object.values(graph.runs || {}),...Object.values(graph.history || {}).flat()].some(run => run.running)).map(([key]) => key))",
          awaitPromise: true, returnByValue: true
        });
        if (status.exceptionDetails) throw new Error("Cannot confirm whether generation is running; extension reload was skipped.");
        const running = status.result?.value;
        if (!Array.isArray(running)) throw new Error("Cannot read generation state; extension reload was skipped.");
        if (running.length) {
          console.log(JSON.stringify({ deferred: true, reason: "generation_running", runningCanvases: running.length }));
          return;
        }
        await worker.send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }).catch(() => {});
      }
      finally { worker.close(); }
    } else await browser.send("Extensions.loadUnpacked", { path: extensionPath });
    for (let i = 0; i < 30; i++) {
      const installed = find(await browser.send("Extensions.getExtensions"));
      if (installed?.enabled && installed.version === expectedVersion) { console.log(JSON.stringify(installed)); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Extension reload did not complete.");
  } finally { browser.close(); }
}
module.exports = { connect };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
