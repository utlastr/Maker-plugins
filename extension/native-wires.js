(() => {
  if (location.pathname !== "/canvas") return;
  let scheduled = false;
  const rendered = new WeakMap();
  function update() {
    scheduled = false;
    const wires = document.getElementById("wires");
    if (!wires) return;
    for (const path of wires.querySelectorAll("path.wire")) {
      const original = path.getAttribute("d");
      if (!original || rendered.get(path) === original) continue;
      const length = path.getTotalLength();
      if (!length) continue;
      const start = path.getPointAtLength(0), end = path.getPointAtLength(length);
      const direction = end.x >= start.x ? 1 : -1;
      const reach = Math.max(36, Math.min(180, Math.hypot(end.x - start.x, end.y - start.y) * 0.4));
      const curve = `M ${start.x} ${start.y} C ${start.x + direction * reach} ${start.y}, ${end.x - direction * reach} ${end.y}, ${end.x} ${end.y}`;
      rendered.set(path, curve);
      path.setAttribute("d", curve);
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true; requestAnimationFrame(update);
  }
  function start() {
    const wires = document.getElementById("wires");
    if (!wires) return false;
    document.documentElement.dataset.makerWorkflowVersion = chrome.runtime.getManifest().version;
    document.documentElement.dataset.makerWorkflowMode = "official";
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "childList" ||
          rendered.get(record.target) !== record.target.getAttribute("d"))) schedule();
    });
    observer.observe(wires, { childList: true, subtree: true, attributes: true, attributeFilter: ["d"] });
    schedule();
    return true;
  }
  if (!start()) {
    const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
