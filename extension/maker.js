(() => {
  if (location.pathname !== "/canvas" || globalThis.__makerWorkflowBridge3) return;
  globalThis.__makerWorkflowBridge3 = true;
  const project = new URLSearchParams(location.search).get("project");
  if (!/^[a-f0-9]{64}$/i.test(project || "")) return;
  const reply = value => document.dispatchEvent(new CustomEvent("mw3:reply", { detail: JSON.stringify(value) }));
  const originalFetch = window.fetch.bind(window), owned = new Set(), histories = new Map(), jobs = new Map();
  let releaseOwnership;
  const ownershipReady = new Promise(resolve => { releaseOwnership = resolve; });
  setTimeout(() => releaseOwnership(), 1500);
  document.addEventListener("mw3:ownership", event => {
    try { for (const id of JSON.parse(event.detail)) owned.add(id); } catch {}
    releaseOwnership();
  });
  function isOwned(record) {
    return owned.has(record.id) || /(?:^|\/)mw-owned-[a-f0-9-]{36}(?:[_./-]|$)/i.test(record.deliveredAssetPath || "");
  }
  function claim(record) {
    if (!record?.id) return;
    owned.add(record.id);
    document.dispatchEvent(new CustomEvent("mw3:attempt-owned", { detail: JSON.stringify({ id: record.id }) }));
  }
  // Native recovery must not create platform cards for results owned by this plugin.
  // Only the read-only history projection is filtered; generation requests stay untouched.
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    const match = url.pathname.match(new RegExp(`^/api/projects/${project}/canvases/([a-f0-9-]{36})/generation$`, "i"));
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!match || method !== "GET" || url.origin !== location.origin || !response.ok) return response;
    await ownershipReady;
    const records = await response.clone().json();
    if (!Array.isArray(records)) return response;
    histories.set(match[1], records);
    const visible = records.filter(record => !isOwned(record));
    if (visible.length === records.length) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    return new Response(JSON.stringify(visible), { status: response.status, statusText: response.statusText, headers });
  };
  let instance;
  function host() {
    if (!instance) {
      if (typeof createCanvasHost !== "function") throw new Error("Maker 官方接口尚未加载。");
      instance = createCanvasHost();
    }
    return instance;
  }
  function store() { return host().store; }
  async function history(canvas) {
    const before = histories.get(canvas);
    const records = await store().listGeneration(canvas);
    const latest = histories.get(canvas);
    return latest && latest !== before ? latest : records;
  }
  function ruleValue(selector, property, fallback) {
    let result = fallback;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) if (rule.selectorText?.split(",").some(part => part.trim() === selector))
          result = rule.style.getPropertyValue(property) || result;
      } catch {}
    }
    return result;
  }
  const actions = {
    snapshot: ({ canvas }) => store().load(canvas),
    async reconcile({ canvas, attempts }) {
      for (const id of attempts) owned.add(id);
      const [records, document] = await Promise.all([history(canvas), store().load(canvas)]);
      const mine = records.filter(isOwned);
      for (const record of mine) claim(record);
      return {
        records: mine,
        hiddenIds: document.nodes.filter(node => node.generation?.attemptId && owned.has(node.generation.attemptId)).map(node => node.id)
      };
    },
    async models({ references = false }) {
      return {
        catalog: await store().imageModels(references ? "edit_image" : "generate_image"),
        choices: canvasGenerationParameterChoices(true)
      };
    },
    async import({ canvas, data, type, name }) {
      const binary = atob(data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const { relativePath } = await store().importImage(canvas, bytes.buffer, type);
      return { path: relativePath, name, ...await store().imageInfo(relativePath) };
    },
    async "copy-image"({ canvas, sourceProject, image }) {
      if (!/^[a-f0-9]{64}$/i.test(sourceProject || "")) throw new Error("Invalid source project.");
      const response = await originalFetch(`/api/projects/${sourceProject}/canvas-media?path=${encodeURIComponent(image.path)}`);
      if (!response.ok) throw new Error("参考图片读取未完成。");
      const blob = await response.blob();
      const saved = await store().importImage(canvas, await blob.arrayBuffer(), blob.type || "image/png");
      return { ...image, path: saved.relativePath };
    },
    async "pipeline-normalize"({ canvas, image }) {
      const response = await originalFetch(store().mediaUrl(image.path));
      if (!response.ok) throw new Error("图片读取失败。");
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const surface = document.createElement("canvas"); surface.width = bitmap.width; surface.height = bitmap.height;
        surface.getContext("2d").drawImage(bitmap, 0, 0);
        const png = await new Promise(resolve => surface.toBlob(resolve, "image/png"));
        if (!png) throw new Error("PNG 转换失败。");
        const saved = await store().importImage(canvas, await png.arrayBuffer(), "image/png");
        return { ...image, path: saved.relativePath, width: bitmap.width, height: bitmap.height, bytes: png.size, state: "succeeded" };
      } finally { bitmap.close(); }
    },
    async "pipeline-compress"({ canvas, image, maxBytes = 1800000 }) {
      maxBytes = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0 ? Math.min(1999999, Number(maxBytes)) : 1800000;
      const response = await originalFetch(store().mediaUrl(image.path));
      if (!response.ok) throw new Error("图片读取失败。");
      const blob = await response.blob(), bitmap = await createImageBitmap(blob);
      try {
        const surface = document.createElement("canvas"), ctx = surface.getContext("2d", { willReadFrequently: true });
        let original = image.workflow?.original;
        if (!original) {
          original = { ...image, width: bitmap.width, height: bitmap.height };
          if (blob.type !== "image/png") {
            surface.width = bitmap.width; surface.height = bitmap.height; ctx.drawImage(bitmap, 0, 0);
            const png = await new Promise(resolve => surface.toBlob(resolve, "image/png"));
            const saved = await store().importImage(canvas, await png.arrayBuffer(), "image/png");
            original.path = saved.relativePath;
          }
        }
        let scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
        for (let round = 0; round < 24; round++) {
          surface.width = Math.max(1, Math.round(bitmap.width * scale));
          surface.height = Math.max(1, Math.round(bitmap.height * scale));
          ctx.drawImage(bitmap, 0, 0, surface.width, surface.height);
          if (round > 0) {
            const pixels = ctx.getImageData(0, 0, surface.width, surface.height), step = round < 3 ? 8 : 16;
            for (let i = 0; i < pixels.data.length; i += 4)
              for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = Math.round(pixels.data[i + channel] / step) * step;
            ctx.putImageData(pixels, 0, 0);
          }
          const png = await new Promise(resolve => surface.toBlob(resolve, "image/png"));
          if (png && png.size < maxBytes) {
            const saved = await store().importImage(canvas, await png.arrayBuffer(), "image/png");
            return { ...image, path: saved.relativePath, width: surface.width, height: surface.height, bytes: png.size, state: "succeeded",
              workflow: { ...image.workflow, original,
                scaleX: surface.width / bitmap.width, scaleY: surface.height / bitmap.height } };
          }
          if (round >= 2) scale *= .82;
        }
        throw new Error("无法压缩到目标体积；未传入超限文件。");
      } finally { bitmap.close(); }
    },
    async "pipeline-slice"({ canvas, image }) {
      const info = image.workflow, plan = info?.plan;
      if (plan?.standalone) {
        const dimensions = await store().imageInfo(image.path);
        const slot = plan.slots[0];
        return [{ ...image, ...dimensions, slot, state: "succeeded",
          workflow: { ...info, plan: undefined, batches: undefined, prompt: undefined, slot } }];
      }
      if (typeof prepareImageAtlas !== "function" || typeof encodeImageAtlasRegions !== "function")
        throw new Error("当前 Maker 未提供官方切图算法。");
      if (!plan) return [];
      const response = await originalFetch(store().mediaUrl(image.path));
      if (!response.ok) throw new Error("图集读取失败。");
      let blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        if (plan.nativeLayout && (bitmap.width !== plan.nativeLayout.width || bitmap.height !== plan.nativeLayout.height)) {
          const surface = document.createElement("canvas"); surface.width = plan.nativeLayout.width; surface.height = plan.nativeLayout.height;
          surface.getContext("2d").drawImage(bitmap, 0, 0, surface.width, surface.height);
          blob = await new Promise(resolve => surface.toBlob(resolve, "image/png"));
        }
      } finally { bitmap.close(); }
      const cut = plan.nativeLayout ?
        { mode: "grid", regions: plan.nativeLayout.regions, manualNative: true, allowEmpty: true } :
        { allowEmpty: true };
      const prepared = await prepareImageAtlas(blob, plan.grid, undefined, "all", cut, plan);
      const encoded = await encodeImageAtlasRegions(prepared);
      const items = Array.isArray(encoded) ? encoded : encoded.items;
      const output = [];
      for (const [index, item] of items.entries()) {
        const slot = plan.slots[index];
        if (!slot || slot.role === "reserve") continue;
        const saved = await store().importImage(canvas, await item.blob.arrayBuffer(), "image/png");
        output.push({ path: saved.relativePath, width: item.width, height: item.height, contentRect: item.contentRect,
          name: (slot.elementIds[0] || info.category) + " · " + slot.state, state: "succeeded",
          slot, workflow: { ...info, plan: undefined, batches: undefined, prompt: undefined, slot, alignmentWarning: prepared.alignmentWarning } });
      }
      return output;
    },
    "pipeline-editor"({ file }) {
      if (!file || typeof store().uiEditorUrl !== "function") throw new Error("尚未生成 UI 文件。");
      return { url: store().uiEditorUrl(file) };
    },
    "pipeline-export"({ context }) {
      if (!context.assets?.length) throw new Error("资源包尚未生成。");
      return host().deliverExport({ filename: "Maker-UI-assets.zip", mime: "application/zip", async produce() {
        const entries = [];
        for (const asset of context.assets) {
          const response = await originalFetch(store().mediaUrl(asset.path));
          if (!response.ok) throw new Error("资源读取失败：" + asset.path);
          entries.push({ name: asset.path, blob: await response.blob() });
        }
        entries.push({ name: "manifest.json", blob: new Blob([JSON.stringify({
          bbox: context.bbox, assets: context.assets, bindings: context.bindings, artTextBindings: context.artTextBindings
        }, null, 2)], { type: "application/json" }) });
        if (context.ui) entries.push({ name: context.file, blob: new Blob([JSON.stringify(context.ui, null, 2)], { type: "application/json" }) });
        return createCanvasZip(entries);
      } });
    },
    async generate({ canvas, prompt, parameters, images, request }) {
      let submitted = false;
      const job = { canvas, prompt, createdAt: Date.now(), canceled: false, attempt: null };
      jobs.set(request, job);
      try {
        const paths = [...new Set(images.map(image => image.path))];
        const catalog = await store().imageModels(paths.length ? "edit_image" : "generate_image");
        if (catalog.provider.source === "local") throw new Error("当前来源为本地 AI，官方生图接口不可用。");
        const model = parameters.model === "auto" ? catalog.defaultModel : parameters.model;
        const choice = catalog.models.find(value => value.id === model);
        if (catalog.provider.source === "maker" && model && !choice) throw new Error("所选官方模型已不可用，请重新选择。");
        if (choice?.maxReferenceImages !== undefined && paths.length > choice.maxReferenceImages)
          throw new Error(`所选模型最多支持 ${choice.maxReferenceImages} 张参考图。`);
        const aspectRatio = parameters.aspectRatio === "source" && !paths.length ? "1:1" : parameters.aspectRatio;
        const original = aspectRatio === "source" && paths.length === 1 ? await store().imageInfo(paths[0]) : undefined;
        const size = resolveImageSize(aspectRatio, parameters.resolution, original);
        const input = {
          prompt, operation: "generate", provider: catalog.provider, name: "mw-owned-" + crypto.randomUUID(),
          model: catalog.provider.source === "maker" ? model : undefined,
          resolution: parameters.resolution, aspectRatio: size.aspectRatio,
          targetSize: size.targetSize, referenceImagePaths: paths
        };
        if (job.canceled) return { status: "canceled" };
        submitted = true;
        const record = await store().generateImage(canvas, input, AbortSignal.timeout(8 * 60 * 1000));
        claim(record); job.attempt = record.id;
        if (job.canceled) {
          await store().generationAction(canvas, record.id, "cancel").catch(() => {});
          return { id: record.id, status: "canceled" };
        }
        return record;
      } catch (error) {
        error.notSubmitted = !submitted || error.executionState === "not_executed";
        throw error;
      } finally {
        jobs.delete(request);
      }
    },
    async cancel({ request, canvas, attempt }) {
      const job = jobs.get(request);
      if (job) job.canceled = true;
      const id = attempt || job?.attempt;
      if (id) {
        await store().generationAction(canvas, id, "cancel");
        return { status: "canceled" };
      }
      // The original request retains its response so a late attempt ID can also be canceled.
      if (job) {
        const records = await history(canvas);
        const matches = records.filter(record => record.kind === "image" &&
          record.prompt?.trim() === job.prompt.trim() && Date.parse(record.createdAt) >= job.createdAt - 1000);
        if (matches.length === 1) {
          claim(matches[0]); job.attempt = matches[0].id;
          await store().generationAction(canvas, job.attempt, "cancel");
        }
      }
      return { status: "canceled" };
    },
    async cutout({ canvas, image }) {
      if (image.workflow?.category === "background") return { ...image, state: "succeeded", transparent: true };
      if (typeof createBackgroundRemoval !== "function") throw new Error("当前 Maker 未提供官方透明化程序。");
      const response = await originalFetch(store().mediaUrl(image.path));
      if (!response.ok) throw new Error("图片读取失败。");
      const blob = await response.blob(), removal = createBackgroundRemoval();
      const detected = await removal.identify(blob);
      if (!detected) {
        const bitmap = await createImageBitmap(blob);
        try {
          const surface = document.createElement("canvas"); surface.width = bitmap.width; surface.height = bitmap.height;
          const context = surface.getContext("2d", { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
          let clear = false, visible = false;
          for (let i = 3; i < pixels.length; i += 4) {
            clear ||= pixels[i] === 0; visible ||= pixels[i] > 0;
            if (clear && visible) return { ...image, state: "succeeded", transparent: true };
          }
        } finally { bitmap.close(); }
        throw new Error("未识别到纯色背景，未改变原图。");
      }
      const defaults = typeof CANVAS_BACKGROUND_DEFAULTS === "undefined" ?
        { tolerance: 32, softness: 24, despill: .5, mode: "connected" } : CANVAS_BACKGROUND_DEFAULTS;
      const result = await removal.apply(blob, { ...defaults, ...(image.workflow?.plan ? { mode: "all", tolerance: 48, softness: 16, edgeDespill: true } : {}),
        automatic: false, color: detected.color });
      const bitmap = await createImageBitmap(result.blob);
      let transparent = false, visible = false;
      try {
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] < 255) transparent = true;
          if (data[index] > 0) visible = true;
          if (transparent && visible) break;
        }
      } finally { bitmap.close(); }
      if (!transparent || !visible) throw new Error("去背景结果没有有效的透明前景，未输出原图。");
      const saved = await store().importImage(canvas, await result.blob.arrayBuffer(), "image/png");
      return { ...image, path: saved.relativePath, name: (image.name || "图片").replace(/\.[^.]+$/, "") + "-透明",
        transparent: true, sourcePath: image.path, state: "succeeded", ...await store().imageInfo(saved.relativePath) };
    },
    async query({ canvas, attempt, prompt, submittedAt }) {
      const records = await history(canvas);
      if (!attempt) {
        const matches = records.filter(record =>
          record.kind === "image" && record.prompt?.trim() === prompt?.trim() &&
          Number.isFinite(submittedAt) && Date.parse(record.createdAt) >= submittedAt - 1000);
        if (matches.length !== 1) return { status: "unknown" };
        attempt = matches[0].id;
      }
      let record = records.find(value => value.id === attempt);
      if (!record) return { id: attempt, status: "unknown" };
      if (record.kind === "video")
        record = await store().generationAction(canvas, attempt, "query", AbortSignal.timeout(5 * 60 * 1000));
      else if (record.remoteStatus === "succeeded" && record.failureStage === "download" &&
          (record.deliveredAssetPath || record.remoteAssetUrl || record.cachedImage))
        record = await store().generationAction(canvas, attempt, "retry", AbortSignal.timeout(5 * 60 * 1000));
      claim(record);
      return record;
    },
    async download({ files, zip }) {
      if (!files.length) throw new Error("没有可下载的图片。");
      const filename = (file, index) => {
        const name = String(file.name || "image").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80);
        const extension = file.path.match(/\.(png|jpe?g|webp)$/i)?.[1].toLowerCase() || "png";
        return `${zip ? index + 1 + "-" : ""}${name.replace(/\.(png|jpe?g|webp)$/i, "")}.${extension}`;
      };
      const name = zip ? "Maker-图片结果.zip" : filename(files[0], 0);
      // Open the official save picker while the initiating click still has user activation.
      return host().deliverExport({
        filename: name,
        mime: zip ? "application/zip" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.webp$/i.test(name) ? "image/webp" : "image/png",
        async produce() {
          const entries = [];
          for (const [index, file] of files.entries()) {
            const response = await originalFetch(store().mediaUrl(file.path));
            if (!response.ok) throw new Error("官方图片文件读取失败。");
            entries.push({ name: filename(file, index), blob: await response.blob() });
          }
          return zip ? createCanvasZip(entries) : entries[0].blob;
        }
      });
    },
    paths({ nodes, edges }) {
      return edges.map(edge => {
        const from = nodes.find(node => node.id === edge.from), to = nodes.find(node => node.id === edge.to);
        if (!from || !to) return null;
        const start = { x: from.x + from.width, y: from.y + from.height / 2 };
        const end = { x: to.x, y: to.y + to.height / 2 };
        if (typeof canvasWebCurve === "function")
          return { id: edge.id, d: canvasWebCurve(start, end, 1, { x: 0, y: 0, scale: 1 }).d };
        // Same horizontal-tangent cubic used by Maker's web wire renderer.
        const reach = Math.min(200, Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) * 0.45));
        return {
          id: edge.id,
          d: `M ${start.x} ${start.y} C ${start.x + reach} ${start.y}, ${end.x - reach} ${end.y}, ${end.x} ${end.y}`
        };
      }).filter(Boolean);
    },
    theme() {
      const card = document.querySelector("#world > .canvas-card:not(.section):not(.selected)") ||
        document.querySelector("#world > .canvas-card:not(.section)");
      const header = card?.querySelector(".canvas-card-header"), title = card?.querySelector(".canvas-card-title");
      const menu = document.getElementById("canvas-context-menu");
      const computed = (element, property, fallback) => element ? getComputedStyle(element)[property] : fallback;
      return {
        "--mw-card-bg": computed(card, "backgroundColor", ruleValue(".card.canvas-card", "background", "#1b2125")),
        "--mw-card-border": computed(card, "border", ruleValue(".card.canvas-card", "border", "1px solid #475158")),
        "--mw-card-radius": computed(card, "borderRadius", ruleValue(".card.canvas-card", "border-radius", "9px")),
        "--mw-card-shadow": computed(card, "boxShadow", ruleValue(".card.canvas-card", "box-shadow", "0 3px 10px #0003")),
        "--mw-header-bg": computed(header, "backgroundColor", ruleValue(".canvas-card-header", "background", "#20272b")),
        "--mw-header-border": computed(header, "borderBottom", "1px solid #343d43"),
        "--mw-title-color": computed(title, "color", "#edf0ed"),
        "--mw-title-font": computed(title, "font", "600 12px/15px sans-serif"),
        "--mw-menu-bg": computed(menu, "backgroundColor", "#181c22"),
        "--mw-menu-border": computed(menu, "border", "1px solid #4b545d"),
        "--mw-menu-radius": computed(menu, "borderRadius", "8px"),
        "--mw-text": getComputedStyle(document.body).color,
        "--mw-wire": ruleValue(".wire", "stroke", "#d7b56d")
      };
    }
  };
  // Keep Maker's global keyboard shortcuts out of the independent node editor.
  window.addEventListener("keydown", event => {
    if (!event.composedPath().some(element => element?.id === "mw-workflow")) return;
    if (["+","=","-","0"].includes(event.key) &&
        event.composedPath().some(element => element?.classList?.contains("image-viewer"))) return;
    const editable = event.composedPath().some(element => ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName));
    const command = !editable && (["Delete", "Backspace", "Escape"].includes(event.key) ||
      ((event.ctrlKey || event.metaKey) && ["c", "v", "d", "z", "y"].includes(event.key.toLowerCase())));
    event.stopImmediatePropagation();
    if (command) {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("mw3:key", {
        detail: JSON.stringify({ key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey })
      }));
    }
  }, true);
  document.addEventListener("mw3:request", async event => {
    const { id, action, value } = JSON.parse(event.detail);
    if (!actions[action]) return;
    try { reply({ id, value: await actions[action](value) }); }
    catch (error) { reply({ id, error: error.message, notSubmitted: error.notSubmitted === true }); }
  });
})();
