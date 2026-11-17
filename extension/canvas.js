(() => {
  if (location.pathname !== "/canvas" || globalThis.__makerWorkflowCanvas3) return;
  const project = new URLSearchParams(location.search).get("project");
  if (!/^[a-f0-9]{64}$/i.test(project || "")) return;
  const G = MakerWorkflow, P = MakerPipeline, calls = new Map();
  let serial = 0;
  function rpc(action, value, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = `v3-${chrome.runtime.id}-${++serial}`;
      const timer = setTimeout(() => { calls.delete(id); reject(new Error("官方接口未响应；未重复提交。")); }, timeout);
      calls.set(id, { resolve, reject, timer });
      document.dispatchEvent(new CustomEvent("mw3:request", { detail: JSON.stringify({ id, action, value }) }));
    });
  }
  document.addEventListener("mw3:reply", event => {
    const value = JSON.parse(event.detail), call = calls.get(value.id);
    if (!call) return;
    clearTimeout(call.timer); calls.delete(value.id);
    if (value.error) call.reject(Object.assign(new Error(value.error), { notSubmitted: value.notSubmitted }));
    else call.resolve(value.value);
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function boot() {
    if (globalThis.__makerWorkflowCanvas3) return true;
    const instances = [...document.querySelectorAll('meta[name="maker-workflow-instance"]')]
      .sort((a, b) => Number(b.dataset.release === "true") - Number(a.dataset.release === "true") || a.content.localeCompare(b.content));
    if (instances.length && instances[0].content !== chrome.runtime.id) return true;
    if (document.getElementById("mw-workflow")) return true;
    const board = document.getElementById("board"), nativeWorld = document.getElementById("world");
    if (!board || !nativeWorld) return false;
    globalThis.__makerWorkflowCanvas3 = true;
    const root = document.createElement("div");
    root.id = "mw-workflow"; root.tabIndex = -1;
    const shadow = root.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet"; stylesheet.href = chrome.runtime.getURL("canvas.css");
    const viewport = document.createElement("div"); viewport.className = "viewport";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("wires");
    const nodes = document.createElement("div"); nodes.className = "nodes";
    viewport.append(svg, nodes);
    const menu = document.createElement("div"); menu.className = "menu"; menu.hidden = true;
    const notice = document.createElement("div"); notice.className = "notice"; notice.hidden = true;
    shadow.append(stylesheet, viewport, menu, notice); document.body.append(root);
    const legacyStyle = document.createElement("style");
    legacyStyle.id = "mw-legacy-hidden"; document.head.append(legacyStyle);
    const views = new Map(), selected = new Set(), selectedEdges = new Set(), catalog = new Map(), resultDialogs = new Map();
    const marquee = document.createElement("div"); marquee.className = "marquee"; marquee.hidden = true; shadow.append(marquee);
    let state, epoch = 0, loadingId = "", gesture, pendingOutput, selectedEdge, frame, wireSequence = 0;
    const runs = new Map(), processing = new Map(), feedback = new Map();
    let menuPoint, undoing = false, editSnapshot = null, selectedPort = null, lastPoint, clipboardBusy = false;
    const clipboardMarker = "MAKER-WORKFLOW-CARDS\n";
    const states = new Map();
    const key = id => `maker-workflow-3:${project}:${id}`;
    const media = path => `/api/projects/${project}/canvas-media?path=${encodeURIComponent(path)}`;
    const scene = target => structuredClone({ nodes: target.graph.nodes, edges: target.graph.edges });
    function beginEdit() { editSnapshot = { target: state, value: scene(state) }; }
    function button(text, title, action) {
      const element = document.createElement("button");
      element.type = "button"; element.textContent = text; element.title = title;
      element.setAttribute("aria-label", title);
      element.addEventListener("click", event => {
        event.stopPropagation();
        const target = state, id = event.target.closest(".node")?.dataset.node;
        try { Promise.resolve(action(event)).catch(error => reportFailure(target, id, error)); }
        catch (error) { reportFailure(target, id, error); }
      });
      return element;
    }
    function say(text) {
      if (!text) { if (notice.getAttribute("role") !== "alert") notice.hidden = true; return; }
      notice.textContent = text; notice.hidden = false; notice.setAttribute("role", "status");
      const id = [...selected][0];
      if (state && id) setFeedback(state, id, text);
    }
    function reportFailure(target, id, error) {
      const reason = error?.message || String(error || "操作未完成。");
      const title = target?.graph.nodes[id] ? G.TYPES[target.graph.nodes[id].kind]?.title : "";
      if (target && id) setFeedback(target, id, reason);
      notice.textContent = `${title ? title + "：" : ""}${reason}`;
      notice.hidden = false; notice.setAttribute("role", "alert");
      notice.append(button("×", "关闭提示", () => { notice.hidden = true; notice.removeAttribute("role"); }));
    }
    const runKey = (target, id) => `${target.id}:${id}`;
    function setFeedback(target, id, text) {
      feedback.set(runKey(target, id), text);
      if (state === target) {
        const view = views.get(id);
        if (view?.feedback) { view.feedback.textContent = text; view.feedback.hidden = !text; }
      }
    }
    const nodeRuns = (target, id) => [...runs.values()].filter(token => token.state === target && token.node === id);
    function runNode(target, id, action, operation = "", initialRecord) {
      const key = runKey(target, id) + (operation ? ":" + operation : ""), existing = runs.get(key);
      if (existing) return existing.promise;
      const token = { state: target, node: id, key, stop: false, selection: [...selected],
        record: initialRecord || { running: true, items: [] }, stages: new Set(), nodeIds: new Set([id]) };
      token.canceled = new Promise(resolve => { token.release = () => resolve({ status: "canceled" }); });
      runs.set(key, token); setFeedback(target, id, "正在准备运行…");
      token.promise = Promise.resolve().then(() => action(token)).catch(error => {
        if (!token.stop) {
          token.record.error = error.message;
          reportFailure(target, id, error);
        }
      }).finally(() => {
        for (const record of new Set([token.record, ...token.stages])) {
          record.running = false;
          if (record.batchId) record.finishedAt = Date.now();
          for (const item of record.items || []) if (item.state === "queued") item.state = token.stop ? "canceled" : "not-submitted";
        }
        if (runs.get(key) === token) runs.delete(key);
        if (!nodeRuns(target, id).length && feedback.get(runKey(target, id)) === "正在准备运行…") setFeedback(target, id, "");
        persist(target); if (state === target) render();
      });
      if (state === target) render();
      return token.promise;
    }
    function sayFatal(text) {
      if (/signature rejected|checksum rejected|identity mismatch|Unsafe archive|Media escapes project/i.test(text)) {
        notice.textContent = text; notice.hidden = false;
        return true;
      }
      return false;
    }
    async function waitFor(token, promise) {
      const value = await Promise.race([promise, token.canceled]);
      if (token.stop) throw new Error("已取消");
      return value;
    }
    async function processNode(target, id, token, action) {
      const key = runKey(target, id);
      while (processing.has(key)) {
        const current = processing.get(key);
        if (current.token === token) return;
        await waitFor(token, current.promise.catch(() => {}));
      }
      if (token.stop || !target.graph.nodes[id]) return;
      token.nodeIds.add(id);
      const entry = { token };
      entry.promise = Promise.resolve().then(action);
      processing.set(key, entry);
      try { return await entry.promise; }
      finally { if (processing.get(key) === entry) processing.delete(key); }
    }
    function camera() {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(nativeWorld).transform);
      return { x: matrix.m41, y: matrix.m42, scale: matrix.a || 1 };
    }
    function point(x, y) {
      const rect = board.getBoundingClientRect(), view = camera();
      return { x: (x - rect.left - view.x) / view.scale, y: (y - rect.top - view.y) / view.scale };
    }
    function align() {
      const rect = board.getBoundingClientRect();
      Object.assign(root.style, { left: rect.x + "px", top: rect.y + "px", width: rect.width + "px", height: rect.height + "px" });
      viewport.style.transform = getComputedStyle(nativeWorld).transform;
    }
    function persist(target = state) {
      if (!target) return;
      clearTimeout(target.timer);
      target.timer = setTimeout(() => {
        const value = structuredClone(target.graph);
        target.writes = target.writes.then(() => chrome.storage.local.set({ [key(target.id)]: value }))
          .catch(error => say("保存卡片失败：" + error.message));
      }, 100);
    }
    function checkpoint() {
      if (!state || undoing) return;
      state.past.push(scene(state));
      if (state.past.length > 50) state.past.shift();
      state.future = [];
    }
    function history(redo) {
      if (!state) return;
      const from = redo ? state.future : state.past, to = redo ? state.past : state.future;
      if (!from.length) return;
      to.push(scene(state)); undoing = true;
      Object.assign(state.graph, from.pop()); undoing = false; selected.clear(); selectedEdge = null;
      for (const token of [...runs.values()]) if (token.state === state &&
          [...token.nodeIds].some(id => !state.graph.nodes[id])) cancelRun(token.node, state, token);
      persist(); render();
    }
    async function context() {
      const id = document.getElementById("canvases")?.value;
      if (!id || state?.id === id || loadingId === id) return;
      const ticket = ++epoch;
      loadingId = id;
      try {
        let next = states.get(id);
        if (!next) {
          const old2 = `maker-workflow-2:${project}:${id}`, old1 = `maker-workflow-1:${project}:${id}`;
          const stored = await chrome.storage.local.get([key(id), old2, old1]);
          const graph = stored[key(id)] ? G.restore(stored[key(id)]) :
            stored[old2] || stored[old1] ? G.migrate(stored[old2] || stored[old1], await rpc("snapshot", { canvas: id })) : G.empty();
          next = { id, graph, past: [], future: [], timer: null, writes: Promise.resolve() };
          const allRuns = Object.entries(graph.runs).flatMap(([nodeId, run]) =>
            graph.nodes[nodeId]?.kind === "generate" ? G.batches(graph, nodeId).map(batch => [nodeId, batch]) : [[nodeId, run]]);
          const attempts = allRuns.flatMap(([, run]) => run.items.map(item => item.attempt)).filter(Boolean);
          try {
            const recovered = await rpc("reconcile", { canvas: id, attempts });
            const records = new Map(recovered.records.map(record => [record.id, record]));
            for (const [nodeId, run] of allRuns) for (const item of run.items) {
              if (graph.nodes[nodeId]?.kind === "cutout") continue;
              const record = records.get(item.attempt);
              if (record && item.state !== "canceled") {
                item.path = record.resultAssetPath || record.deliveredAssetPath;
                item.state = record.status;
                item.error = record.error;
              }
            }
            next.hiddenIds = recovered.hiddenIds;
          } catch (error) { say("已有图片记录恢复失败：" + error.message); }
          try { await repairMedia(next); }
          catch (error) { reportFailure(next, null, new Error("预排素材迁移未完成：" + error.message)); }
          states.set(id, next);
        }
        if (ticket !== epoch) return;
        for (const view of views.values()) view.element.remove();
        views.clear(); svg.replaceChildren(); wireSequence++;
        state = next; selected.clear(); selectedEdge = null; pendingOutput = null;
        for (const node of Object.values(state.graph.nodes))
          if (node.kind === "generate" && state.graph.runs[node.id]?.items.some(item => item.path))
            ensureDisplay(state, node.id);
        legacyStyle.textContent = [...new Set([...state.graph.legacyIds, ...(state.hiddenIds || [])])].filter(value => /^[a-f0-9-]{36}$/i.test(value))
          .map(value => `#world > .card[data-id="${value}"]{display:none!important}`).join("\n");
        for (const node of Object.values(state.graph.nodes)) if (node.kind === "cutout") {
          node.width = 250; node.height = 86;
        }
        document.documentElement.dataset.makerWorkflowVersion = chrome.runtime.getManifest().version;
        say(""); persist(); render();
        const loaded = state;
        queueMicrotask(async () => {
          for (const node of Object.values(loaded.graph.nodes)) {
            if (state !== loaded) return;
            if (node.kind === "cutout" && G.output(loaded.graph, node.id).length)
              await cutoutRun(node.id);
          }
        });
      } catch (error) { say(error.message); }
      finally { if (ticket === epoch) loadingId = ""; }
    }
    function position(view, node) {
      view.element.style.transform = `translate(${node.x}px,${node.y}px)`;
      view.element.style.width = node.width + "px"; view.element.style.height = node.height + "px";
    }
    function select(id, edge = false) {
      selectedEdges.clear();
      selectedPort = null;
      for (const port of shadow.querySelectorAll(".port.selected")) port.classList.remove("selected");
      selected.clear(); selectedEdge = edge ? id : null;
      if (!edge && id) selected.add(id);
      for (const [nodeId, view] of views) view.element.classList.toggle("selected", selected.has(nodeId));
      for (const path of svg.querySelectorAll("path")) path.classList.toggle("selected", path.dataset.edge === selectedEdge);
    }
    function selectPort(id, side) {
      select(null); selectedPort = { id, side };
      views.get(id)?.element.querySelector(`.port.${side}`)?.classList.add("selected");
      drawWires();
    }
    function disconnectSelected() {
      if (!state || (!selectedEdge && !selectedPort)) return false;
      const matches = edge => edge.id === selectedEdge || (selectedPort &&
        (selectedPort.side === "input" ? edge.to : edge.from) === selectedPort.id);
      if (!state.graph.edges.some(matches)) return false;
      checkpoint(); state.graph.edges = state.graph.edges.filter(edge => !matches(edge));
      pendingOutput = null; select(null); menu.hidden = true; persist(); render(); return true;
    }
    function deleteSelection(id) {
      if (!state) return;
      if (!id && selectedPort) { disconnectSelected(); return; }
      const ids = id ? [id] : [...selected];
      if (!selectedEdge && !selectedEdges.size && !ids.length) return;
      for (const token of [...runs.values()]) if (token.state === state &&
          ids.some(id => token.nodeIds.has(id))) cancelRun(token.node, state, token);
      checkpoint();
      state.graph.edges = state.graph.edges.filter(edge => edge.id !== selectedEdge && !selectedEdges.has(edge.id));
      for (const value of ids) G.remove(state.graph, value);
      selected.clear(); selectedEdges.clear(); selectedEdge = null; persist(); render();
    }
    function duplicate(id) {
      if (!state?.graph.nodes[id]) return;
      checkpoint();
      const original = state.graph.nodes[id], copy = structuredClone(original), newId = crypto.randomUUID();
      copy.id = newId; copy.x += 28; copy.y += 28; state.graph.nodes[newId] = copy;
      persist(); render(); select(newId);
    }
    function create(kind, location) {
      if (!state) { say("当前画布尚未加载，请稍后再创建。"); return; }
      checkpoint();
      const rect = board.getBoundingClientRect();
      const at = location || menuPoint || point(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const id = crypto.randomUUID();
      G.add(state.graph, id, kind, at);
      menu.hidden = true; persist(); render(); select(id); root.focus({ preventScroll: true });
      return id;
    }
    function ensureDisplay(target, sourceId) {
      const graph = target.graph, source = graph.nodes[sourceId];
      if (!source) return;
      const processors = graph.edges.filter(edge => edge.from === sourceId && ["cutout", "slice"].includes(graph.nodes[edge.to]?.kind));
      if (processors.length) {
        const bypasses = graph.edges.filter(edge => edge.from === sourceId && graph.nodes[edge.to]?.kind === "display" &&
          graph.nodes[edge.to].config.automatic);
        for (const edge of bypasses) {
          graph.edges = graph.edges.filter(value => value.id !== edge.id);
          G.connect(graph, processors[0].to, edge.to, crypto.randomUUID());
        }
        const displays = processors.map(edge => ensureDisplay(target, edge.to));
        persist(target);
        return displays.find(Boolean);
      }
      const connected = graph.edges.filter(edge => edge.from === sourceId && graph.nodes[edge.to]?.kind === "display");
      if (connected.length) {
        persist(target); return connected[0].to;
      }
      const id = crypto.randomUUID();
      target.past.push(scene(target)); target.future = [];
      if (target.past.length > 50) target.past.shift();
      G.add(graph, id, "display", { x: source.x + source.width + 64, y: source.y });
      graph.nodes[id].config.automatic = true;
      G.connect(graph, sourceId, id, crypto.randomUUID());
      persist(target);
      return id;
    }
    function showResults(sourceId) {
      if (!state) return;
      if (state.graph.nodes[sourceId]?.kind === "generate") { showGenerationHistory(sourceId); return; }
      const id = ensureDisplay(state, sourceId);
      if (!id) return;
      render(); select(id);
      const dialog = document.createElement("dialog"); dialog.className = "preview results-preview";
      const actions = document.createElement("div"); actions.className = "actions";
      actions.append(button("×", "关闭结果", () => dialog.close()));
      dialog.append(actions);
      const gallery = { gallerySignature: "", displayNodeId: id };
      setupResultGallery(gallery, dialog);
      renderImages(gallery, G.output(state.graph, id), false);
      galleryStatus(gallery, state.graph, id);
      resultDialogs.set(dialog, { state, id, view: gallery });
      dialog.addEventListener("close", () => { resultDialogs.delete(dialog); dialog.remove(); });
      openDialog(dialog);
    }
    function showGenerationHistory(id) {
      const target = state, list = G.batches(target.graph, id);
      const dialog = document.createElement("dialog"); dialog.className = "preview results-preview history-preview";
      const actions = document.createElement("div"); actions.className = "actions";
      const title = document.createElement("strong"); title.textContent = "生成历史";
      actions.append(title, button("×", "关闭生成历史", () => dialog.close()));
      const layout = document.createElement("div"); layout.className = "history-layout";
      const folders = document.createElement("div"); folders.className = "history-folders";
      const content = document.createElement("div"); content.className = "history-content";
      const heading = document.createElement("p"); heading.className = "status";
      const tools = document.createElement("div"); tools.className = "actions";
      const gallery = { gallerySignature: "", displayNodeId: id, history: true };
      const entry = { state: target, id, view: gallery, history: true, folders, heading, follow: true,
        batchId: [...list].reverse().find(batch => G.batchImages(batch).length)?.batchId || list.at(-1)?.batchId };
      tools.append(button("刷新结果", "更新这一批图片的生成状态，不重新生图", () => {
        const batch = G.batches(target.graph, id).find(value => value.batchId === entry.batchId);
        if (batch) return runNode(target, id, token => queryRun(id, true, token, batch), "refresh-" + batch.batchId);
      }), button("取消这一批", "取消这一批尚未完成的任务", () => {
        const token = nodeRuns(target, id).find(value => value.record.batchId === entry.batchId);
        if (token) cancelRun(id, target, token);
        else say("这一批当前没有正在生成的图片。");
      }));
      content.append(heading, tools); setupResultGallery(gallery, content);
      layout.append(folders, content); dialog.append(actions, layout);
      resultDialogs.set(dialog, entry);
      dialog.addEventListener("close", () => { resultDialogs.delete(dialog); dialog.remove(); });
      openDialog(dialog); renderHistory(entry); persist(target);
    }
    function renderHistory(entry) {
      const list = G.batches(entry.state.graph, entry.id);
      if (entry.follow) {
        const latest = [...list].reverse().find(batch => G.batchImages(batch).length) || list.at(-1);
        if (latest) entry.batchId = latest.batchId;
      }
      const current = list.find(batch => batch.batchId === entry.batchId) || list.at(-1);
      const signature = JSON.stringify(list.map(batch => [batch.batchId, batch.running, batch.canceled,
        G.batchImages(batch).length, batch.items.length, batch.error, batch.batchId === current?.batchId]));
      if (entry.folderSignature !== signature) {
        entry.folderSignature = signature; entry.folders.replaceChildren();
        for (const batch of [...list].reverse()) {
          const folder = button("", `查看第 ${batch.sequence} 次生成`, () => {
            entry.follow = false; entry.batchId = batch.batchId;
            entry.view.page = 0; entry.view.holdUntil = Date.now() + 8000; entry.view.chosen.clear();
            renderHistory(entry);
          });
          folder.className = "history-folder"; folder.setAttribute("aria-pressed", String(batch === current));
          const name = document.createElement("strong"); name.textContent = `第 ${batch.sequence} 次生成`;
          const detail = document.createElement("small");
          detail.textContent = `${new Date(batch.createdAt).toLocaleString()} · ${G.batchImages(batch).length} 张${batch.running ? " · 生成中" : batch.canceled ? " · 已取消" : ""}`;
          folder.append(name, detail); entry.folders.append(folder);
        }
      }
      const images = G.batchImages(current), failed = current?.items.find(item => item.error);
      entry.heading.textContent = current ? `第 ${current.sequence} 次生成 · ${images.length} 张${current.running ? " · 生成中" : ""}${current.canceled ? " · 已取消" : ""}` +
        (current.error || failed?.error ? " · " + (current.error || failed.error) : !images.length && !current.running ? " · 本批尚无成功图片" : "") : "还没有生成记录。";
      renderImages(entry.view, images, false);
    }
    function showMenu(x, y, nodeId) {
      if (!state) { say("当前画布尚未加载，请稍后再右键。"); return; }
      shadow.append(menu);
      const rect = board.getBoundingClientRect();
      menuPoint = point(x, y); menu.replaceChildren();
      if (nodeId) {
        menu.append(button("复制卡片", "复制卡片", () => { menu.hidden = true; duplicate(nodeId); }),
          button("删除卡片", "删除卡片", () => { menu.hidden = true; deleteSelection(nodeId); }));
      } else {
        const entry = button("新建图片卡片  ›", "选择卡片类型", () => { submenu.hidden = false; });
        const submenu = document.createElement("div"); submenu.className = "submenu"; submenu.hidden = true;
        for (const kind of P.basic) submenu.append(button(G.TYPES[kind].title, G.TYPES[kind].title, () => create(kind)));
        const bboxEntry = document.createElement("div"); bboxEntry.className = "bbox-menu-entry";
        bboxEntry.append(button("BBox 相关  ›", "展开 BBox 组件", () => bboxEntry.classList.toggle("expanded")));
        const nested = document.createElement("div"); nested.className = "bbox-submenu";
        for (const kind of P.bbox) nested.append(button(G.TYPES[kind].title, G.TYPES[kind].title, () => create(kind)));
        bboxEntry.append(nested); submenu.append(bboxEntry);
        entry.addEventListener("pointerenter", () => { submenu.hidden = false; });
        menu.append(entry, submenu);
      }
      menu.hidden = false;
      const left = Math.max(8, Math.min(x - rect.left, rect.width - 190));
      menu.style.left = left + "px";
      menu.style.top = Math.max(8, Math.min(y - rect.top, rect.height - menu.offsetHeight - 8)) + "px";
      menu.classList.toggle("flip", left + 560 > rect.width);
    }
    function connect(from, to) {
      if (!state) return;
      try {
        const previous = scene(state), count = state.graph.edges.length;
        const connected = G.connect(state.graph, from, to, crypto.randomUUID());
        if (connected === false) {
          say("连接未建立：端口数据类型不匹配，或这条连接会形成循环。");
          pendingOutput = null; return;
        }
        if (state.graph.edges.length !== count) {
          state.past.push(previous); state.future = [];
          if (state.past.length > 50) state.past.shift();
        }
        if (state.graph.nodes[to]?.kind === "cutout") {
          ensureDisplay(state, from);
          if (G.output(state.graph, to).length) {
            queueMicrotask(() => { if (state?.graph.nodes[to]) void cutoutRun(to); });
          }
        }
        say(""); persist(); render();
      }
      catch (error) { say(error.message); }
      pendingOutput = null;
    }
    function connections(id, x, y) {
      shadow.append(menu);
      const rect = board.getBoundingClientRect();
      menu.replaceChildren();
      const edges = G.incoming(state.graph, id);
      if (!edges.length) {
        const label = document.createElement("span"); label.textContent = "无连接"; menu.append(label);
      }
      for (const edge of edges) {
        const row = document.createElement("div"); row.className = "connection";
        const text = document.createElement("span"); text.textContent = G.TYPES[state.graph.nodes[edge.from].kind].title;
        const change = delta => {
          const list = G.incoming(state.graph, id), index = list.indexOf(edge), other = list[index + delta];
          if (!other) return;
          checkpoint();
          const a = state.graph.edges.indexOf(edge), b = state.graph.edges.indexOf(other);
          [state.graph.edges[a], state.graph.edges[b]] = [state.graph.edges[b], state.graph.edges[a]];
          persist(); render(); menu.hidden = true;
        };
        row.append(text, button("↑", "提前", () => change(-1)), button("↓", "后移", () => change(1)),
          button("×", "断开连接", () => {
            checkpoint(); state.graph.edges = state.graph.edges.filter(value => value.id !== edge.id);
            persist(); render(); menu.hidden = true;
          }));
        menu.append(row);
      }
      menu.hidden = false;
      menu.style.left = Math.max(8, Math.min(x - rect.left, rect.width - 270)) + "px";
      menu.style.top = Math.max(8, Math.min(y - rect.top, rect.height - menu.offsetHeight - 8)) + "px";
    }
    function createView(node) {
      const type = G.TYPES[node.kind], element = document.createElement("article");
      element.className = "node"; element.dataset.node = node.id;
      const header = document.createElement("div"); header.className = "node-header";
      const title = document.createElement("strong"); title.className = "node-title"; title.textContent = type.title;
      header.append(title, button("×", "关闭卡片", () => deleteSelection(node.id)));
      const body = document.createElement("div"); body.className = "node-body";
      const handle = button("", "调整卡片大小", () => {}); handle.className = "resize-handle";
      element.append(header, body, handle);
      for (const side of ["input", "output"]) {
        if (!(side === "input" ? type.accepts.length : type.output)) continue;
        const port = button("", side === "input" ? "输入口，可连接多个来源" : "输出口", event => {
          if (gesture?.moved || suppressClick) { suppressClick = false; return; }
          if (side === "output") { selectPort(node.id, side); pendingOutput = node.id; root.focus({ preventScroll: true }); }
          else if (pendingOutput) connect(pendingOutput, node.id);
          else selectPort(node.id, side);
        });
        port.className = `port ${side}`; port.dataset.port = side;
        element.append(port);
      }
      const view = { element, body, header, kind: node.kind, fields: new Map(), signature: "", gallerySignature: "" };
      if (P.types[node.kind]) {
        const actions = document.createElement("div"); actions.className = "actions";
        const process = button(node.kind === "review" ? "查看并确认素材" : "运行至此", "运行本步骤及未完成的上游步骤", () => {
          if (node.kind === "review") void reviewPipeline(node.id); else void runPipeline(node.id);
        });
        const status = document.createElement("p"); status.className = "status";
        const detail = document.createElement("div"); detail.className = "pipeline-detail";
        const stageOptions = document.createElement("div"); stageOptions.className = "pipeline-options";
        const editor = document.createElement("a"); editor.textContent = "打开 UI 编辑器"; editor.target = "_blank"; editor.rel = "noopener"; editor.hidden = true;
        const exportPackage = button("下载资源包", "下载独立素材及组装数据", () => {
          const context = state.graph.runs[node.id]?.items[0]?.workflow;
          void rpc("pipeline-export", { context }, 120000).catch(error => say(error.message));
        });
        exportPackage.hidden = true;
        actions.append(process, button("取消", "取消当前工作流", () => cancelRun(node.id, state)));
        if (["recognize", "bbox"].includes(node.kind)) actions.append(button("查看 BBox", "查看元素识别框", () => previewBbox(node.id)));
        actions.append(exportPackage); body.append(actions, status, detail, stageOptions, editor);
        const gallery = document.createElement("div"); gallery.className = "image-grid"; body.append(gallery);
        Object.assign(view, { process, status, detail, stageOptions, editor, exportPackage, gallery });
      } else if (node.kind === "refine") {
        const input = document.createElement("textarea");
        input.setAttribute("aria-label", "微调内容");
        input.addEventListener("focus", beginEdit);
        input.addEventListener("input", () => {
          const current = state?.graph.nodes[node.id];
          if (current) {
            current.config.text = input.value;
            apply.disabled = !input.value.trim() || !G.refinementState(state.graph, node.id).ready;
            persist();
          }
        });
        input.addEventListener("blur", finishEdit);
        const apply = button("生成", "微调整批图片", () => {
          const status = G.refinementState(state.graph, node.id);
          if (status.ready && state.graph.nodes[node.id].config.text.trim()) return run(status.generator);
        });
        const retry = button("重试 AI 理解", "使用原请求恢复本批微调", () => {
          const status = G.refinementState(state.graph, node.id);
          if (status.generator) return run(status.generator, state, true);
        });
        const status = document.createElement("p"); status.className = "status";
        body.append(input, status, apply, retry);
        Object.assign(view, { text: input, apply, retry, status });
      } else if (node.kind === "prefix") {
        const input = document.createElement("textarea");
        input.setAttribute("aria-label", type.title);
        input.addEventListener("focus", beginEdit);
        input.addEventListener("input", () => {
          const current = state?.graph.nodes[node.id];
          if (current) { current.config.text = input.value; persist(); }
        });
        input.addEventListener("blur", () => finishEdit());
        body.append(input); view.text = input;
      } else if (node.kind === "tasks") {
        const list = document.createElement("div"); list.className = "task-list";
        body.append(list, button("+", "新增任务", () => {
          checkpoint();
          const current = state.graph.nodes[node.id];
          current.config.text = (current.config.text || "") + "\n";
          persist(); renderTaskRows(view, current);
          list.lastElementChild?.querySelector("textarea")?.focus();
        }));
        view.taskList = list;
        renderTaskRows(view, node);
      } else if (node.kind === "reference") {
        body.append(button("导入图片", "导入参考图片", () => upload(node.id)));
        const gallery = document.createElement("div"); gallery.className = "image-grid"; body.append(gallery); view.gallery = gallery;
      } else if (node.kind === "generate") {
        const fields = document.createElement("div"); fields.className = "fields";
        for (const [key, text, tag] of [
          ["prompt", "本地描述", "textarea"], ["model", "模型", "select"],
          ["resolution", "分辨率", "select"], ["aspectRatio", "比例", "select"]
        ]) {
          const label = document.createElement("label"); label.textContent = text;
          const input = document.createElement(tag); input.setAttribute("aria-label", type.title + "：" + text);
          input.addEventListener("focus", beginEdit);
          input.addEventListener(tag === "textarea" ? "input" : "change", () => {
            const current = state?.graph.nodes[node.id];
            if (current) { current.config[key] = input.value; persist(); }
          });
          input.addEventListener("blur", finishEdit);
          label.append(input); fields.append(label); view.fields.set(key, input);
        }
        const refs = document.createElement("div"); refs.className = "local-refs";
        refs.append(button("本地参考图", "导入本地参考图", () => upload(node.id)));
        const referenceGallery = document.createElement("div"); referenceGallery.className = "image-grid"; refs.append(referenceGallery);
        const actions = document.createElement("div"); actions.className = "actions";
        const generate = button("生成", "生成图片", () => run(node.id));
        const stop = button("取消", "立即取消当前等待及后续任务", () => cancelRun(node.id, state));
        const results = button("查看生成历史", "按每次生成查看图片", () => showResults(node.id));
        const status = document.createElement("p"); status.className = "status";
        actions.append(generate, stop, results); body.append(fields, refs, status, actions);
        Object.assign(view, { refs, gallery: referenceGallery, generate, stop, results, status });
      } else if (node.kind === "cutout") {
        element.classList.add("compact-process");
        const actions = document.createElement("div"); actions.className = "actions";
        const process = button("透明化", "使用官方程序去背景", () => {
          if (runs.has(runKey(state, node.id))) cancelRun(node.id, state); else void cutoutRun(node.id);
        });
        const status = document.createElement("p"); status.className = "status";
        actions.append(process);
        body.append(actions, status);
        Object.assign(view, { process, status });
      } else {
        setupResultGallery(view, body);
      }
      if (["reference", "generate"].includes(node.kind)) {
        element.addEventListener("dragover", event => {
          event.preventDefault(); event.stopPropagation();
          event.dataTransfer.dropEffect = "copy"; element.classList.add("drop-target");
        });
        element.addEventListener("dragleave", event => {
          if (!element.contains(event.relatedTarget)) element.classList.remove("drop-target");
        });
        element.addEventListener("drop", event => {
          event.preventDefault(); event.stopPropagation(); element.classList.remove("drop-target");
          const files = [...event.dataTransfer.files];
          if (files.length) void importFiles(node.id, files);
          else {
            const html = event.dataTransfer.getData("text/html");
            const url = new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") ||
              event.dataTransfer.getData("text/uri-list").split(/\r?\n/).find(line => line && !line.startsWith("#"));
            if (url) void importImageUrl(node.id, url);
          }
        });
      }
      const nodeFeedback = document.createElement("p"); nodeFeedback.className = "status"; nodeFeedback.hidden = true;
      body.append(nodeFeedback); view.feedback = nodeFeedback;
      element.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); showMenu(event.clientX, event.clientY, node.id); });
      nodes.append(element); return view;
    }
    function finishEdit() {
      if (!editSnapshot) return;
      const { target, value } = editSnapshot;
      if (JSON.stringify(value) !== JSON.stringify(scene(target))) {
        target.past.push(value); target.future = [];
      }
      editSnapshot = null;
    }
    function renderTaskRows(view, node) {
      const text = node.config.text || "";
      if (view.taskText === text) return;
      view.taskText = text;
      view.taskList.replaceChildren();
      const values = text.split(/\r\n?|\n/);
      const save = () => {
        const current = state?.graph.nodes[node.id];
        if (!current) return;
        current.config.text = [...view.taskList.querySelectorAll("textarea")].map(input => input.value).join("\n");
        view.taskText = current.config.text; persist();
      };
      for (const [index, value] of values.entries()) {
        const row = document.createElement("div"); row.className = "task-row";
        const input = document.createElement("textarea");
        input.rows = 2; input.value = G.taskLines(value)[0] || ""; input.placeholder = `任务 ${index + 1}`;
        input.setAttribute("aria-label", `任务 ${index + 1}`);
        input.addEventListener("focus", beginEdit);
        input.addEventListener("blur", () => {
          input.value = G.taskLines(input.value)[0] || ""; save(); finishEdit();
        });
        input.addEventListener("input", () => {
          if (!/[\r\n]/.test(input.value)) { save(); return; }
          const current = state?.graph.nodes[node.id];
          if (!current) return;
          const lines = G.taskLines(input.value);
          const values = [...view.taskList.querySelectorAll("textarea")].map(field => field.value);
          values.splice(index, 1, ...lines);
          current.config.text = values.join("\n"); persist(); finishEdit();
          renderTaskRows(view, current);
          view.taskList.children[index + lines.length - 1]?.querySelector("textarea")?.focus();
        });
        input.addEventListener("paste", event => {
          const pasted = event.clipboardData?.getData("text/plain");
          if (!pasted) return;
          event.preventDefault();
          const merged = input.value.slice(0, input.selectionStart) + pasted + input.value.slice(input.selectionEnd);
          const lines = G.taskLines(merged).filter(Boolean);
          finishEdit(); checkpoint();
          const current = [...view.taskList.querySelectorAll("textarea")].map(field => field.value);
          current.splice(index, 1, ...(lines.length ? lines : [""]));
          const currentNode = state.graph.nodes[node.id];
          currentNode.config.text = current.join("\n"); persist();
          renderTaskRows(view, currentNode);
          const focus = view.taskList.children[index + Math.max(1, lines.length) - 1]?.querySelector("textarea");
          focus?.focus(); focus?.setSelectionRange(focus.value.length, focus.value.length);
        });
        row.append(input, button("×", "删除任务", () => {
          checkpoint();
          const current = [...view.taskList.querySelectorAll("textarea")].map(field => field.value);
          current.splice(index, 1);
          const currentNode = state.graph.nodes[node.id];
          currentNode.config.text = current.join("\n");
          persist(); renderTaskRows(view, currentNode);
        }));
        view.taskList.append(row);
      }
    }
    function options(input, choices, value) {
      const signature = JSON.stringify(choices);
      if (input.dataset.options !== signature) {
        input.dataset.options = signature;
        input.replaceChildren(...choices.map(([id, text]) => {
          const option = document.createElement("option"); option.value = id; option.textContent = text; return option;
        }));
      }
      if (input.value !== value) input.value = value;
    }
    function modelData(references) {
      const key = references ? "edit" : "generate";
      if (!catalog.has(key)) {
        catalog.set(key, { pending: true });
        void rpc("models", { references }).then(value => { catalog.set(key, value); render(); })
          .catch(error => { catalog.set(key, { error: error.message }); say(error.message); });
      }
      return catalog.get(key);
    }
    function imageKey(image, index) { return `${image.source || ""}:${image.attempt || image.path || index}`; }
    function selectedImages(view) {
      const ready = view.images.filter(image => image.path);
      const selected = view.images.filter((image, index) => image.path && view.chosen.has(imageKey(image, index)));
      return selected.length ? selected : ready;
    }
    function setupResultGallery(view, parent) {
      Object.assign(view, { page: 0, pageSize: 1, chosen: new Set(), images: [], pagination: true, holdUntil: 0 });
      const toolbar = document.createElement("div"); toolbar.className = "gallery-toolbar";
      const count = document.createElement("span"); count.className = "gallery-count";
      const exportButton = button("下载图片", "下载图片", async () => {
        const files = selectedImages(view);
        if (!files.length) return download([], false);
        if (view.downloadPromise) return view.downloadPromise;
        exportButton.textContent = "正在保存…";
        view.downloadPromise = download(files, files.length > 1);
        try { await view.downloadPromise; }
        finally { view.downloadPromise = null; galleryControls(view); }
      });
      const all = button("全选", "全选或清除选择", () => {
        const ready = view.images.map((image, index) => image.path ? imageKey(image, index) : null).filter(Boolean);
        if (ready.length && ready.every(key => view.chosen.has(key))) view.chosen.clear();
        else for (const key of ready) view.chosen.add(key);
        view.gallerySignature = ""; renderImages(view, view.images, false);
      });
      const previous = button("‹", "上一页", () => {
        view.holdUntil = Date.now() + 8000;
        view.page = Math.max(0, view.page - 1); view.gallerySignature = ""; renderImages(view, view.images, false);
      });
      const next = button("›", "下一页", () => {
        view.holdUntil = Date.now() + 8000;
        view.page++; view.gallerySignature = ""; renderImages(view, view.images, false);
      });
      const page = document.createElement("span"); page.className = "gallery-page";
      const confirm = button("确认素材", "确认切图后用于 UI 组装", () => {
        const id = view.element?.dataset.node || view.displayNodeId;
        if (!id || !state.graph.nodes[id]) return;
        checkpoint(); state.graph.nodes[id].config.reviewSignature = G.reviewSignature(G.output(state.graph, id));
        persist(); render();
      });
      toolbar.append(count, exportButton, confirm, all, previous, page, next);
      const grid = document.createElement("div"); grid.className = "image-grid result-grid";
      const batchStatus = document.createElement("p"); batchStatus.className = "status"; batchStatus.hidden = true;
      parent.append(batchStatus, toolbar, grid);
      Object.assign(view, { gallery: grid, count, exportButton, confirm, previous, next, pageLabel: page, all, toolbar, parent, batchStatus });
      const observer = new ResizeObserver(() => renderImages(view, view.images, false));
      observer.observe(parent); view.galleryObserver = observer;
      view.galleryTimer = setInterval(() => {
        if (!parent.isConnected) { clearInterval(view.galleryTimer); observer.disconnect(); return; }
        const pages = Math.ceil(view.images.length / view.pageSize);
        if (view.images.length < 10 && pages > 1 && Date.now() >= view.holdUntil &&
            !parent.matches(":hover") && !parent.contains(shadow.activeElement)) {
          view.page = (view.page + 1) % pages; renderImages(view, view.images, false);
        }
      }, 4000);
    }
    function galleryControls(view) {
      if (!view.pagination) return;
      view.confirm.hidden = view.history || !view.images.some(image => image.workflow?.bbox);
      const pages = Math.max(1, Math.ceil(view.images.length / view.pageSize));
      view.page = Math.max(0, Math.min(view.page, pages - 1));
      const ready = view.images.filter(image => image.path), files = selectedImages(view);
      const single = view.images.length <= 1;
      view.count.hidden = single;
      view.all.hidden = view.images.length < 10;
      view.previous.hidden = view.next.hidden = view.pageLabel.hidden = single || pages <= 1;
      view.count.textContent = `已完成 ${ready.length} / ${view.images.length}${view.chosen.size ? ` · 已选 ${view.chosen.size}` : ""}`;
      view.pageLabel.textContent = `${view.page + 1} / ${pages}`;
      view.previous.disabled = view.next.disabled = false;
      view.exportButton.disabled = false;
      view.exportButton.textContent = files.length <= 1 ? "下载图片" : view.chosen.size ? "下载所选 ZIP" : "下载全部 ZIP";
    }
    function renderImages(view, images, removable, node) {
      view.images = images;
      if (view.pagination) {
        const width = view.parent.clientWidth || 340;
        const height = view.parent.clientHeight || Math.min(560, window.innerHeight * .65);
        const columns = Math.min(Math.max(1, images.length),
          Math.max(1, Math.floor((width - 20) / (images.length < 10 ? 156 : 112))));
        const rows = Math.max(1, Math.floor((height - view.toolbar.offsetHeight - 28) / ((width - 20) / columns + 44)));
        const size = Math.max(1, columns * rows);
        const latest = images.reduce((last, image, index) => image.path ? index : last, -1);
        if (latest !== view.latest && Date.now() >= view.holdUntil && latest >= 0) view.page = Math.floor(latest / size);
        else if (view.pageSize !== size) view.page = Math.floor(view.page * view.pageSize / size);
        view.latest = latest; view.pageSize = size;
        view.gallery.style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`;
        view.gallery.style.setProperty("--mw-single-height", Math.max(120, height - view.toolbar.offsetHeight - 30) + "px");
        view.gallery.classList.toggle("single-image", images.length === 1);
        if (images.length < 10) view.chosen.clear();
        const keys = new Set(images.map(imageKey));
        for (const key of view.chosen) if (!keys.has(key)) view.chosen.delete(key);
        galleryControls(view);
      }
      const signature = JSON.stringify([images, view.page, view.pageSize]);
      if (view.gallerySignature === signature) return;
      view.gallerySignature = signature; view.gallery.replaceChildren();
      const start = view.pagination ? view.page * view.pageSize : 0;
      const visible = view.pagination ? images.slice(start, start + view.pageSize) : images;
      for (const [offset, image] of visible.entries()) {
        const index = start + offset;
        const figure = document.createElement("figure");
        const preview = button("", image.name || "图片", () => previewImage(image));
        if (image.path) {
          const img = document.createElement("img");
          img.loading = "lazy"; img.src = media(image.path); img.alt = image.name || "图片";
          img.addEventListener("error", () => { img.remove(); preview.textContent = "图片读取失败"; preview.title = image.path; }, { once: true });
          preview.append(img);
        } else {
          preview.disabled = false;
          preview.textContent = ({ queued: "等待", running: "生成中", unknown: "待确认", pending: "处理中", failed: "失败", "not-submitted": "未提交" })[image.state] || image.state || "暂无图片";
        }
        const caption = document.createElement("figcaption"); caption.textContent = image.name || `图片 ${index + 1}`;
        figure.append(preview, caption);
        if (view.pagination && images.length >= 10) {
          const check = document.createElement("input"); check.type = "checkbox"; check.className = "image-check";
          check.disabled = false; check.checked = view.chosen.has(imageKey(image, index));
          check.setAttribute("aria-label", "选择 " + (image.name || `图片 ${index + 1}`));
          check.addEventListener("change", () => {
            const key = imageKey(image, index);
            if (check.checked) view.chosen.add(key); else view.chosen.delete(key);
            galleryControls(view);
          });
          figure.append(check);
        }
        if (view.pagination && images.length > 1 && image.path) {
          const tools = document.createElement("div"); tools.className = "image-tools";
          tools.append(button("↓", "下载这张图片", () => download([image], false)));
          figure.append(tools);
        }
        if (removable) {
          const remove = button("×", "移除参考图", () => {
          const current = state?.graph.nodes[node.id];
          if (!current) return;
          checkpoint(); current.config.images = current.config.images.filter(value => value.path !== image.path);
          persist(); render();
          });
          remove.className = "remove-image"; figure.append(remove);
        }
        view.gallery.append(figure);
      }
    }
    function render() {
      root.dataset.busy = String(runs.size > 0);
      if (!state) return;
      for (const [id, view] of views) if (!state.graph.nodes[id]) { view.element.remove(); views.delete(id); }
      for (const node of Object.values(state.graph.nodes)) {
        let view = views.get(node.id);
        if (!view) { view = createView(node); views.set(node.id, view); }
        position(view, node); view.element.classList.toggle("selected", selected.has(node.id));
        view.feedback.textContent = feedback.get(runKey(state, node.id)) || "";
        view.feedback.hidden = !view.feedback.textContent;
        const incoming = G.incoming(state.graph, node.id);
        view.element.querySelector(".input")?.classList.toggle("connected", incoming.length > 0);
        view.element.querySelector(".output")?.classList.toggle("connected", state.graph.edges.some(edge => edge.from === node.id));
        if (view.text && shadow.activeElement !== view.text) view.text.value = node.config.text;
        if (view.taskList) renderTaskRows(view, node);
        if (P.types[node.kind]) {
          const record = state.graph.runs[node.id];
          view.process.disabled = false;
          view.status.textContent = record?.canceled || record?.status === "canceled" ? "已取消" :
            record?.error || (record?.running ? record.payload?.stage || "处理中…" :
              record?.status === "waiting_input" ? node.kind === "slice" ? "等待切图区域" : "等待上游输入" :
              record?.status === "waiting_review" ? "待素材确认" : record?.status === "ready" ? "已完成" : "");
          const images = G.sourceImages(state.graph, node.id);
          renderImages(view, images, false);
          const info = images[0]?.workflow;
          view.exportPackage.hidden = !info?.assets?.length;
          view.detail.textContent = info?.bbox ? `${info.bbox.elements.length} 个元素 · ${info.bbox.texts.length} 个文字块${info.batches ? ` · ${info.batches.length} 批` : ""}` : "";
          if (["batch", "bbox"].includes(node.kind)) {
            const bbox = info?.bbox || G.output(state.graph, node.id)[0]?.workflow?.bbox;
            const signature = JSON.stringify(bbox?.texts || []);
            if (view.optionsSignature !== signature) {
              view.optionsSignature = signature; view.stageOptions.replaceChildren();
              const background = document.createElement("input"); background.type = "checkbox"; background.checked = node.config.background !== false;
              background.addEventListener("change", () => { checkpoint(); node.config.background = background.checked; persist(); });
              const label = document.createElement("label"); label.append(background, "环境背景"); view.stageOptions.append(label);
              for (const text of bbox?.texts || []) {
                const check = document.createElement("input"); check.type = "checkbox"; check.checked = node.config.artText.includes(text.id);
                check.addEventListener("change", () => {
                  checkpoint(); node.config.artText = check.checked ? [...node.config.artText, text.id] : node.config.artText.filter(id => id !== text.id); persist();
                });
                const label = document.createElement("label"); label.append(check, text.id + " · " + text.text);
                view.stageOptions.append(label);
              }
            }
          }
          view.editor.hidden = !info?.editorUrl;
          if (info?.editorUrl) view.editor.href = info.editorUrl;
        }
        if (node.kind === "reference") renderImages(view, node.config.images, true, node);
        if (node.kind === "refine") {
          const status = G.refinementState(state.graph, node.id);
          const retry = status.generator && state.graph.runs[status.generator]?.phase === "planning-failed";
          if (shadow.activeElement !== view.text) view.text.value = node.config.text;
          view.text.disabled = !status.ready;
          view.apply.disabled = !status.ready || !node.config.text.trim();
          view.retry.hidden = !retry || nodeRuns(state, status.generator).length > 0;
          view.status.textContent = status.reason;
          view.element.classList.toggle("refine-disabled", !status.ready);
        }
        if (node.kind === "generate") {
          const externalTasks = incoming.some(edge => state.graph.nodes[edge.from].kind === "tasks" &&
            G.tasks(state.graph.nodes[edge.from].config.text).length);
          const externalRefs = incoming.some(edge => G.TYPES[state.graph.nodes[edge.from].kind].output === "references" &&
            G.sourceImages(state.graph, edge.from).length);
          const metadata = modelData(externalRefs || node.config.images.length > 0);
          const prompt = view.fields.get("prompt");
          if (shadow.activeElement !== prompt) prompt.value = node.config.prompt;
          prompt.readOnly = false;
          prompt.title = externalTasks ? "生成时优先采用上游任务；列表为空则使用这里的描述" : "";
          options(view.fields.get("model"), [["auto", metadata.catalog?.label ? `自动 · ${metadata.catalog.label}` : "自动（官方模型）"],
            ...(metadata.catalog?.models || []).map(model => [model.id, model.label])], node.config.model);
          options(view.fields.get("resolution"), (metadata.choices?.resolution || ["1K", "2K"]).map(value => [value, value]), node.config.resolution);
          options(view.fields.get("aspectRatio"), (metadata.choices?.aspectRatio || ["1:1", "16:9", "9:16", "source"])
            .map(value => [value, value === "source" ? "跟随参考图" : value]), node.config.aspectRatio);
          view.refs.hidden = externalRefs;
          renderImages(view, node.config.images, true, node);
          const record = state.graph.runs[node.id];
          view.generate.disabled = nodeRuns(state, node.id).some(token => token.record.refinement) ||
            Boolean(G.incoming(state.graph, node.id).find(edge => state.graph.nodes[edge.from].kind === "refine" &&
              state.graph.nodes[edge.from].config.text.trim() && !G.refinementState(state.graph, edge.from).ready));
          view.stop.hidden = !nodeRuns(state, node.id).length;
          view.results.hidden = !G.batches(state.graph, node.id).length;
          view.status.textContent = runStatus(record);
        }
        if (node.kind === "cutout") {
          view.process.disabled = false;
          view.process.textContent = runs.has(runKey(state, node.id)) ? "取消透明化" : "透明化";
          view.status.textContent = runStatus(state.graph.runs[node.id]);
        }
        if (node.kind === "display") {
          renderImages(view, G.previewOutput(state.graph, node.id), false, node);
          galleryStatus(view, state.graph, node.id);
        }
      }
      for (const entry of resultDialogs.values())
        if (entry.state === state) {
          if (entry.history) renderHistory(entry);
          else {
            renderImages(entry.view, G.output(state.graph, entry.id), false);
            galleryStatus(entry.view, state.graph, entry.id);
          }
        }
      drawWires();
    }
    function drawWires() {
      if (frame) return;
      frame = setTimeout(async () => {
        frame = null;
        if (!state) return;
        const ticket = ++wireSequence;
        const shapes = [], edges = [];
        for (const node of Object.values(state.graph.nodes)) {
          shapes.push({ id: node.id, type: "note", x: node.x, y: node.y, width: node.width, height: node.height });
          shapes.push({ id: node.id + "/in", type: "note", x: node.x, y: node.y + 58, width: 0, height: 0 });
          shapes.push({ id: node.id + "/out", type: "note", x: node.x + node.width, y: node.y + 58, width: 0, height: 0 });
        }
        for (const edge of state.graph.edges) edges.push({ id: edge.id, from: edge.from + "/out", to: edge.to + "/in", kind: "image-variant" });
        if (gesture?.type === "connect" && gesture.moved && gesture.cursor) {
          shapes.push({ id: "preview-target", type: "note", x: gesture.cursor.x, y: gesture.cursor.y, width: 0, height: 0 });
          edges.push({ id: "preview", from: gesture.id + "/out", to: "preview-target", kind: "image-variant" });
        }
        try {
          const paths = edges.length ? await rpc("paths", { nodes: shapes, edges }) : [];
          if (ticket !== wireSequence) return;
          const existing = new Map([...svg.querySelectorAll("path.wire")].map(path => [path.dataset.edge, path]));
          for (const item of paths) {
            let path = existing.get(item.id);
            if (!path) {
              path = document.createElementNS(svg.namespaceURI, "path");
              path.dataset.edge = item.id; path.classList.add("wire");
              const hit = document.createElementNS(svg.namespaceURI, "path");
              hit.classList.add("wire-hit"); hit.dataset.edge = item.id; path.hit = hit;
              const pick = event => { if (event.button !== 0) return; event.stopPropagation(); select(item.id, true); root.focus({ preventScroll: true }); };
              path.addEventListener("pointerdown", pick); hit.addEventListener("pointerdown", pick);
              svg.append(hit, path);
            }
            const edge = state.graph.edges.find(edge => edge.id === item.id);
            path.hit.setAttribute("d", item.d); path.hit.classList.toggle("temporary", item.id === "preview");
            path.setAttribute("d", item.d); path.classList.toggle("selected", selectedEdge === item.id || selectedEdges.has(item.id) ||
              Boolean(edge && selectedPort && (selectedPort.side === "input" ? edge.to : edge.from) === selectedPort.id));
            path.classList.toggle("temporary", item.id === "preview"); existing.delete(item.id);
          }
          for (const path of existing.values()) { path.hit.remove(); path.remove(); }
        } catch (error) { say(error.message); }
      }, 16);
    }
    function openDialog(dialog) {
      dialog.addEventListener("cancel", event => { event.preventDefault(); dialog.close(); });
      dialog.addEventListener("click", event => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
      });
      shadow.append(dialog); dialog.showModal();
    }
    function previewImage(image) {
      if (!image.path) { say("这张图片尚未返回可查看的结果，其他图片可以继续生成。"); return; }
      const dialog = document.createElement("dialog"); dialog.className = "preview image-viewer";
      const actions = document.createElement("div"); actions.className = "actions";
      const stage = document.createElement("div"); stage.className = "image-viewer-stage";
      const img = document.createElement("img"); img.alt = image.name || "图片"; img.draggable = false;
      const label = document.createElement("span"); label.className = "image-viewer-scale";
      const status = document.createElement("span"); status.className = "status"; status.textContent = "正在加载图片…";
      let scale = 1, x = 0, y = 0, drag, fitted = true;
      const paint = () => {
        img.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
        label.textContent = `${Math.round(scale * 100)}%`;
      };
      const fit = () => {
        if (!img.naturalWidth) return;
        scale = Math.min((stage.clientWidth - 24) / img.naturalWidth, (stage.clientHeight - 24) / img.naturalHeight, 1);
        x = (stage.clientWidth - img.naturalWidth * scale) / 2;
        y = (stage.clientHeight - img.naturalHeight * scale) / 2;
        fitted = true; paint();
      };
      const zoom = (next, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
        const value = Math.max(.02, Math.min(32, next)), ratio = value / scale;
        x = cx - (cx - x) * ratio; y = cy - (cy - y) * ratio;
        scale = value; fitted = false; paint();
      };
      actions.append(button("−", "缩小图片", () => zoom(scale / 1.25)), label,
        button("+", "放大图片", () => zoom(scale * 1.25)),
        button("适应窗口", "完整显示图片", fit),
        button("1:1", "按实际像素显示", () => zoom(1)),
        button("↓", "下载图片", () => download([image], false)), status,
        button("×", "关闭", () => dialog.close()));
      stage.append(img); dialog.append(actions, stage);
      stage.addEventListener("wheel", event => {
        event.preventDefault(); event.stopPropagation();
        const rect = stage.getBoundingClientRect();
        zoom(scale * Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
      }, { passive: false });
      stage.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: x, top: y };
        stage.setPointerCapture(event.pointerId); stage.classList.add("panning");
      });
      stage.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return;
        x = drag.left + event.clientX - drag.x; y = drag.top + event.clientY - drag.y; fitted = false; paint();
      });
      const stop = event => {
        if (!drag || (event && event.pointerId !== drag.id)) return;
        if (stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id);
        drag = null; stage.classList.remove("panning");
      };
      stage.addEventListener("pointerup", stop); stage.addEventListener("pointercancel", stop);
      stage.addEventListener("dblclick", event => { event.preventDefault(); if (fitted) zoom(1); else fit(); });
      dialog.addEventListener("keydown", event => {
        if (["+", "=", "-", "0"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "0") fit(); else zoom(event.key === "-" ? scale / 1.25 : scale * 1.25);
        }
      });
      img.addEventListener("load", () => { status.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; fit(); });
      img.addEventListener("error", () => { status.textContent = "图片加载失败，可关闭后重试。"; });
      const observer = new ResizeObserver(() => { if (fitted) fit(); });
      dialog.addEventListener("close", () => { observer.disconnect(); dialog.remove(); });
      openDialog(dialog); observer.observe(stage); img.src = media(image.path);
    }
    async function download(images, zip) {
      if (!images.some(image => image.path)) { say("当前没有已生成的图片可下载。生成成功后可直接下载，现有任务和输入已保留。"); return; }
      try {
        say("");
        return await rpc("download", { files: images.filter(image => image.path), zip }, 120000);
      } catch (error) {
        say("下载失败：" + error.message);
        const dialog = [...shadow.querySelectorAll("dialog[open]")].at(-1);
        if (dialog) {
          let status = dialog.querySelector(".download-error");
          if (!status) { status = document.createElement("p"); status.className = "download-error"; dialog.prepend(status); }
          status.textContent = "下载失败：" + error.message;
        }
      }
    }
    function runStatus(record) {
      if (!record) return "";
      const success = record.items.filter(item => item.state === "succeeded" && item.path).length;
      const canceled = record.items.filter(item => item.state === "canceled").length;
      const failed = record.items.find(item => item.state === "failed");
      return `已完成 ${success} 张${record.running ? " · 处理中" : ""}${canceled ? ` · 已取消 ${canceled} 项` : ""}${failed ? " · 失败：" + (failed.error || "处理失败") : ""}`;
    }
    function galleryStatus(view, graph, id) {
      const items = G.incoming(graph, id).flatMap(edge => graph.runs[edge.from]?.items || []);
      const canceled = items.filter(item => item.state === "canceled").length;
      view.batchStatus.hidden = !canceled;
      view.batchStatus.textContent = canceled ? `已完成 ${view.images.length} 张 · 已取消 ${canceled} 项` : "";
    }
    async function upload(id) {
      const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp"; input.multiple = true;
      input.addEventListener("change", () => void importFiles(id, [...input.files]));
      input.click();
    }
    function insertTemplate(value, name) {
      checkpoint();
      const location = clipboardLocation(), mapping = new Map();
      for (const source of value.nodes) {
        const id = crypto.randomUUID(); mapping.set(source.id, id);
        const node = G.add(state.graph, id, source.kind, { x: location.x + source.x, y: location.y + source.y });
        if (source.config) Object.assign(node.config, structuredClone(source.config));
      }
      for (const edge of value.edges) G.connect(state.graph, mapping.get(edge.from), mapping.get(edge.to), crypto.randomUUID());
      select(null); for (const id of mapping.values()) selected.add(id);
      persist(); render(); say(name + "已添加。");
    }
    function previewBbox(id) {
      const bbox = state.graph.runs[id]?.items[0]?.workflow?.bbox;
      if (!bbox) { say("识图尚未完成。"); return; }
      const dialog = document.createElement("dialog"); dialog.className = "preview";
      dialog.append(button("×", "关闭", () => dialog.close()));
      const frame = document.createElement("div"); frame.className = "bbox-preview";
      const image = document.createElement("img"); image.src = media(bbox.design.path); image.alt = "BBox 原稿";
      const overlay = document.createElementNS(svg.namespaceURI, "svg");
      overlay.setAttribute("viewBox", `0 0 ${bbox.design.width} ${bbox.design.height}`);
      for (const item of bbox.elements) {
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        for (const [key, value] of Object.entries({ x: item.bbox[0], y: item.bbox[1], width: item.bbox[2], height: item.bbox[3] }))
          rect.setAttribute(key, String(value));
        rect.setAttribute("fill", "none"); rect.setAttribute("stroke", "#00b5a6");
        rect.setAttribute("stroke-width", "2"); rect.setAttribute("vector-effect", "non-scaling-stroke");
        const title = document.createElementNS(svg.namespaceURI, "title"); title.textContent = item.id + " · " + item.name;
        rect.append(title); overlay.append(rect);
      }
      frame.append(image, overlay); dialog.append(frame);
      dialog.addEventListener("close", () => dialog.remove()); openDialog(dialog);
    }
    async function nativePipeline(target, operation, value) {
      const result = await chrome.runtime.sendMessage({ type: "maker-workflow-native",
        request: { operation, value, project, canvas: target.id, origin: location.origin } });
      if (result?.error || result?.status !== "workflow") throw new Error(result?.error || result?.message || "本地 BBox 处理器未安装，请运行新版安装器。");
      return result.value;
    }
    async function repairMedia(target) {
      const legacy = /^assets\/image\/mw-[a-f0-9-]{36}\.png$/i, paths = new Set(), visited = new Set();
      function collect(value) {
        if (typeof value === "string") { if (legacy.test(value)) paths.add(value); return; }
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);
        for (const [key, child] of Object.entries(value)) { if (legacy.test(key)) paths.add(key); collect(child); }
      }
      collect(target.graph);
      if (!paths.size) return;
      const result = await nativePipeline(target, "import-media", { paths: [...paths] });
      const mapping = result.paths; visited.clear();
      function remap(value) {
        if (typeof value === "string") return mapping[value] || value;
        if (!value || typeof value !== "object" || visited.has(value)) return value;
        visited.add(value);
        for (const [key, child] of Object.entries(value)) {
          const next = mapping[key] || key;
          let replacement = remap(child);
          if (typeof child === "string" && /signature$/i.test(key)) {
            try { replacement = JSON.stringify(remap(JSON.parse(child))); } catch {}
          } else if (key === "inputKey" && typeof child === "string") {
            for (const [oldPath, newPath] of Object.entries(mapping))
              if (child.endsWith(":" + oldPath)) replacement = child.slice(0, -oldPath.length) + newPath;
          }
          value[next] = replacement;
          if (next !== key) delete value[key];
        }
        return value;
      }
      remap(target.graph);
      await chrome.storage.local.set({ [key(target.id)]: target.graph });
    }
    async function prepareInputs(target, id, token, visited) {
      for (const edge of G.incoming(target.graph, id)) {
        if (token.stop) return;
        const source = target.graph.nodes[edge.from];
        if (!source) continue;
        if (P.types[source.kind]) await executePipeline(target, source.id, token, false, visited);
        else if (source.kind === "display") {
          if (!visited.has(source.id)) {
            visited.add(source.id);
            await prepareInputs(target, source.id, token, visited);
          }
        } else if (source.kind === "cutout") {
          if (!visited.has(source.id)) {
            visited.add(source.id);
            await prepareInputs(target, source.id, token, visited);
            await processCutout(target, source.id, token, false);
          }
        } else if (source.kind === "generate" && !G.sourceImages(target.graph, source.id).length) {
          const existing = nodeRuns(target, source.id).filter(value => value.record.batchId).at(-1);
          const promise = existing?.promise || run(source.id, target), child = nodeRuns(target, source.id).at(-1);
          if (!existing && child && child !== token) (token.children ||= new Set()).add(child);
          await waitFor(token, promise);
        }
      }
    }
    async function executePipeline(target, id, token, allowReview = false, visited = new Set()) {
      if (token.stop || visited.has(id)) return;
      visited.add(id);
      const node = target.graph.nodes[id];
      await prepareInputs(target, id, token, visited);
      if (!P.types[node?.kind] || token.stop) return;
      return processNode(target, id, token, async () => {
      const images = G.inputImages(target.graph, id, token.selection);
      const signature = JSON.stringify([node.config, images.map(image => [image.path, image.workflow])]);
      const prior = target.graph.runs[id];
      if (prior?.signature === signature && prior.status === "ready") return;
      if (!images.length) {
        target.graph.runs[id] = { running: false, items: [], status: "waiting_input" };
        throw new Error("未取得输入图片。请连接已导入的参考图片；现有输入和任务记录已保留。");
      }
      const record = { running: true, items: [], signature, payload: prior?.signature === signature ? prior.payload : undefined, status: "running" };
      target.graph.runs[id] = record;
      (token.stages ||= new Set()).add(record);
      if (token.node === id) token.record = record;
      persist(target); if (state === target) render();
      try {
        const items = await P.execute({
          node, images, previous: record.payload, canceled: () => token.stop,
          rpc: (action, value, timeout) => waitFor(token, rpc(action, { canvas: target.id, ...value }, timeout)),
          native: (operation, value) => waitFor(token, nativePipeline(target, operation, value)),
          save: value => { if (!token.stop) { record.payload = structuredClone(value); persist(target); } }
        });
        record.items = token.stop ? [] : items;
        record.status = token.stop ? "canceled" : items.length ? "ready" : "waiting_input";
        if (!token.stop && !items.length)
          throw new Error(node.kind === "slice" ? "这张图片没有切图区域。请将 BBox 识别预排结果接入此链路，现有图片已保留。" :
            "上游尚未提供当前步骤所需的数据。请查看上游卡片的具体失败原因；现有图片和任务已保留。");
      } catch (error) { record.status = token.stop ? "canceled" : "failed"; if (!token.stop) record.error = error.message; throw error; }
      finally { record.running = false; persist(target); if (state === target) render(); }
      });
    }
    function runPipeline(id, allowReview = false, target = state) {
      if (!target) return;
      return runNode(target, id, token => executePipeline(target, id, token, allowReview));
    }
    async function reviewPipeline(id) {
      if (!state) return;
      const target = state;
      const edges = G.incoming(target.graph, id);
      for (const edge of edges) if (P.types[target.graph.nodes[edge.from]?.kind]) await runPipeline(edge.from);
      const images = G.output(target.graph, id);
      if (!images.length) { say("上游切图尚未完成。"); return; }
      const dialog = document.createElement("dialog"); dialog.className = "preview results-preview";
      dialog.append(button("×", "关闭", () => dialog.close()));
      const gallery = {}; setupResultGallery(gallery, dialog); renderImages(gallery, images, false);
      dialog.append(button("确认全部素材", "确认切图完整、透明且无粘连", () => { dialog.close(); void runPipeline(id, true); }));
      dialog.addEventListener("close", () => dialog.remove()); openDialog(dialog);
    }
    function clipboardLocation() {
      const rect = board.getBoundingClientRect();
      return lastPoint || point(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    function copyPayload() {
      if (!state || !selected.size) return null;
      const ids = new Set(selected), graph = state.graph;
      const copies = [...ids].map(id => {
        const node = structuredClone(graph.nodes[id]);
        if (node.kind === "display") node.config.images = G.output(graph, id).filter(image => !ids.has(image.source));
        return node;
      });
      return { version: 1, project, nodes: copies,
        edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
        runs: Object.fromEntries([...ids].filter(id => graph.runs[id]).map(id =>
          [id, { running: false, items: graph.runs[id].items.filter(item => item.state === "succeeded" && item.path) }])) };
    }
    async function copyCards() {
      const value = copyPayload();
      if (!value) return;
      try { await navigator.clipboard.writeText(clipboardMarker + JSON.stringify(value)); }
      catch (error) { say("复制卡片失败：" + error.message); }
    }
    async function pasteCards(value) {
      if (value.version !== 1 || !/^[a-f0-9]{64}$/i.test(value.project || "") ||
          !Array.isArray(value.nodes) || !value.nodes.length) { say("剪贴板中的卡片数据不完整，未修改当前画布。"); return; }
      const destination = state;
      if (value.project !== project) {
        value = structuredClone(value);
        const copied = new Map();
        async function transfer(object) {
          if (!object || typeof object !== "object") return;
          if (typeof object.path === "string") {
            const original = object.path;
            if (!copied.has(original)) copied.set(original, rpc("copy-image", {
              canvas: destination.id, sourceProject: value.project, image: { path: original }
            }, 120000));
            object.path = (await copied.get(original)).path;
          }
          for (const child of Object.values(object)) if (child && typeof child === "object") await transfer(child);
        }
        await transfer(value.nodes);
        const mediaKinds = new Set(["generate", "cutout", "display", "compress", "bbox", "slice"]);
        for (const node of value.nodes) if (value.runs?.[node.id]) {
          if (!mediaKinds.has(node.kind)) delete value.runs[node.id];
          else {
            await transfer(value.runs[node.id]);
            for (const item of value.runs[node.id].items || []) delete item.attempt;
          }
        }
        if (state !== destination) return;
      }
      const copies = value.nodes.filter(node => node && G.TYPES[node.kind] &&
        Number.isFinite(node.x) && Number.isFinite(node.y));
      if (!copies.length) { say("剪贴板中没有可识别的卡片，未修改当前画布。"); return; }
      const mapping = new Map(copies.map(node => [node.id, crypto.randomUUID()]));
      const location = clipboardLocation(), x = Math.min(...copies.map(node => node.x)), y = Math.min(...copies.map(node => node.y));
      const previous = scene(state), runs = [];
      try {
        for (const original of copies) {
          const id = mapping.get(original.id), node = G.add(state.graph, id, original.kind,
            { x: location.x + original.x - x, y: location.y + original.y - y });
          node.width = Math.max(240, Number(original.width) || node.width);
          node.height = Math.max(original.kind === "cutout" ? 86 : 150, Number(original.height) || node.height);
          Object.assign(node.config, structuredClone(original.config || {}));
          if (value.runs?.[original.id]) runs.push([id, structuredClone(value.runs[original.id])]);
        }
        for (const edge of value.edges || []) G.connect(state.graph, mapping.get(edge.from), mapping.get(edge.to), crypto.randomUUID());
      } catch (error) { Object.assign(state.graph, previous); throw error; }
      state.past.push(previous); state.future = [];
      for (const [id, run] of runs) state.graph.runs[id] = run;
      select(null); for (const id of mapping.values()) selected.add(id);
      menu.hidden = true; persist(); render(); root.focus({ preventScroll: true });
    }
    async function pasteContent(text, files) {
      if (!state) return;
      if (files.length) {
        const selectedId = [...selected][0], current = state.graph.nodes[selectedId];
        const id = ["reference", "generate"].includes(current?.kind) ? selectedId : create("reference", clipboardLocation());
        if (id) await importFiles(id, files);
      } else if (text?.startsWith(clipboardMarker)) {
        await pasteCards(JSON.parse(text.slice(clipboardMarker.length)));
      } else if (text?.trim()) {
        const id = create("prefix", clipboardLocation());
        state.graph.nodes[id].config.text = text; persist(); render();
      }
    }
    async function pasteClipboard() {
      if (!state || clipboardBusy) return;
      const target = state; clipboardBusy = true;
      try {
        const files = []; let text = "";
        if (navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find(type => ["image/png", "image/jpeg", "image/webp"].includes(type));
            if (type) files.push(new File([await item.getType(type)], `粘贴图片-${files.length + 1}.${type.split("/")[1]}`, { type }));
            else if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
          }
        } else text = await navigator.clipboard.readText();
        if (state === target) await pasteContent(text, files);
      } catch (error) { say("粘贴失败：" + error.message); }
      finally { clipboardBusy = false; }
    }
    async function importImageUrl(id, url) {
      try {
        const parsed = new URL(url, location.href);
        if (!["http:", "https:", "data:", "blob:"].includes(parsed.protocol)) throw new Error("不支持此图片来源。");
        const response = await fetch(parsed.href);
        if (!response.ok) throw new Error("图片无法读取。");
        const blob = await response.blob();
        await importFiles(id, [new File([blob], "参考图片", { type: blob.type })]);
      } catch (error) { say("拖入图片失败：" + error.message + "；可先将图片保存后拖入文件。"); }
    }
    async function importFiles(id, files) {
      const target = state, node = target?.graph.nodes[id];
      if (!node) return;
        if (state === target) checkpoint();
        try {
          for (const original of files) {
            let file = original;
            if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
              const bitmap = await createImageBitmap(file);
              try {
                const surface = document.createElement("canvas"); surface.width = bitmap.width; surface.height = bitmap.height;
                surface.getContext("2d").drawImage(bitmap, 0, 0);
                const png = await new Promise(resolve => surface.toBlob(resolve, "image/png"));
                if (!png) throw new Error("图片转换未完成。");
                file = new File([png], original.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
              } finally { bitmap.close(); }
            }
            const data = await new Promise((resolve, reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]);
              reader.onerror = reject; reader.readAsDataURL(file);
            });
            const image = await rpc("import", { canvas: target.id, data, type: file.type, name: file.name }, 120000);
            const current = target.graph.nodes[id];
            if (!current) break;
            current.config.images = G.uniqueImages([...current.config.images, image]); persist(target);
            if (state === target) render();
          }
        } catch (error) { reportFailure(target, id, error); }
    }
    function cancelRun(id, target = state, specific) {
      const key = runKey(target, id);
      const token = specific || nodeRuns(target, id).filter(value => value.record.batchId).at(-1) ||
        nodeRuns(target, id).at(-1) || runs.get(key) ||
        [...runs.values()].find(value => value.state === target && value.nodeIds.has(id));
      if (!token) { say("这个步骤当前没有正在执行的任务。"); return; }
      token.stop = true;
      for (const child of token.children || []) if (!child.stop) cancelRun(child.node, child.state, child);
      const record = token.record;
      record.running = false; record.canceled = true;
      if (record.status) record.status = "canceled";
      for (const item of record.items) if (["queued", "running", "pending", "unknown"].includes(item.state)) item.state = "canceled";
      for (const stage of token.stages || []) {
        stage.running = false; stage.canceled = true; stage.status = "canceled";
        for (const item of stage.items) if (["queued", "running", "pending"].includes(item.state)) item.state = "canceled";
      }
      token.release?.();
      runs.delete(token.key); persist(token.state); render();
      if (token.request) void rpc("cancel", { request: token.request, canvas: token.state.id, attempt: token.item?.attempt }, 30000)
        .catch(error => setFeedback(token.state, token.node, "本地已取消；远端状态稍后同步：" + error.message));
    }
    async function processCutout(target, id, token, cascade = true) {
      await processNode(target, id, token, async () => {
      const images = G.inputImages(target.graph, id, token.selection);
      if (!images.length || token.stop) return;
      const previous = target.graph.runs[id]?.items || [];
      const record = { running: true, items: images.map(image => {
        const inputKey = `${image.source || ""}:${image.path}`;
        return previous.find(item => item.inputKey === inputKey && item.state === "succeeded" && item.transparent === true) ||
          { name: image.name, workflow: image.workflow, inputKey, state: "queued" };
      }) };
      (token.stages ||= new Set()).add(record);
      target.graph.runs[id] = record;
      if (token.node === id) token.record = record;
      persist(target); if (state === target) render();
      try {
        for (const [index, image] of images.entries()) {
          if (token.stop) break;
          if (record.items[index].state === "succeeded") continue;
          record.items[index].state = "running";
          if (state === target) render();
          const result = await waitFor(token, rpc("cutout", { canvas: target.id, image }, 120000));
          if (token.stop) break;
          if (!target.graph.nodes[id]) return;
          Object.assign(record.items[index], result, { workflow: result.workflow || image.workflow });
          ensureDisplay(target, id); persist(target);
          if (state === target) render();
        }
      } catch (error) {
        const item = record.items.find(item => item.state === "running");
        if (item) { item.state = "failed"; item.error = error.message; }
        throw new Error("透明化失败：" + error.message);
      } finally {
        record.running = false;
        persist(target); if (state === target) render();
      }
      });
      if (!token.stop && cascade) await processDownstream(target, id, token);
    }
    async function processDownstream(target, sourceId, token) {
      for (const edge of [...target.graph.edges]) {
        if (token.stop) return;
        if (edge.from === sourceId && target.graph.nodes[edge.to]?.kind === "cutout")
          await processCutout(target, edge.to, token);
        else if (edge.from === sourceId && target.graph.nodes[edge.to]?.kind === "slice") {
          await executePipeline(target, edge.to, token);
          ensureDisplay(target, edge.to);
        }
        else if (edge.from === sourceId && target.graph.nodes[edge.to]?.kind === "display")
          await processDownstream(target, edge.to, token);
      }
    }
    function cutoutRun(id, target = state) {
      if (!target) return;
      return runNode(target, id, token => processCutout(target, id, token));
    }
    async function nameImage(target, item, token) {
      item.namingRequestId ||= crypto.randomUUID();
      item.namingStatus = "running"; persist(target);
      try {
        const named = await waitFor(token, nativePipeline(target, "name", {
          requestId: item.namingRequestId, image: { path: item.path }, previousPrompt: item.prompt, name: item.name
        }));
        item.name = named.name; item.namingStatus = "succeeded"; delete item.namingError;
      } catch (error) {
        item.namingStatus = "failed"; item.namingError = error.message;
        if (token.stop) throw error;
        reportFailure(target, token.node, new Error("图片已保留；AI 命名未完成：" + error.message));
      } finally { persist(target); if (state === target) render(); }
    }
    function run(id, target = state, retryPlanning = false) {
      if (!target) return;
      const refineNode = G.incoming(target.graph, id).map(edge => target.graph.nodes[edge.from])
        .find(node => node.kind === "refine");
      if (nodeRuns(target, id).some(token => token.record.refinement)) return;
      let prepared;
      if (retryPlanning) {
        const previous = target.graph.runs[id];
        if (previous?.phase !== "planning-failed" || !previous.plan) return;
        prepared = structuredClone(previous.plan);
      } else if (refineNode?.config.text.trim()) {
        prepared = G.refinementPlan(target.graph, id, refineNode.id);
      }
      const record = retryPlanning ? target.graph.runs[id] : G.beginBatch(target.graph, id);
      record.running = true;
      if (prepared) {
        Object.assign(record, { refinement: prepared.refinement, parentBatchId: prepared.parentBatchId, plan: prepared });
        if (!retryPlanning) {
          refineNode.config.text = "";
          finishEdit();
        }
        persist(target);
      }
      return runNode(target, id, async token => {
        const node = target.graph.nodes[id];
        if (!node) return;
        if (!prepared) await prepareInputs(target, id, token, new Set([id]));
        if (token.stop) return;
        const plan = prepared || G.plan(target.graph, id);
        if (!plan.tasks.length || plan.tasks.every(task => !task.prompt?.trim())) {
          throw new Error("这次没有可提交的图片描述。请在本地描述、通用提示词或任务列表中填写要生成的内容；尚未提交请求，也未扣费。");
        }
        Object.assign(record, { parameters: plan.parameters, context: plan.context,
          items: plan.tasks.map(task => ({ name: task.name, workflow: task.workflow, state: "queued",
            prompt: task.prompt, sourcePath: task.images?.[0]?.path })) });
        if (target.graph.runs[id] === record) setFeedback(target, id, "");
        const canceled = token.canceled;
        persist(target); render(); say("");
        if (prepared) {
          record.phase = "planning";
          try {
            for (const [index, task] of plan.tasks.entries()) {
              setFeedback(target, id, `AI 正在理解微调 ${index + 1}/${plan.tasks.length}`);
              const merged = await waitFor(token, nativePipeline(target, "refine", {
                requestId: task.requestId, image: task.images[0], instructions: plan.refinement,
                previousPrompt: task.prompt, name: task.name, context: plan.context, sourceContext: task.sourceContext
              }));
              record.items[index].name = merged.name;
              record.items[index].prompt = merged.prompt;
              record.items[index].changes = merged.changes;
              persist(target);
            }
          } catch (error) { record.phase = "planning-failed"; throw error; }
          record.phase = "generating";
          plan.tasks = plan.tasks.map((task, index) => ({ ...task, prompt: record.items[index].prompt }));
          setFeedback(target, id, "");
        }
        for (let index = 0; index < plan.tasks.length && !token.stop; index++) {
          const item = record.items[index];
          token.item = item; token.request = crypto.randomUUID();
          Object.assign(item, { state: "running", prompt: plan.tasks[index].prompt, submittedAt: Date.now() });
          persist(target); if (state === target) render();
          const apply = value => {
            if (token.stop) { if (value.id) item.attempt = value.id; persist(target); return; }
            const path = value.resultAssetPath || value.deliveredAssetPath;
            Object.assign(item, { attempt: value.id || item.attempt,
              state: value.status === "succeeded" && !path ? "unknown" : value.status || "unknown",
              path, error: value.error, credits: value.credits });
            if (path) ensureDisplay(target, id);
            persist(target); if (state === target) render();
          };
          try {
            const request = rpc("generate", { canvas: target.id, prompt: plan.tasks[index].prompt,
              parameters: plan.parameters, images: plan.tasks[index].images || plan.images, request: token.request }, 9 * 60 * 1000);
            void request.then(value => { if (token.stop && value.id) { item.attempt = value.id; persist(target); } }).catch(() => {});
            let value = await Promise.race([request, canceled]);
            if (token.stop) break;
            apply(value);
            const deadline = Date.now() + 8 * 60 * 1000;
            while (["pending", "running"].includes(value.status) && value.id && Date.now() < deadline) {
              const due = Date.parse(value.nextQueryAt || "") || Date.now() + 2000;
              await Promise.race([pause(Math.max(500, Math.min(10000, due - Date.now()))), canceled]);
              if (token.stop) break;
              value = await Promise.race([rpc("query", { canvas: target.id, attempt: value.id }, 6 * 60 * 1000), canceled]);
              if (token.stop) break;
              apply(value);
            }
            if (token.stop) break;
            if (item.state !== "succeeded" || !item.path) {
              if (["pending", "running"].includes(item.state)) item.state = "unknown";
              throw new Error(item.error || `第 ${record.sequence} 次生成未完成，状态：${item.state}。可在生成历史中刷新这一批的结果。`);
            }
            await nameImage(target, item, token);
            if (token.stop) break;
            try { if (target.graph.runs[id] === record) await processDownstream(target, id, token); }
            catch (error) {
              if (!token.stop) {
                reportFailure(target, id, new Error("图片已生成；后处理未完成：" + error.message));
                if (sayFatal(error.message)) throw error;
              }
            }
          } catch (error) {
            if (token.stop) break;
            if (item.state === "running") item.state = error.notSubmitted ? "failed" : "unknown";
            item.error = error.message;
            reportFailure(target, id, error);
            if (sayFatal(error.message)) throw error;
          } finally { persist(target); }
        }
        record.phase = "finished";
      }, "batch-" + record.batchId, record);
    }
    async function queryRun(id, strict = false, token, batch) {
      if (!token) {
        if (!state) return;
        const target = state;
        return runNode(target, id, current => queryRun(id, strict, current, batch), "refresh-" + (batch?.batchId || "latest"));
      }
      const target = token.state;
      const original = batch || target.graph.runs[id];
      try {
        for (const item of original?.items || []) if (["unknown", "pending", "running", "failed"].includes(item.state) ||
            item.state === "succeeded" && item.namingStatus !== "succeeded") {
          if (item.state === "succeeded" && item.path) {
            await nameImage(target, item, token);
            continue;
          }
          const record = await waitFor(token, rpc("query", {
            canvas: target.id, attempt: item.attempt, prompt: item.prompt, submittedAt: item.submittedAt
          }, 6 * 60 * 1000));
          if (item.state === "canceled") continue;
          const path = record.resultAssetPath || record.deliveredAssetPath;
          Object.assign(item, { attempt: record.id || item.attempt,
            state: record.status === "succeeded" && !path ? "unknown" : record.status,
            path, error: record.error, credits: record.credits });
          if (path) {
            await nameImage(target, item, token);
            ensureDisplay(target, id);
            if (target.graph.runs[id] === original) await processDownstream(target, id, token);
          }
        }
        persist(target); if (state === target) render();
        if ((original?.items || []).some(item => ["unknown", "pending", "running"].includes(item.state)))
          setFeedback(target, id, `第 ${original.sequence || ""} 次生成暂未返回全部图片。这里仅刷新结果；点击“生成”会新建另一批。`);
      } catch (error) { if (strict || token.stop) throw error; reportFailure(target, id, error); }
    }
    let suppressClick = false;
    shadow.addEventListener("pointerdown", event => {
      if (menu.contains(event.target)) return;
      menu.hidden = true;
      const element = event.target.closest(".node");
      if (!element || event.button !== 0) return;
      const id = element.dataset.node, node = state.graph.nodes[id], port = event.target.closest(".port");
      if (event.shiftKey && !port) {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        selectedEdge = null; selectedEdges.clear();
        for (const [nodeId, view] of views) view.element.classList.toggle("selected", selected.has(nodeId));
        return;
      }
      if (!selected.has(id)) select(id);
      selectedEdge = null;
      if (port) {
        selectPort(id, port.dataset.port);
        if (port.classList.contains("output")) gesture = { type: "connect", id, start: point(event.clientX, event.clientY), moved: false };
      } else if (event.target.closest(".node-header,.resize-handle") && !event.target.closest(".node-header button")) {
        gesture = {
          type: event.target.closest(".resize-handle") ? "resize" : "move", id, start: point(event.clientX, event.clientY),
          original: { x: node.x, y: node.y, width: node.width, height: node.height },
          origins: [...selected].flatMap(nodeId => {
            const member = state.graph.nodes[nodeId];
            return member ? [{ id: nodeId, x: member.x, y: member.y }] : [];
          }), moved: false
        };
        for (const member of gesture.type === "move" ? gesture.origins : [{ id }])
          views.get(member.id)?.element.classList.add("dragging");
        root.focus({ preventScroll: true });
      }
      if (gesture) { event.preventDefault(); root.setPointerCapture(event.pointerId); gesture.pointer = event.pointerId; }
    });
    root.addEventListener("pointermove", event => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const at = point(event.clientX, event.clientY), dx = at.x - gesture.start.x, dy = at.y - gesture.start.y;
      if (gesture.type === "marquee") {
        const left = Math.min(at.x, gesture.start.x), right = Math.max(at.x, gesture.start.x);
        const top = Math.min(at.y, gesture.start.y), bottom = Math.max(at.y, gesture.start.y);
        const rect = board.getBoundingClientRect();
        Object.assign(marquee.style, { left: Math.min(event.clientX, gesture.clientX) - rect.left + "px",
          top: Math.min(event.clientY, gesture.clientY) - rect.top + "px",
          width: Math.abs(event.clientX - gesture.clientX) + "px", height: Math.abs(event.clientY - gesture.clientY) + "px" });
        marquee.hidden = false; selected.clear(); selectedEdges.clear();
        for (const node of Object.values(state.graph.nodes))
          if (node.x < right && node.x + node.width > left && node.y < bottom && node.y + node.height > top) selected.add(node.id);
        for (const path of svg.querySelectorAll("path.wire:not(.temporary)")) {
          const length = path.getTotalLength();
          for (let offset = 0; offset <= 24; offset++) {
            const p = path.getPointAtLength(length * offset / 24);
            if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) { selectedEdges.add(path.dataset.edge); break; }
          }
          path.classList.toggle("selected", selectedEdges.has(path.dataset.edge));
        }
        for (const [id, view] of views) view.element.classList.toggle("selected", selected.has(id));
        gesture.moved = true; return;
      }
      if (!gesture.moved && Math.hypot(dx, dy) > 2) {
        if (gesture.type !== "connect") checkpoint();
        gesture.moved = true;
      }
      if (gesture.type === "connect") { gesture.cursor = at; drawWires(); return; }
      if (!gesture.moved) return;
      const node = state.graph.nodes[gesture.id], view = views.get(gesture.id);
      if (!node || !view) return;
      if (gesture.type === "move") {
        for (const original of gesture.origins) {
          const member = state.graph.nodes[original.id], memberView = views.get(original.id);
          if (!member || !memberView) continue;
          member.x = original.x + dx; member.y = original.y + dy;
          position(memberView, member);
        }
      } else {
        node.width = Math.max(240, gesture.original.width + dx);
        node.height = Math.max(node.kind === "cutout" ? 86 : 150, gesture.original.height + dy);
        position(view, node);
      }
      drawWires();
    });
    function finishGesture(event) {
      if (!gesture || (event && gesture.pointer !== event.pointerId)) return;
      const current = gesture; gesture = null;
      if (root.hasPointerCapture(current.pointer)) root.releasePointerCapture(current.pointer);
      views.get(current.id)?.element.classList.remove("dragging");
      for (const original of current.origins || []) views.get(original.id)?.element.classList.remove("dragging");
      if (current.type === "marquee") { marquee.hidden = true; return; }
      if (current.type === "connect") {
        if (current.moved && event && event.type !== "pointercancel") {
          let hit = shadow.elementFromPoint(event.clientX, event.clientY)?.closest(".input");
          if (!hit) hit = [...shadow.querySelectorAll(".port.input")].find(port => {
            const rect = port.getBoundingClientRect();
            return event.clientX >= rect.left - rect.width && event.clientX <= rect.right + rect.width &&
              event.clientY >= rect.top - rect.height && event.clientY <= rect.bottom + rect.height;
          });
          if (hit) connect(current.id, hit.closest(".node").dataset.node);
        } else if (!current.moved) pendingOutput = current.id;
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      } else if (current.moved) persist();
      drawWires();
    }
    root.addEventListener("pointerup", finishGesture);
    root.addEventListener("pointercancel", finishGesture);
    window.addEventListener("blur", () => finishGesture());
    shadow.addEventListener("wheel", event => {
      if (event.target.closest("textarea,select,.node-body")) return;
      event.preventDefault();
      board.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey
      }));
    }, { passive: false });
    board.addEventListener("contextmenu", event => {
      if (disconnectSelected()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const nativeCard = event.target.closest(".card");
      if (nativeCard && !state?.graph.legacyIds.includes(nativeCard.dataset.id)) return;
      event.preventDefault(); event.stopImmediatePropagation(); showMenu(event.clientX, event.clientY);
    }, true);
    shadow.addEventListener("contextmenu", event => {
      if (disconnectSelected()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    shadow.addEventListener("contextmenu", event => {
      if (event.target.closest(".node")) return;
      event.preventDefault(); showMenu(event.clientX, event.clientY);
    });
    document.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (!event.composedPath().includes(menu)) menu.hidden = true;
      if (state && board.contains(event.target) && !event.target.closest(".card,button,input,textarea,select") &&
          !event.composedPath().includes(root)) {
        select(null); pendingOutput = null;
        gesture = { type: "marquee", start: point(event.clientX, event.clientY),
          clientX: event.clientX, clientY: event.clientY, pointer: event.pointerId, moved: false };
        root.setPointerCapture(event.pointerId); root.focus({ preventScroll: true });
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (!event.composedPath().includes(root)) { menu.hidden = true; pendingOutput = null; select(null); }
    }, true);
    document.addEventListener("pointermove", event => {
      const rect = board.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
        lastPoint = point(event.clientX, event.clientY);
    }, { passive: true });
    document.addEventListener("paste", event => {
      const path = event.composedPath();
      if (!path.includes(root) && !board.contains(event.target) && event.target !== document.body && event.target !== document) return;
      const files = [...event.clipboardData?.items || []].filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile()).filter(Boolean);
      const editable = path.some(element => ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName) || element?.isContentEditable);
      if (editable && !files.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void pasteContent(event.clipboardData?.getData("text/plain") || "", files).catch(error => say(error.message));
    }, true);
    document.addEventListener("copy", event => {
      const path = event.composedPath();
      if (!path.includes(root) || path.some(element => ["INPUT", "TEXTAREA"].includes(element?.tagName))) return;
      const value = copyPayload(); if (!value) return;
      event.preventDefault(); event.stopImmediatePropagation();
      event.clipboardData.setData("text/plain", clipboardMarker + JSON.stringify(value));
    }, true);
    document.addEventListener("keydown", event => {
      const path = event.composedPath(), key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || !["c", "v"].includes(key) || path.includes(root)) return;
      if (path.some(element => ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName) || element?.isContentEditable)) return;
      if (!state || (event.target !== document.body && event.target !== document && !board.contains(event.target))) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (key === "v") void pasteClipboard(); else void copyCards();
    }, true);
    document.addEventListener("mw3:key", event => {
      const key = JSON.parse(event.detail);
      if (key.key === "Escape") {
        const dialog = [...shadow.querySelectorAll("dialog[open]")].at(-1);
        if (dialog) dialog.close(); else { menu.hidden = true; pendingOutput = null; finishGesture(); select(null); }
      } else if (key.key === "Delete" || key.key === "Backspace") deleteSelection();
      else if (key.ctrl && key.key.toLowerCase() === "c") void copyCards();
      else if (key.ctrl && key.key.toLowerCase() === "v") void pasteClipboard();
      else if (key.ctrl && key.key.toLowerCase() === "d" && selected.size) duplicate([...selected][0]);
      else if (key.ctrl && ["z", "y"].includes(key.key.toLowerCase())) history(key.shift || key.key.toLowerCase() === "y");
    });
    const hostChanges = new MutationObserver(() => { align(); void context(); });
    hostChanges.observe(nativeWorld, { attributes: true, attributeFilter: ["style"], childList: true });
    new ResizeObserver(align).observe(board);
    const themeChanges = new MutationObserver(() => {
      void rpc("theme", {}).then(values => { for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value); }).catch(() => {});
    });
    themeChanges.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    void rpc("theme", {}).then(values => { for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value); }).catch(error => say(error.message));
    const selector = document.getElementById("canvases");
    selector?.addEventListener("change", context);
    if (selector) new MutationObserver(context).observe(selector, { childList: true });
    let templatePrototype;
    function syncWorkflowCatalog() {
      const dialog = document.querySelector(".workflow-template-dialog");
      if (dialog?.dataset.mwPreview) return;
      const nav = dialog?.querySelector(".template-categories"), body = dialog?.querySelector(".workflow-template-body");
      if (!nav || !body || body.getAttribute("aria-busy") === "true") return;
      const sample = body.querySelector(".workflow-template-row:not([data-mw-template])");
      if (sample) templatePrototype = sample.cloneNode(true);
      if (!templatePrototype) return;
      if (!nav.querySelector("[data-mw-category]")) {
        const tab = nav.firstElementChild.cloneNode(true); tab.textContent = "我的工作流";
        tab.dataset.mwCategory = "true"; tab.removeAttribute("id"); tab.disabled = false; tab.setAttribute("aria-pressed", "false");
        tab.addEventListener("click", () => {
          delete dialog.dataset.mwPreview; body.querySelector("[data-mw-preview]")?.remove();
          dialog.dataset.mwCategory = "mine";
          for (const item of nav.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === tab));
          syncWorkflowCatalog();
        });
        nav.append(tab);
        nav.addEventListener("click", event => {
          const item = event.target.closest("button");
          if (item && !item.dataset.mwCategory) {
            delete dialog.dataset.mwPreview; body.querySelector("[data-mw-preview]")?.remove();
            dialog.dataset.mwCategory = item.textContent.trim(); syncWorkflowCatalog();
          }
        });
        dialog.querySelector(".template-search")?.addEventListener("input", () => syncWorkflowCatalog());
      }
      let group = body.querySelector("[data-mw-workflow-list]");
      if (!group) {
        group = document.createElement("section"); group.dataset.mwWorkflowList = "true";
        const heading = document.createElement("h3"); heading.textContent = "我的工作流";
        const grid = document.createElement("div"); grid.className = "template-grid";
        for (const [key, name] of [["standard", "标准生图"], ["iterative", "迭代生图"], ["bbox", "BBox 工作流"]]) {
          const card = templatePrototype.cloneNode(true); card.dataset.mwTemplate = key; card.dataset.templateId = "mw-" + key;
          card.querySelector(".template-card-heading strong").textContent = name;
          card.querySelector(".template-card-heading strong").title = name;
          card.querySelector(".template-more")?.remove();
          card.querySelector(".template-description").textContent = key === "iterative" ? "批量生图 → AI 理解微调 → 逐版修改 · AI 命名" : key === "standard" ?
            "提示词 → 生图 → 透明化 → 展示" : "识别预排 → 生图 → 透明化 → 切图 → UI 组装";
          const graph = P.template(key);
          const metadata = card.querySelector(".template-card-metadata"); metadata.replaceChildren();
          const count = document.createElement("small"); count.textContent = graph.nodes.length + " 张卡片 · 本地";
          metadata.append(count);
          const covers = card.querySelector(".template-previews"); covers.replaceChildren();
          const figure = document.createElement("figure"), cover = document.createElement("div"); cover.className = "template-cover";
          const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 300; canvas.style.width = "100%";
          const ctx = canvas.getContext("2d"), width = Math.max(...graph.nodes.map(node => node.x + 340));
          const height = Math.max(...graph.nodes.map(node => node.y + 280)), scale = Math.min(600 / width, 260 / height);
          ctx.translate(20, 20); ctx.scale(scale, scale); ctx.lineWidth = 3 / scale;
          for (const edge of graph.edges) {
            const a = graph.nodes.find(node => node.id === edge.from), b = graph.nodes.find(node => node.id === edge.to);
            ctx.strokeStyle = "#d7b56d"; ctx.beginPath(); ctx.moveTo(a.x + 300, a.y + 65); ctx.lineTo(b.x, b.y + 65); ctx.stroke();
          }
          for (const node of graph.nodes) {
            ctx.fillStyle = "#20272b"; ctx.fillRect(node.x, node.y, 300, 130); ctx.strokeStyle = "#62a8ff"; ctx.strokeRect(node.x, node.y, 300, 130);
            ctx.fillStyle = "#edf0ed"; ctx.font = "24px sans-serif"; ctx.fillText(G.TYPES[node.kind].title, node.x + 12, node.y + 55);
          }
          cover.append(canvas); figure.append(cover); covers.append(figure);
          const add = card.querySelector(".template-add"); add.disabled = false; add.textContent = "＋ 添加";
          add.onclick = () => { insertTemplate(graph, name); dialog.close(); };
          const preview = card.querySelector(".template-preview"); preview.disabled = false;
          preview.onclick = () => {
            dialog.dataset.mwPreview = "true";
            const originals = [...body.children].map(element => [element, element.hidden]);
            for (const [element] of originals) element.hidden = true;
            const panel = document.createElement("div"); panel.className = "workflow-template-row"; panel.dataset.mwPreview = "true";
            const heading = document.createElement("strong"); heading.textContent = name;
            const large = document.createElement("canvas"); large.width = canvas.width; large.height = canvas.height;
            large.getContext("2d").drawImage(canvas, 0, 0); large.style.width = "100%";
            const back = preview.cloneNode(true); back.textContent = "返回模板";
            back.onclick = () => {
              panel.remove(); delete dialog.dataset.mwPreview;
              for (const [element, hidden] of originals) element.hidden = hidden;
              syncWorkflowCatalog();
            };
            panel.append(heading, large, back); body.append(panel);
          };
          grid.append(card);
        }
        group.append(heading, grid); body.append(group);
      }
      const category = dialog.dataset.mwCategory || nav.querySelector('[aria-pressed="true"]')?.textContent.trim() || "全部";
      const mine = category === "mine", all = category === "全部";
      if (mine) for (const item of nav.querySelectorAll("button"))
        item.setAttribute("aria-pressed", String(Boolean(item.dataset.mwCategory)));
      for (const child of body.children) if (child !== group) child.hidden = mine;
      group.hidden = !mine && !all;
      const query = dialog.querySelector(".template-search")?.value.trim().toLowerCase() || "";
      for (const card of group.querySelectorAll("[data-mw-template]"))
        card.hidden = !card.querySelector(".template-card-heading strong").textContent.toLowerCase().includes(query);
    }
    const templateEntries = new MutationObserver(syncWorkflowCatalog);
    templateEntries.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => {
      for (const token of [...runs.values()]) cancelRun(token.node, token.state, token);
      for (const target of states.values()) {
        clearTimeout(target.timer);
        void chrome.storage.local.set({ [key(target.id)]: target.graph });
      }
    });
    align(); void context();
    return true;
  }
  if (!boot()) {
    const observer = new MutationObserver(() => { if (boot()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
