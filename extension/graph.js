(function (root) {
  const TYPES = Object.freeze({
    ...(root.MakerPipeline?.types || {}),
    prefix: { title: "通用提示词", accepts: [], output: "prefix", size: [280, 210], config: { text: "" } },
    tasks: { title: "任务列表", accepts: [], output: "tasks", size: [300, 260], config: { text: "" } },
    refine: { title: "微调", accepts: [], output: "refinement", size: [300, 230], config: { text: "" } },
    reference: { title: "参考图片", accepts: [], output: "references", size: [300, 250], config: { images: [] } },
    cutout: { title: "透明化", accepts: ["results", "references"], output: "references", size: [250, 86], config: {} },
    generate: {
      title: "图片生成", accepts: ["prefix", "tasks", "references", "refinement"], output: "results", size: [340, 380],
      config: { prompt: "", model: "auto", resolution: "1K", aspectRatio: "1:1", images: [] }
    },
    display: { title: "图片展示", accepts: ["results", "references"], output: "references", size: [360, 320], config: {} }
  });
  function empty() { return { version: 3, nodes: {}, edges: [], runs: {}, history: {}, legacyIds: [] }; }
  function batches(graph, id) {
    graph.history ||= {};
    const list = graph.history[id] ||= [], current = graph.runs[id];
    if (current) {
      current.batchId ||= crypto.randomUUID();
      current.createdAt ||= Date.now();
      const saved = list.find(record => record.batchId === current.batchId);
      if (!saved) { current.sequence ||= list.length + 1; list.push(current); }
      else if (saved !== current) { Object.assign(saved, current); graph.runs[id] = saved; }
    }
    return list;
  }
  function beginBatch(graph, id) {
    const list = batches(graph, id);
    const record = { batchId: crypto.randomUUID(), sequence: list.length + 1, createdAt: Date.now(), running: true, items: [] };
    list.push(record); graph.runs[id] = record;
    return record;
  }
  function batchImages(record) {
    return (record?.items || []).map(item => ({ ...item, path: item.path || item.resultAssetPath || item.deliveredAssetPath }))
      .filter(item => item.path && item.state === "succeeded");
  }
  function previewOutput(graph, id, visited = new Set()) {
    if (visited.has(id)) return [];
    visited = new Set(visited); visited.add(id);
    const images = [...(graph.nodes[id]?.config.images || [])];
    for (const edge of incoming(graph, id)) {
      const node = graph.nodes[edge.from];
      if (node.kind === "display") images.push(...previewOutput(graph, node.id, visited));
      else if (node.kind === "generate") {
        const list = batches(graph, node.id);
        const record = [...list].reverse().find(value => batchImages(value).length);
        images.push(...batchImages(record).map(image => ({ ...image, source: node.id })));
      } else images.push(...sourceImages(graph, node.id, visited));
    }
    return uniqueImages(images);
  }
  function add(graph, id, kind, point) {
    const type = TYPES[kind];
    if (!type) throw new Error("不支持的卡片类型。");
    graph.nodes[id] = {
      id, kind, x: point.x, y: point.y, width: type.size[0], height: type.size[1],
      config: structuredClone(type.config)
    };
    return graph.nodes[id];
  }
  function connect(graph, from, to, id) {
    const source = graph.nodes[from], target = graph.nodes[to];
    if (!source || !target || !TYPES[target.kind].accepts.includes(TYPES[source.kind].output)) return false;
    if (from === to) return false;
    if (source.kind === "refine" && graph.edges.some(edge => edge.from === from && edge.to !== to)) return false;
    if (source.kind === "refine" && incoming(graph, to).some(edge => graph.nodes[edge.from].kind === "refine" && edge.from !== from)) return false;
    if (graph.edges.some(edge => edge.from === from && edge.to === to)) return;
    const visited = new Set();
    function reaches(node) {
      if (node === from) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      return graph.edges.filter(edge => edge.from === node).some(edge => reaches(edge.to));
    }
    if (reaches(to)) return false;
    graph.edges.push({ id, from, to });
  }
  function remove(graph, id) {
    delete graph.nodes[id];
    graph.edges = graph.edges.filter(edge => edge.from !== id && edge.to !== id);
  }
  function incoming(graph, id) {
    return graph.edges.filter(edge => edge.to === id && graph.nodes[edge.from]);
  }
  function taskLines(text) {
    return String(text || "").split(/\r\n?|\n/).map(line => line.trim()
      .replace(/^(?:(?:\d+|[一二三四五六七八九十百]+)[.．、:：)）]\s*|[（(](?:\d+|[一二三四五六七八九十百]+)[)）]\s*|[-*•]\s+)/, ""));
  }
  function tasks(text) {
    const lines = taskLines(text).filter(Boolean);
    return lines.map((line, index) => {
      const split = line.indexOf("|");
      const value = split > 0 ? { name: line.slice(0, split).trim(), prompt: line.slice(split + 1).trim() } :
        { name: `图片 ${index + 1}`, prompt: line };
      return value;
    }).filter(value => value.prompt);
  }
  function uniqueImages(images) {
    return [...new Map(images.filter(image => image?.path).map(image => [image.path, structuredClone(image)])).values()];
  }
  function plan(graph, id) {
    const node = graph.nodes[id];
    if (node?.kind !== "generate") throw new Error("请选择图片生成卡片。");
    const groups = { prefix: [], tasks: [], references: [], refinement: [] };
    for (const edge of incoming(graph, id)) groups[TYPES[graph.nodes[edge.from].kind].output].push(graph.nodes[edge.from]);
    const prefixes = groups.prefix.map(source => String(source.config.text || "").trim()).filter(Boolean);
    const externalTasks = groups.tasks.flatMap(source => tasks(source.config.text));
    const list = externalTasks.length ? externalTasks : [{ name: "图片", prompt: node.config.prompt.trim() }];
    const externalImages = groups.references.flatMap(source => sourceImages(graph, source.id));
    const images = externalImages.length ? externalImages : node.config.images;
    const atlasTasks = images.length && images.every(image => image.workflow?.plan) ? images.map(image => ({
      name: image.name, images: [image], workflow: image.workflow,
      prompt: [...prefixes, node.config.prompt.trim() || image.workflow.prompt].filter(Boolean).join("\n\n")
    })) : null;
    return {
      tasks: atlasTasks || list.map(task => ({ name: task.name, prompt: [...prefixes, task.prompt].filter(Boolean).join("\n\n") })),
      context: { prefixes, tasks: externalTasks, localPrompt: node.config.prompt },
      images: uniqueImages(images),
      parameters: { model: node.config.model, resolution: node.config.resolution,
        aspectRatio: atlasTasks ? "source" : node.config.aspectRatio }
    };
  }
  function refinementState(graph, id) {
    const node = graph.nodes[id];
    const generators = node?.kind === "refine"
      ? graph.edges.filter(edge => edge.from === id && graph.nodes[edge.to]?.kind === "generate").map(edge => edge.to)
      : [id];
    if (generators.length !== 1) return { ready: false, reason: "等待连接图片生成" };
    const generator = generators[0];
    const list = batches(graph, generator), batch = graph.runs[generator];
    if (list.some(record => record.running)) return { ready: false, generator, reason: "等待整批任务结束" };
    if (!batch?.items?.length) return { ready: false, generator, reason: "等待首批图片生成" };
    const completed = batch.items.filter(item => item.state === "succeeded" && (item.path || item.resultAssetPath || item.deliveredAssetPath)).length;
    if (completed !== batch.items.length) return { ready: false, generator, reason: `等待整批图片完成（${completed}/${batch.items.length}）` };
    if (batch.items.some(item => !item.prompt?.trim())) return { ready: false, generator, reason: "这批图片缺少原提示词，请先生成新批次" };
    return { ready: true, generator, batch, reason: `可微调整批 ${completed} 张图片` };
  }
  function refinementPlan(graph, id, refineId) {
    const status = refinementState(graph, refineId);
    if (!status.ready || status.generator !== id) throw new Error(status.reason || "微调尚不可用。");
    const instructions = graph.nodes[refineId].config.text.trim();
    if (!instructions) throw new Error("请填写微调内容。");
    const current = plan(graph, id);
    return {
      ...current, parentBatchId: status.batch.batchId, refinement: instructions, refineId,
      tasks: status.batch.items.map((item, index) => ({
        name: item.name, taskIndex: index, prompt: item.prompt, workflow: item.workflow,
        images: [{ path: item.path || item.resultAssetPath || item.deliveredAssetPath, name: item.name }],
        requestId: crypto.randomUUID(), sourceContext: status.batch.context
      }))
    };
  }
  function sourceImages(graph, id, visited = new Set()) {
    if (visited.has(id)) return [];
    visited = new Set(visited); visited.add(id);
    const node = graph.nodes[id];
    if (node?.kind === "display") {
      const images = uniqueImages(output(graph, id, visited));
      const reviewed = node.config.reviewSignature === reviewSignature(images);
      return images.map(image => image.workflow ? { ...image, workflow: { ...image.workflow, reviewed } } : image);
    }
    if (node?.kind === "reference") return (node.config.images || []).map(image => ({ ...image, source: id }));
    return (graph.runs[id]?.items || []).map(item => ({
      ...item, path: item.path || item.resultAssetPath || item.deliveredAssetPath
    })).filter(item => item.path && (item.state === "succeeded" ||
      (!item.state && (item.status === "succeeded" || graph.runs[id]?.status === "ready"))) &&
      (node?.kind !== "cutout" || item.transparent === true))
      .map(item => {
        if (node?.kind === "cutout" && !item.workflow?.plan) {
          const inputs = incoming(graph, id).flatMap(edge => sourceImages(graph, edge.from, visited));
          const original = inputs.find(image => image.path === item.sourcePath || item.inputKey?.endsWith(":" + image.path));
          if (original?.workflow) item.workflow = { ...original.workflow, ...item.workflow };
        }
        return { ...item, source: id };
      });
  }
  function output(graph, id, visited = new Set()) {
    const edges = incoming(graph, id);
    return uniqueImages([
      ...(graph.nodes[id]?.kind === "display" ? graph.nodes[id].config.images || [] : []),
      ...edges.flatMap(edge => sourceImages(graph, edge.from, visited))
    ]);
  }
  function inputImages(graph, id, preferred = []) {
    const connected = output(graph, id);
    if (connected.length) return connected;
    const own = uniqueImages(graph.nodes[id]?.config.images || []);
    if (own.length) return own;
    // Empty optional branches must not hide another available upstream image.
    const visited = new Set([id]);
    function upstream(nodeId) {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);
      const images = sourceImages(graph, nodeId);
      if (images.length) return images;
      if (!["reference", "display", "compress"].includes(graph.nodes[nodeId]?.kind)) return [];
      return incoming(graph, nodeId).flatMap(edge => upstream(edge.from));
    }
    const inherited = uniqueImages(incoming(graph, id).flatMap(edge => upstream(edge.from)));
    if (inherited.length) return inherited;
    // Do not replace an explicitly connected input while it is still producing images.
    if ([...visited].some(nodeId => graph.runs[nodeId]?.running)) return [];
    if ([...visited].some(nodeId => nodeId !== id &&
        !["reference", "display", "compress"].includes(graph.nodes[nodeId]?.kind))) return [];
    const references = Object.values(graph.nodes).filter(node => node.kind === "reference" && node.config.images?.length);
    const reference = references.find(node => preferred.includes(node.id)) || references.at(-1);
    return reference ? uniqueImages(sourceImages(graph, reference.id)) : [];
  }
  function restore(value) {
    const graph = value?.version === 3 ? structuredClone(value) : empty();
    for (const node of Object.values(graph.nodes)) if (node.kind === "generate") batches(graph, node.id);
    const records = new Set([...Object.values(graph.runs), ...Object.values(graph.history || {}).flat()]);
    for (const run of records) if (run.running) {
      run.running = false;
      for (const item of run.items || []) {
        if (item.state === "running") item.state = "unknown";
        else if (item.state === "queued") item.state = "canceled";
      }
    }
    return graph;
  }
  function migrate(value, document) {
    const graph = empty(), nativeNodes = new Map((document?.nodes || []).map(node => [node.id, node]));
    const oldNodes = value?.nodes || Object.fromEntries(Object.entries(value?.roles || {})
      .map(([id, kind]) => [id, { kind: kind === "batch" ? "tasks" : "prefix", config: {} }]));
    for (const [id, previous] of Object.entries(oldNodes)) {
      const native = nativeNodes.get(id);
      if (!native || !TYPES[previous.kind]) continue;
      const node = add(graph, id, previous.kind, { x: native.x, y: native.y });
      node.width = Math.max(node.width, native.width);
      node.height = Math.max(node.height, native.height);
      node.config = { ...node.config, ...structuredClone(previous.config || {}) };
      if (["prefix", "tasks"].includes(node.kind)) node.config.text = native.text === "便签" ? "" : native.text || "";
      if (node.kind === "reference" && native.assetPath)
        node.config.images = [{ path: native.assetPath, name: native.title || "参考图片" }];
      if (node.kind === "generate" && node.config.reference) {
        const image = nativeNodes.get(node.config.reference);
        node.config.images = image?.assetPath ? [{ path: image.assetPath, name: image.title }] : [];
        delete node.config.reference;
      }
      graph.legacyIds.push(id);
    }
    for (const [index, edge] of (value?.edges || value?.links || []).entries()) {
      const from = typeof edge.from === "string" ? edge.from : edge.from.node;
      const to = typeof edge.to === "string" ? edge.to : edge.to.node;
      if (!graph.nodes[to] && nativeNodes.has(to)) {
        const native = nativeNodes.get(to);
        add(graph, to, "generate", { x: native.x, y: native.y }); graph.legacyIds.push(to);
      }
      if (graph.nodes[from] && graph.nodes[to]) connect(graph, from, to, `migrated-${index}`);
    }
    graph.runs = structuredClone(value?.runs || value?.batches || {});
    return restore(graph);
  }
  function reviewSignature(images) {
    return JSON.stringify(images.map(image => [image.path, image.workflow?.bbox?.design?.sha256, image.workflow?.slot]));
  }
  const api = { TYPES, empty, add, connect, remove, incoming, taskLines, tasks, uniqueImages, plan, refinementState, refinementPlan, sourceImages, output, previewOutput, inputImages, batches, beginBatch, batchImages, restore, migrate, reviewSignature };
  root.MakerWorkflow = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
