(() => {
  const $ = id => document.getElementById(id);
  const labels = { checking: "检查更新中", current: "已是最新", ready: "新版已下载",
    waiting: "等待画布空闲", installing: "正在更新", installed: "正在加载新版",
    offline: "连接更新源失败", error: "更新失败", development: "源码目录版", repair_required: "需要修复安装" };
  const display = value => {
    value ||= {};
    $("loaded").textContent = value.loadedVersion || chrome.runtime.getManifest().version;
    $("latest").textContent = value.latestVersion || value.version || "待检查";
    $("status").textContent = labels[value.status] || "尚未检查";
    $("detail").textContent = value.message || "";
    $("check").disabled = ["checking", "installing"].includes(value.status);
  };
  const check = async () => {
    display({ status: "checking", message: "正在检查签名更新包…" });
    try { display(await chrome.runtime.sendMessage({ type: "maker-check-update" })); }
    catch (error) { display({ status: "error", message: error.message }); }
  };
  $("check").onclick = check;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["maker-update-status"]) display(changes["maker-update-status"].newValue);
  });
  $("loaded").textContent = chrome.runtime.getManifest().version;
  void check();
})();
