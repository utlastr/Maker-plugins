(() => {
  if (location.pathname !== "/canvas" || globalThis.__makerWorkflowOwnership3) return;
  globalThis.__makerWorkflowOwnership3 = true;
  function registerInstance() {
    const marker = document.createElement("meta");
    marker.name = "maker-workflow-instance"; marker.content = chrome.runtime.id;
    marker.dataset.release = String(Boolean(chrome.runtime.getManifest().key));
    document.documentElement.append(marker);
  }
  if (document.documentElement) registerInstance();
  else document.addEventListener("DOMContentLoaded", registerInstance, { once: true });
  const project = new URLSearchParams(location.search).get("project");
  const ledgerKey = `maker-workflow-owned:${project}`;
  const ids = new Set();
  globalThis.MakerWorkflowOwnedAttempts = ids;
  function collect(graph) {
    for (const run of [...Object.values(graph?.runs || graph?.batches || {}),
      ...Object.values(graph?.history || {}).flat()])
      for (const item of run.items || []) if (item.attempt) ids.add(item.attempt);
  }
  function publish() {
    document.dispatchEvent(new CustomEvent("mw3:ownership", { detail: JSON.stringify([...ids]) }));
  }
  function persist() { void chrome.storage.local.set({ [ledgerKey]: [...ids] }).catch(() => {}); }
  const relevant = key => [1, 2, 3].some(version => key.startsWith(`maker-workflow-${version}:${project}:`));
  chrome.storage.local.get(null).then(values => {
    for (const id of values[ledgerKey] || []) ids.add(id);
    for (const [key, graph] of Object.entries(values)) if (relevant(key)) collect(graph);
    publish(); persist();
  }).catch(publish);
  document.addEventListener("mw3:attempt-owned", event => {
    const { id } = JSON.parse(event.detail);
    if (!id || ids.has(id)) return;
    ids.add(id); publish(); persist();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const before = ids.size;
    for (const [key, value] of Object.entries(changes)) {
      if (relevant(key)) collect(value.newValue);
      if (key === ledgerKey) for (const id of value.newValue || []) ids.add(id);
    }
    publish();
    if (ids.size !== before || (changes[ledgerKey] && ids.size > (changes[ledgerKey].newValue || []).length)) persist();
  });
})();
