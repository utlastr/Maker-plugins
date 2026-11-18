(() => {
  const references = ["references", "results"];
  const stage = (title, action, config = {}) => ({ title, action, accepts: references, output: "references", size: [300, 230], config });
  const types = {
    compress: stage("图片压缩", "compress", { maxBytes: 1800000 }),
    bbox: stage("BBox 识别预排", "bbox", { background: true, artText: [] }),
    uiBuild: stage("UI 组装", "uiBuild"),
    prepare: stage("原稿与识图输入", "prepare"),
    recognize: stage("去文字与元素识别", "recognize"),
    batch: stage("批次编排", "plan", { background: true, artText: [] }),
    prelayout: stage("BBox 预排", "prelayout"),
    separate: stage("分离生图", "separate"),
    slice: stage("切图", "slice"),
    elementCut: stage("元件裁切", "elementCut"),
    review: stage("素材确认", "review"),
    bundle: stage("UI 资源包", "bundle"),
    assemble: stage("组装 UI", "assemble"),
    meta: stage("资源 Meta", "meta"),
    check: stage("引用检查", "check"),
    editor: stage("编辑器复核", "editor")
  };
  function template(name) {
    const nodes = [], edges = [];
    const add = (id, kind, x, y) => { nodes.push({ id, kind, x, y }); return id; };
    const link = (from, to) => edges.push({ from, to });
    if (name === "standard" || name === "iterative") {
      add("prefix", "prefix", 0, 0); add("tasks", "tasks", 0, 250);
      add("reference", "reference", 0, 550); add("compress", "compress", 350, 550);
      add("generate", "generate", 720, 180); add("cutout", "cutout", 1120, 180); add("display", "display", 1450, 180);
      for (const source of ["prefix", "tasks", "compress"]) link(source, "generate");
      link("reference", "compress"); link("generate", "cutout"); link("cutout", "display");
      if (name === "iterative") { add("refine", "refine", 350, 150); link("refine", "generate"); }
    } else {
      const kinds = ["reference", "compress", "bbox", "generate", "cutout", "slice", "display", "uiBuild"];
      kinds.forEach((kind, index) => {
        add("step-" + index, kind, (index % 4) * 370, Math.floor(index / 4) * 320);
        if (index) link("step-" + (index - 1), "step-" + index);
      });
    }
    return { nodes, edges };
  }
  async function execute({ node, images, rpc, native, previous, save, canceled }) {
    const first = images[0], context = first?.workflow || {};
    if (!first) return [];
    const call = (operation, value) => native(operation, value);
    const output = (items, extra = {}) => items.map(image => ({ ...image, state: "succeeded", workflow: { ...context, ...image.workflow, ...extra } }));
    switch (node.kind) {
      case "elementCut": {
        const record = previous || { sources: {} }; record.sources ||= {};
        const results = [];
        for (const image of images) {
          if (canceled()) break;
          const item = record.sources[image.path] ||= { requestId: crypto.randomUUID() }; save(record);
          if (!item.image) {
            item.image = await rpc("pipeline-normalize", { image }); save(record);
          }
          if (!item.elements) {
            const found = await call("detect-elements", { requestId: item.requestId, image: item.image });
            item.elements = found.elements; save(record);
          }
          if (canceled()) break;
          if (!item.output) {
            item.output = await rpc("element-crop", { image: item.image, elements: item.elements }, 180000); save(record);
          }
          results.push(...item.output);
        }
        return results;
      }
      case "bbox":
      case "uiBuild": {
        await call("health", {});
        const record = previous || { steps: {} }; record.steps ||= {};
        let current = images;
        const kinds = node.kind === "bbox" ? ["prepare", "recognize", "batch", "prelayout"] : ["bundle", "assemble", "meta", "check", "editor"];
        for (const kind of kinds) {
          if (canceled()) break;
          const signature = JSON.stringify([kind === "batch" ? node.config : {}, current.map(image => [image.path, image.workflow])]);
          const step = record.steps[kind] ||= {};
          record.stage = types[kind].title; save(record);
          if (step.signature === signature && step.images) { current = step.images; continue; }
          current = await execute({ node: { ...node, kind }, images: current, rpc, native, previous: step.payload,
            save: value => { step.payload = value; save(record); }, canceled });
          if (!current.length) return [];
          step.images = current; step.signature = signature; save(record);
        }
        return current;
      }
      case "compress": return output(await Promise.all(images.map(image => rpc("pipeline-compress", { image, maxBytes: node.config.maxBytes }))));
      case "prepare": {
        const image = await rpc("pipeline-normalize", { image: first });
        return output([image], { original: context.original || first, design: image });
      }
      case "recognize": {
        const record = previous || {};
        if (!record.textFree) {
          record.request ||= crypto.randomUUID(); save(record);
          const prompt = "保留参考图的全部布局、底板、图标、边框和背景，仅移除所有文字与数字字形，补齐其后被遮挡的底图。不移动、不缩放、不增加任何元素。";
          let value;
          if (record.textSubmitted) value = await rpc("query", { attempt: record.textAttempt, prompt, submittedAt: record.textSubmittedAt }, 360000);
          else {
            record.textSubmitted = true; record.textSubmittedAt = Date.now(); save(record);
            value = await rpc("generate", { prompt,
              parameters: { model: "auto", resolution: "2K", aspectRatio: "source" }, images: [first], request: record.request }, 540000);
          }
          record.textAttempt = value.id; save(record);
          let result = value;
          while (["pending", "running"].includes(result.status) && result.id && !canceled()) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            result = await rpc("query", { attempt: result.id }, 360000);
          }
          if (result.status !== "succeeded") throw new Error("去文字请求尚未确认：" + (result.error || result.status));
          record.textFree = await rpc("pipeline-compress", { image: { path: result.resultAssetPath || result.deliveredAssetPath, name: "去文字图" }, maxBytes: 1800000 });
          save(record);
        }
        record.recognitionId ||= crypto.randomUUID(); save(record);
        let result = await call("recognize", { design: context.design || first, original: context.original, cut: record.textFree, requestId: record.recognitionId, nodeId: node.id });
        for (let count = 0; count < 100 && ["running", "unknown"].includes(result.status) && !canceled(); count++) {
          if (result.status === "unknown") throw new Error(result.error || "识图结果未知；再次运行将查询原请求。");
          await new Promise(resolve => setTimeout(resolve, 2500));
          result = await call("recognize", { design: context.design || first, original: context.original, cut: record.textFree, requestId: record.recognitionId, nodeId: node.id });
        }
        if (result.status !== "succeeded" || !result.bbox) throw new Error(result.error || "两轮识图未完成。");
        return output([record.textFree], { design: context.design || first, bbox: result.bbox });
      }
      case "batch": {
        if (!context.bbox) return [];
        const result = await call("plan", { bbox: context.bbox, ...node.config });
        return output([first], { batches: result.plans });
      }
      case "prelayout": {
        if (!context.batches?.length) return [];
        const results = [];
        for (const batch of context.batches) {
          if (canceled()) break;
          const image = await call("prelayout", { plan: batch.plan });
          results.push({ ...image, name: batch.category + " · " + (results.length + 1), workflow: { ...context, batches: undefined, ...batch } });
        }
        return output(results);
      }
      case "separate": {
        const record = previous || { completed: {} }; record.completed ||= {};
        const results = [];
        for (const image of images) {
          if (canceled()) break;
          const info = image.workflow || {}, key = image.path;
          const item = record.completed[key] ||= { request: crypto.randomUUID() }; save(record);
          if (!item.result) {
            let value;
            if (item.attempt) value = await rpc("query", { attempt: item.attempt }, 360000);
            else {
              if (item.submitted) throw new Error("上次分离请求结果未确认，请先查询，未重复提交。");
              item.submitted = true; save(record);
              value = await rpc("generate", { prompt: info.prompt, images: [image],
                parameters: { model: "auto", resolution: "2K", aspectRatio: "source" }, request: item.request }, 540000);
            }
            item.attempt = value.id; save(record);
            while (["pending", "running"].includes(value.status) && value.id && !canceled()) {
              await new Promise(resolve => setTimeout(resolve, 2500));
              value = await rpc("query", { attempt: value.id }, 360000); item.attempt = value.id; save(record);
            }
            if (value.status !== "succeeded") throw new Error(value.error || "分离结果未确认。");
            item.result = { path: value.resultAssetPath || value.deliveredAssetPath, name: image.name, workflow: info }; save(record);
          }
          results.push(item.result);
        }
        return output(results);
      }
      case "slice": {
        const result = [];
        for (const image of images) result.push(...await rpc("pipeline-slice", { image }, 120000));
        return output(result);
      }
      case "review": return output(images, { reviewed: true });
      case "bundle": {
        if (!context.bbox || !images.some(image => image.slot)) return [];
        return output([first], await call("bundle", { bbox: context.bbox, images }));
      }
      case "assemble": return context.bundlePath ? output([first], await call("assemble", context)) : [];
      case "meta": {
        const result = await call("meta", context);
        if (result.success === false) throw new Error("官方 Meta 生成器未完成。");
        return output([first], { meta: result });
      }
      case "check": return output([first], await call("check", context));
      case "editor": {
        const result = await rpc("pipeline-editor", { file: context.file });
        return output([first], { editorUrl: result.url, visualReview: "pending" });
      }
    }
    throw new Error("未知工作流步骤。");
  }
  globalThis.MakerPipeline = { types, template, execute, basic: ["generate", "refine", "reference", "display", "tasks", "prefix", "cutout", "elementCut", "compress"], bbox: ["bbox", "slice", "uiBuild"] };
})();
