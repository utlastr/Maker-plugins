const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const groups = [
  ["前端抛错", ["extension/canvas.js", "extension/graph.js", "extension/pipeline.js", "extension/maker.js"], /new Error\s*\(/g],
  ["画布提示调用", ["extension/canvas.js"], /\bsay\s*\(/g],
  ["更新器状态与提示", ["extension/install.js", "extension/update-check.js"], /\bretryUpdate\s*\(|\bmessage\s*:/g],
  ["工作流消息拒绝", ["extension/install.js"], /\breply\(\{\s*error\s*:/g],
  ["本地处理器抛错", ["native/workflow.ts"], /new Error\s*\(/g]
];
function argument(source, start, balanced) {
  let depth = balanced ? 1 : 0, quote = "", escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "(" || char === "[" || char === "{") depth++;
    if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth < (balanced ? 1 : 0)) return source.slice(start, i).trim();
    }
    if (!depth && (char === "," || char === "\n")) return source.slice(start, i).trim();
  }
  return source.slice(start).trim();
}
function literals(expression) {
  const values = expression.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gs) || [];
  return values.map(value => value.slice(1, -1).replace(/\\n/g, "\\n").replace(/\\\\/g, "\\"));
}
const sections = [], stats = [];
for (const [title, files, pattern] of groups) {
  const rows = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(pattern)) {
      if (/function\s+$/.test(source.slice(Math.max(0, match.index - 30), match.index))) continue;
      const expression = argument(source, match.index + match[0].length, match[0].endsWith("("));
      if (match[0].startsWith("say") && (!expression || expression === '""' || expression === "''" || expression === "text")) continue;
      const line = source.slice(0, match.index).split("\n").length;
      const messages = literals(expression).filter(text => title !== "更新器状态与提示" ||
        !["error", "waiting", "repair_required", "offline"].includes(text));
      rows.push({ file, line, expression, messages });
    }
  }
  const fixed = rows.filter(row => row.messages.length);
  stats.push({ title, sites: rows.length, withText: fixed.length, dynamicOnly: rows.length - fixed.length,
    literalOccurrences: rows.reduce((sum, row) => sum + row.messages.length, 0) });
  sections.push(`## ${title}\n\n共 ${rows.length} 处触发点；其中 ${fixed.length} 处包含固定文案，${rows.length - fixed.length} 处仅转发动态错误。\n\n` +
    rows.map((row, i) => `${i + 1}. \`${row.file}:${row.line}\`：${row.messages.length ? row.messages.map(text => `「${text}」`).join("；") : "无固定文案，转发原始错误。"}\n   - 原始表达式：\`${row.expression.replace(/\s+/g, " ").replace(/`/g, "'")}\``).join("\n"));
}
const nativeRows = [];
for (const file of ["distribution/Updater.ps1", "distribution/Setup.ps1"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of source.matchAll(/\bthrow\s+"((?:`.|[^"])*)"/g))
    nativeRows.push({ file, line: source.slice(0, match.index).split("\n").length, text: match[1] });
}
stats.push({ title: "安装及更新脚本固定抛错", sites: nativeRows.length });
sections.push("## 安装及更新脚本固定抛错\n\n" + nativeRows.map((row, i) => `${i + 1}. \`${row.file}:${row.line}\`：「${row.text}」`).join("\n") +
  "\n\n`distribution/Updater.ps1` 还会透传处理器返回的 `$result.error`，以及系统异常；这些不是固定文案。\n\n`native/NativeHost.cs` 另有一条错误包装：「Maker updater launcher failed: 」加系统异常。");
sections.push("## 直接显示的失败状态\n\n" +
  "- `extension/canvas.js` 图片加载失败时，缩略图变为「图片读取失败」。\n" +
  "- 下载失败时，弹窗也显示「下载失败：」加原始错误，与画布通知共用同一文案。\n" +
  "- 批次状态显示「失败：」加首条失败原因；缺少原因时显示「处理失败」。\n" +
  "- 图片占位状态包括「失败」「待确认」「未提交」；这些是状态标签，不是额外抛错。\n" +
  "- 更新状态包括「更新失败」「更新离线」「需要修复」等标签，详细原因来自上述更新提示。\n\n" +
  "未把打包后的第三方 SDK、Node、浏览器和操作系统异常文本计算成插件作者新写的固定文案。它们仍可能经动态错误入口显示，不能声称存在一个有限的全部外部报错清单。");
const table = "| 类别 | 触发点 | 含固定文字 | 仅动态转发 |\n|---|---:|---:|---:|\n" +
  stats.map(row => `| ${row.title} | ${row.sites} | ${row.withText ?? row.sites} | ${row.dynamicOnly ?? 0} |`).join("\n");
const version = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8")).version;
const report = `# 插件错误与提示完整审计\n\n版本：${version}。范围：当前插件手写运行代码、安装脚本及更新脚本。扫描时间：2026-11-05。\n\n` +
  "统计按触发点计，不把相同文字多处使用伪装成独立错误种类。动态透传的官方、浏览器、网络、文件系统错误没有固定总数。画布提示包括阻止操作、错误包装及少量进度/成功提示，不能全称为错误。按钮名称和普通状态标签不计入。\n\n" +
  table + "\n\n## 两个被投诉的提示\n\n" +
  "1. 4.3.0 已改用每节点任务表，移除全局 activeRun 和 sayRunning 拦截。不同节点独立运行，同节点重复点击接回原任务，共享处理节点内部串行。\n" +
  "2. 透明化保留工作流数据，旧结果缺少映射时向上游恢复。切图没有区域坐标时返回等待输入，不抛缺少映射错误，也不伪造切图结果。\n\n" +
  sections.join("\n\n") + "\n";
const output = path.join(root, "ERROR-MESSAGES.md");
fs.writeFileSync(output, report, "utf8");
console.log(JSON.stringify({ output, stats }, null, 2));
