(() => {
  if (location.origin !== "http://127.0.0.1:17840" || window !== window.top) return;
  const host = document.getElementById("ui-editor-view");
  if (!host) return;
  const observed = new WeakSet();
  function attach() {
    const frame = host.querySelector("iframe");
    if (!frame || observed.has(frame)) return;
    observed.add(frame);
    function install() {
      const doc = frame.contentDocument;
      if (!doc || !frame.contentWindow.location.pathname.startsWith("/ui-editor/")) return;
      function mount() {
        if (doc.getElementById("maker-import-ui")) return;
        const refresh = [...doc.querySelectorAll("button")].find(button =>
          [button.title, button.getAttribute("aria-label"), button.textContent.trim()].includes("刷新文件"));
        if (!refresh) return;
        const trigger = doc.createElement("button");
        trigger.id = "maker-import-ui";
        trigger.type = "button";
        trigger.className = refresh.className;
        trigger.textContent = "导入 JSON";
        refresh.after(trigger);
        const dialog = doc.createElement("dialog");
        const heading = doc.createElement("h3");
        heading.textContent = "导入 UI JSON";
        const path = doc.createElement("input");
        path.type = "text";
        path.placeholder = "粘贴文档路径";
        path.setAttribute("aria-label", "UI 文档路径");
        path.style.width = "min(420px, 65vw)";
        const file = doc.createElement("input");
        file.type = "file";
        file.accept = ".json";
        file.hidden = true;
        const result = doc.createElement("p");
        result.setAttribute("role", "status");
        function action(label, run) {
          const button = doc.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.onclick = run;
          return button;
        }
        const paste = action("导入路径", () => {
          if (path.value.trim()) void submit(path.value.trim());
          else path.focus();
        });
        const browse = action("选择本地文件", () => file.click());
        const open = action("打开导入的 UI", () => {});
        open.hidden = true;
        const close = action("关闭", () => dialog.close());
        dialog.append(heading, path, paste, browse, file, result, open, close);
        doc.body.append(dialog);
        path.onkeydown = event => { if (event.key === "Enter") paste.click(); };
        file.onchange = () => {
          const selected = file.files[0];
          file.value = "";
          if (selected) void submit(selected);
        };
        trigger.onclick = () => { dialog.showModal(); path.focus(); };
        let busy = false;
        async function submit(source) {
          if (busy) return;
          busy = true;
          paste.disabled = browse.disabled = true;
          open.hidden = true;
          result.textContent = "正在导入…";
          try {
            const project = new URLSearchParams(frame.contentWindow.location.search).get("project");
            const query = new URLSearchParams({ target: project || "" });
            const byPath = typeof source === "string";
            if (byPath) query.set("mode", "path");
            else {
              if (!/\.ui\.json$/i.test(source.name)) throw new Error("请选择 .ui.json 文件。");
              if (source.size > 4 * 1024 * 1024) throw new Error("UI JSON 超过 4 MB。");
              query.set("name", source.name);
            }
            const response = await fetch("/__maker/import-ui?" + query, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: byPath ? JSON.stringify({ path: source }) : source
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "导入失败。");
            result.textContent = `${data.alreadyPresent ? "此 UI 已存在" : "导入成功"}，共 ${data.assets} 个资源。`;
            refresh.click();
            open.onclick = () => window.location.assign("/?" + new URLSearchParams({
              project, page: "ui-editor", ui: data.file
            }));
            open.hidden = false;
          } catch (error) {
            result.textContent = error.message;
          } finally {
            busy = false;
            paste.disabled = browse.disabled = false;
          }
        }
      }
      mount();
      new MutationObserver(mount).observe(doc.body, { childList: true, subtree: true });
    }
    frame.addEventListener("load", install);
    if (frame.contentDocument?.readyState === "complete") install();
  }
  new MutationObserver(attach).observe(host, { childList: true });
  attach();
})();
