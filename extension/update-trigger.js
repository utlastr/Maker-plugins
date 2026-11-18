(() => {
  const makerPage = location.pathname === "/canvas" ||
    location.pathname.startsWith("/ui-editor/") ||
    Boolean(document.getElementById("project-picker") && document.getElementById("maker-version-picker"));
  if (!makerPage || globalThis.__makerRefreshUpdate) return;
  globalThis.__makerRefreshUpdate = true;
  void chrome.runtime.sendMessage({ type: "maker-check-update" }).catch(() => {});
})();
