(() => {
  if (location.pathname !== "/canvas") return;
  const labels = {
    checking: "检查更新中", current: "已是最新", ready: "新版已下载", waiting: "等待空闲更新",
    installing: "正在更新", installed: "已更新", error: "更新失败", offline: "更新离线",
    repair_required: "更新需修复", development: "开发目录版"
  };
  const indicator = document.createElement("button");
  indicator.type = "button"; indicator.className = "maker-update-indicator";
  let status = { status: "checking" }, panel;
  function display(value) {
    if (!value) return;
    status = value;
    indicator.textContent = `更新 · ${labels[value.status] || value.status || "未检查"}`;
    indicator.title = value.message || "";
    if (panel?.isConnected) panel.querySelector("[data-update-summary]").textContent =
      `当前版本：${value.loadedVersion || chrome.runtime.getManifest().version}\n` +
      `${labels[value.status] || value.status}\n${value.message || ""}`;
  }
  async function check() {
    display({ ...status, status: "checking", message: "正在检查更新…" });
    try { display(await chrome.runtime.sendMessage({ type: "maker-check-update" })); }
    catch (error) { display({ status: "error", message: error.message }); }
  }
  indicator.addEventListener("click", async () => {
    if (panel?.open) return;
    panel = document.createElement("dialog"); panel.className = "workflow-template-dialog";
    panel.setAttribute("aria-label", "更新状态");
    const heading = document.createElement("h2"); heading.textContent = "插件更新";
    const summary = document.createElement("p"); summary.dataset.updateSummary = ""; summary.style.whiteSpace = "pre-wrap";
    const actions = document.createElement("div"); actions.className = "template-card-actions";
    const run = document.createElement("button"); run.textContent = "立即检查"; run.onclick = () => void check();
    const download = document.createElement("a"); download.textContent = "下载安装／修复";
    download.href = "https://github.com/utlastr/Maker-plugins/releases/latest"; download.target = "_blank"; download.rel = "noopener";
    const copy = document.createElement("button"); copy.textContent = "复制诊断";
    copy.onclick = async () => {
      const detail = await chrome.runtime.sendMessage({ type: "maker-update-status" });
      await navigator.clipboard.writeText(JSON.stringify(detail, null, 2)); copy.textContent = "已复制";
    };
    const close = document.createElement("button"); close.textContent = "关闭"; close.onclick = () => panel.close();
    const hint = document.createElement("p");
    hint.textContent = "只需首次安装或修复时运行 Install.cmd。扩展应加载 %LOCALAPPDATA%\\MakerWorkflow\\extension，不能加载下载解压目录。";
    actions.append(run, download, copy, close); panel.append(heading, summary, hint, actions);
    panel.addEventListener("close", () => panel.remove()); document.body.append(panel); panel.showModal(); display(status);
  });
  (document.querySelector("header") || document.body).append(indicator);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["maker-update-status"]) display(changes["maker-update-status"].newValue);
  });
  chrome.runtime.sendMessage({ type: "maker-update-status" }).then(display).catch(() => {});
  void check();
})();
