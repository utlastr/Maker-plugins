async function installIntoOpenPages(force = false) {
  const tabs = await chrome.tabs.query({ url: ["http://127.0.0.1/*", "http://localhost/*"] });
  await Promise.allSettled(tabs.map(async tab => {
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true }, world: "MAIN",
        func: () => {
          if (location.pathname !== "/canvas") return null;
          return {
            project: new URLSearchParams(location.search).get("project"),
            canvas: document.getElementById("canvases")?.value,
            version: document.documentElement.dataset.makerWorkflowVersion,
            customBusy: [...document.querySelectorAll("#mw-workflow")].some(root => root.dataset.busy === "true") ? "true" :
              document.getElementById("mw-workflow")?.dataset.busy,
            saved: window.makerCanvasUnsaved !== true,
            busy: window.makerCanvasSequenceRunning === true || window.makerCanvasPendingImport === true
          };
        }
      });
      for (const frame of frames) {
        const info = frame.result;
        if (!info || !info.version || (info.version === chrome.runtime.getManifest().version && force !== true)) continue;
        const keys = [1, 2, 3].map(version => `maker-workflow-${version}:${info.project}:${info.canvas}`);
        const stored = await chrome.storage.local.get(keys);
        const running = info.customBusy === "true" || (info.customBusy !== "false" && Object.values(stored).some(graph =>
          [...Object.values(graph.runs || graph.batches || {}), ...Object.values(graph.history || {}).flat()].some(run => run.running)));
        if (info.saved && !info.busy && !running) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frame.frameId] },
            func: () => location.reload()
          }).catch(() => {});
        } else {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frame.frameId] },
            func: () => {
              if (document.getElementById("mw-upgrade")) return;
              const banner = document.createElement("div");
              banner.id = "mw-upgrade";
              banner.textContent = "节点插件已更新，请保存当前工作并在任务结束后刷新画布。";
              Object.assign(banner.style, {
                position: "fixed", bottom: "12px", left: "12px", zIndex: "10000",
                padding: "8px 12px", background: "#20272b", color: "#edf0ed",
                border: "1px solid #475158", borderRadius: "4px", font: "12px sans-serif"
              });
              document.body.append(banner);
            }
          }).catch(() => {});
        }
      }
    } catch {
      // Inaccessible or closing frames keep their current document until the user reloads.
    }
  }));
}
chrome.runtime.onInstalled.addListener(installIntoOpenPages);

let checkingUpdate = false;
async function updateStatus(value) {
  const status = { ...value, checkedAt: Date.now(), loadedVersion: chrome.runtime.getManifest().version };
  await chrome.storage.local.set({ "maker-update-status": status });
  return status;
}
async function retryUpdate(status, message, version) {
  await chrome.alarms.create("maker-update-retry", { delayInMinutes: status === "waiting" ? 1 : 5 });
  return updateStatus({ status, message, ...(version ? { version } : {}) });
}
async function installationMarker() {
  const response = await fetch(chrome.runtime.getURL("installation.json"), { cache: "no-store" });
  if (!response.ok) return null;
  const value = await response.json();
  return value.extensionId === chrome.runtime.id && value.installId ? value : null;
}
async function canvasesBusy() {
  const stored = await chrome.storage.local.get(["maker-console-origins"]);
  const origins = stored["maker-console-origins"] || [];
  if (!origins.length) return false;
  const data = await chrome.storage.local.get(null);
  const tabs = await chrome.tabs.query({ url: ["http://127.0.0.1/*", "http://localhost/*"] });
  for (const tab of tabs.filter(tab => origins.includes(new URL(tab.url).origin))) {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, world: "MAIN",
      func: () => location.pathname !== "/canvas" ? null : ({
        project: new URLSearchParams(location.search).get("project"),
        canvas: document.getElementById("canvases")?.value,
        saved: window.makerCanvasUnsaved !== true,
        nativeBusy: Boolean(window.makerCanvasSequenceRunning || window.makerCanvasPendingImport),
        customBusy: document.getElementById("mw-workflow")?.dataset.busy
      })
    }).catch(() => [{ result: { saved: false } }]);
    for (const frame of frames) {
      const info = frame.result;
      if (!info) continue;
      if (!info.saved || info.nativeBusy || info.customBusy === "true") return true;
      if (info.customBusy !== "false" && info.project && info.canvas) {
        const graph = data[`maker-workflow-3:${info.project}:${info.canvas}`];
        if ([...Object.values(graph?.runs || {}), ...Object.values(graph?.history || {}).flat()].some(run => run.running)) return true;
      }
    }
  }
  return false;
}
async function checkUpdate() {
  if (!chrome.runtime.getManifest().key) {
    return updateStatus({ status: "development", message: "当前是源码目录版，不会自动覆盖源码。自动更新请加载安装器指定的 extension 目录。" });
  }
  if (checkingUpdate) return;
  checkingUpdate = true;
  try {
    await updateStatus({ status: "checking", message: "正在检查更新…" });
    let marker = await installationMarker().catch(() => null);
    if (!marker) {
      await chrome.runtime.sendNativeMessage("cn.maker.workflow.updater", {
        action: "bootstrap", extensionId: chrome.runtime.id
      });
      marker = await installationMarker().catch(() => null);
    }
    if (!marker) return updateStatus({
      status: "repair_required",
      message: "加载目录不正确。请运行 Install.cmd，并从 %LOCALAPPDATA%\\MakerWorkflow\\extension 加载扩展。"
    });
    const identity = { extensionId: chrome.runtime.id, installId: marker.installId };
    const result = await chrome.runtime.sendNativeMessage("cn.maker.workflow.updater", {
      action: "check", version: chrome.runtime.getManifest().version, ...identity
    });
    if (result.status === "error") return retryUpdate("error", result.message || "更新器出错，五分钟后重试。");
    if (result.status === "current") {
      await chrome.alarms.clear("maker-update-retry");
      return updateStatus({ status: "current", message: "已是最新版本。", version: result.version });
    }
    if (result.status !== "ready") return retryUpdate("error", "更新器返回了无法确认的状态。");
    if (await canvasesBusy()) return retryUpdate("waiting", "新版已下载，等待当前任务结束和画布保存。", result.version);
    await updateStatus({ status: "installing", message: "正在安装更新…", version: result.version });
    const applied = await chrome.runtime.sendNativeMessage("cn.maker.workflow.updater", {
      action: "apply", version: result.version, ...identity
    });
    if (applied.status === "installed") {
      await updateStatus({ status: "installed", message: "更新已安装，正在重新加载。", version: applied.version });
      chrome.runtime.reload();
    } else return retryUpdate("error", applied.message || "更新安装未完成，五分钟后重试。");
  } catch (error) {
    const missing = /not found|not registered|forbidden|Access to.*native messaging|exited/i.test(error.message);
    return retryUpdate(missing ? "repair_required" : "offline", missing ?
      "本地更新器未连接。请解压最新版并运行一次 Install.cmd，随后加载固定安装目录。" :
      "更新检查失败：" + error.message + "；五分钟后自动重试。");
  } finally { checkingUpdate = false; }
}
chrome.runtime.onStartup.addListener(checkUpdate);
chrome.runtime.onInstalled.addListener(checkUpdate);
async function workflowRequest(request) {
  let bridge;
  try {
    const response = await fetch(chrome.runtime.getURL("bridge.json"), { cache: "no-store" });
    if (response.ok) bridge = await response.json();
  } catch {}
  if (!bridge) bridge = (await chrome.storage.local.get("maker-native-bridge"))["maker-native-bridge"];
  if (bridge && /^http:\/\/127\.0\.0\.1:\d+$/.test(bridge.endpoint) && bridge.token) {
    const response = await fetch(bridge.endpoint + "/workflow", {
      method: "POST", headers: { Authorization: "Bearer " + bridge.token, "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "本地处理器执行失败。");
    return result;
  }
  return chrome.runtime.sendNativeMessage("cn.maker.workflow.updater", { action: "workflow", request });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "maker-update-status") {
    chrome.storage.local.get("maker-update-status").then(value => reply({
      ...value["maker-update-status"], loadedVersion: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id, release: Boolean(chrome.runtime.getManifest().key)
    }));
    return true;
  }
  if (message?.type === "maker-workflow-native") {
    if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/canvas(?:\?|$)/.test(sender.url || "")) {
      reply({ error: "工作流仅允许从 Maker 画布调用。" }); return;
    }
    workflowRequest(message.request).then(value => reply(value), error => reply({ error: error.message }));
    return true;
  }
  if (message?.type !== "maker-check-update") return;
  void (async () => {
    if (/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/canvas(?:\?|$)/.test(sender.url || "")) {
      const values = await chrome.storage.local.get("maker-console-origins");
      await chrome.storage.local.set({ "maker-console-origins": [...new Set([
        ...(values["maker-console-origins"] || []), new URL(sender.url).origin
      ])].slice(-20) });
    }
    await checkUpdate();
    reply((await chrome.storage.local.get("maker-update-status"))["maker-update-status"] || { status: "checking" });
  })();
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (["maker-update-retry", "maker-update-periodic"].includes(alarm.name)) void checkUpdate(); });
if (chrome.runtime.getManifest().key) void chrome.alarms.create("maker-update-periodic", { periodInMinutes: 15 });
void checkUpdate();
void installIntoOpenPages();
