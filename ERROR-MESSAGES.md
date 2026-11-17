# 插件错误与提示完整审计

版本：4.4.0。范围：当前插件手写运行代码、安装脚本及更新脚本。扫描时间：2026-11-05。

统计按触发点计，不把相同文字多处使用伪装成独立错误种类。动态透传的官方、浏览器、网络、文件系统错误没有固定总数。画布提示包括阻止操作、错误包装及少量进度/成功提示，不能全称为错误。按钮名称和普通状态标签不计入。

| 类别 | 触发点 | 含固定文字 | 仅动态转发 |
|---|---:|---:|---:|
| 前端抛错 | 42 | 41 | 1 |
| 画布提示调用 | 25 | 18 | 7 |
| 更新器状态与提示 | 13 | 12 | 1 |
| 工作流消息拒绝 | 2 | 1 | 1 |
| 本地处理器抛错 | 13 | 13 | 0 |
| 安装及更新脚本固定抛错 | 22 | 22 | 0 |

## 两个被投诉的提示

1. 4.3.0 已改用每节点任务表，移除全局 activeRun 和 sayRunning 拦截。不同节点独立运行，同节点重复点击接回原任务，共享处理节点内部串行。
2. 透明化保留工作流数据，旧结果缺少映射时向上游恢复。切图没有区域坐标时返回等待输入，不抛缺少映射错误，也不伪造切图结果。

## 前端抛错

共 42 处触发点；其中 41 处包含固定文案，1 处仅转发动态错误。

1. `extension/canvas.js:10`：「官方接口未响应；未重复提交。」
   - 原始表达式：`"官方接口未响应；未重复提交。"`
2. `extension/canvas.js:19`：无固定文案，转发原始错误。
   - 原始表达式：`value.error`
3. `extension/canvas.js:122`：「已取消」
   - 原始表达式：`"已取消"`
4. `extension/canvas.js:1048`：「本地 BBox 处理器未安装，请运行新版安装器。」
   - 原始表达式：`result?.error || result?.message || "本地 BBox 处理器未安装，请运行新版安装器。"`
5. `extension/canvas.js:1089`：「未取得输入图片。请连接已导入的参考图片；现有输入和任务记录已保留。」
   - 原始表达式：`"未取得输入图片。请连接已导入的参考图片；现有输入和任务记录已保留。"`
6. `extension/canvas.js:1106`：「slice」；「这张图片没有切图区域。请将 BBox 识别预排结果接入此链路，现有图片已保留。」；「上游尚未提供当前步骤所需的数据。请查看上游卡片的具体失败原因；现有图片和任务已保留。」
   - 原始表达式：`node.kind === "slice" ? "这张图片没有切图区域。请将 BBox 识别预排结果接入此链路，现有图片已保留。" : "上游尚未提供当前步骤所需的数据。请查看上游卡片的具体失败原因；现有图片和任务已保留。"`
7. `extension/canvas.js:1236`：「不支持此图片来源。」
   - 原始表达式：`"不支持此图片来源。"`
8. `extension/canvas.js:1238`：「图片无法读取。」
   - 原始表达式：`"图片无法读取。"`
9. `extension/canvas.js:1256`：「图片转换未完成。」
   - 原始表达式：`"图片转换未完成。"`
10. `extension/canvas.js:1323`：「透明化失败：」
   - 原始表达式：`"透明化失败：" + error.message`
11. `extension/canvas.js:1395`：「第 ${record.sequence} 次生成未完成，状态：${item.state}。可在生成历史中刷新这一批的结果。」
   - 原始表达式：`item.error || '第 ${record.sequence} 次生成未完成，状态：${item.state}。可在生成历史中刷新这一批的结果。'`
12. `extension/canvas.js:1400`：「图片已生成；后处理未完成：」
   - 原始表达式：`"图片已生成；后处理未完成：" + error.message`
13. `extension/graph.js:54`：「不支持的卡片类型。」
   - 原始表达式：`"不支持的卡片类型。"`
14. `extension/graph.js:101`：「请选择图片生成卡片。」
   - 原始表达式：`"请选择图片生成卡片。"`
15. `extension/pipeline.js:88`：「去文字请求尚未确认：」
   - 原始表达式：`"去文字请求尚未确认：" + (result.error || result.status)`
16. `extension/pipeline.js:95`：「识图结果未知；再次运行将查询原请求。」
   - 原始表达式：`result.error || "识图结果未知；再次运行将查询原请求。"`
17. `extension/pipeline.js:99`：「两轮识图未完成。」
   - 原始表达式：`result.error || "两轮识图未完成。"`
18. `extension/pipeline.js:128`：「上次分离请求结果未确认，请先查询，未重复提交。」
   - 原始表达式：`"上次分离请求结果未确认，请先查询，未重复提交。"`
19. `extension/pipeline.js:138`：「分离结果未确认。」
   - 原始表达式：`value.error || "分离结果未确认。"`
20. `extension/pipeline.js:158`：「官方 Meta 生成器未完成。」
   - 原始表达式：`"官方 Meta 生成器未完成。"`
21. `extension/pipeline.js:167`：「未知工作流步骤。」
   - 原始表达式：`"未知工作流步骤。"`
22. `extension/maker.js:44`：「Maker 官方接口尚未加载。」
   - 原始表达式：`"Maker 官方接口尚未加载。"`
23. `extension/maker.js:90`：「Invalid source project.」
   - 原始表达式：`"Invalid source project."`
24. `extension/maker.js:92`：「参考图片读取未完成。」
   - 原始表达式：`"参考图片读取未完成。"`
25. `extension/maker.js:99`：「图片读取失败。」
   - 原始表达式：`"图片读取失败。"`
26. `extension/maker.js:106`：「PNG 转换失败。」
   - 原始表达式：`"PNG 转换失败。"`
27. `extension/maker.js:114`：「图片读取失败。」
   - 原始表达式：`"图片读取失败。"`
28. `extension/maker.js:148`：「无法压缩到目标体积；未传入超限文件。」
   - 原始表达式：`"无法压缩到目标体积；未传入超限文件。"`
29. `extension/maker.js:153`：「当前 Maker 未提供官方切图算法。」
   - 原始表达式：`"当前 Maker 未提供官方切图算法。"`
30. `extension/maker.js:157`：「图集读取失败。」
   - 原始表达式：`"图集读取失败。"`
31. `extension/maker.js:181`：「尚未生成 UI 文件。」
   - 原始表达式：`"尚未生成 UI 文件。"`
32. `extension/maker.js:185`：「资源包尚未生成。」
   - 原始表达式：`"资源包尚未生成。"`
33. `extension/maker.js:190`：「资源读取失败：」
   - 原始表达式：`"资源读取失败：" + asset.path`
34. `extension/maker.js:207`：「当前来源为本地 AI，官方生图接口不可用。」
   - 原始表达式：`"当前来源为本地 AI，官方生图接口不可用。"`
35. `extension/maker.js:210`：「所选官方模型已不可用，请重新选择。」
   - 原始表达式：`"所选官方模型已不可用，请重新选择。"`
36. `extension/maker.js:212`：「所选模型最多支持 ${choice.maxReferenceImages} 张参考图。」
   - 原始表达式：`'所选模型最多支持 ${choice.maxReferenceImages} 张参考图。'`
37. `extension/maker.js:260`：「当前 Maker 未提供官方透明化程序。」
   - 原始表达式：`"当前 Maker 未提供官方透明化程序。"`
38. `extension/maker.js:262`：「图片读取失败。」
   - 原始表达式：`"图片读取失败。"`
39. `extension/maker.js:277`：「未识别到纯色背景，未改变原图。」
   - 原始表达式：`"未识别到纯色背景，未改变原图。"`
40. `extension/maker.js:295`：「去背景结果没有有效的透明前景，未输出原图。」
   - 原始表达式：`"去背景结果没有有效的透明前景，未输出原图。"`
41. `extension/maker.js:320`：「没有可下载的图片。」
   - 原始表达式：`"没有可下载的图片。"`
42. `extension/maker.js:335`：「官方图片文件读取失败。」
   - 原始表达式：`"官方图片文件读取失败。"`

## 画布提示调用

共 25 处触发点；其中 18 处包含固定文案，7 处仅转发动态错误。

1. `extension/canvas.js:159`：「保存卡片失败：」
   - 原始表达式：`"保存卡片失败：" + error.message`
2. `extension/canvas.js:207`：「已有图片记录恢复失败：」
   - 原始表达式：`"已有图片记录恢复失败：" + error.message`
3. `extension/canvas.js:232`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
4. `extension/canvas.js:281`：「当前画布尚未加载，请稍后再创建。」
   - 原始表达式：`"当前画布尚未加载，请稍后再创建。"`
5. `extension/canvas.js:356`：「这一批当前没有正在生成的图片。」
   - 原始表达式：`"这一批当前没有正在生成的图片。"`
6. `extension/canvas.js:394`：「当前画布尚未加载，请稍后再右键。」
   - 原始表达式：`"当前画布尚未加载，请稍后再右键。"`
7. `extension/canvas.js:425`：「连接未建立：端口数据类型不匹配，或这条连接会形成循环。」
   - 原始表达式：`"连接未建立：端口数据类型不匹配，或这条连接会形成循环。"`
8. `extension/canvas.js:440`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
9. `extension/canvas.js:505`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
10. `extension/canvas.js:682`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
11. `extension/canvas.js:958`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
12. `extension/canvas.js:971`：「这张图片尚未返回可查看的结果，其他图片可以继续生成。」
   - 原始表达式：`"这张图片尚未返回可查看的结果，其他图片可以继续生成。"`
13. `extension/canvas.js:980`：「当前没有已生成的图片可下载。生成成功后可直接下载，现有任务和输入已保留。」
   - 原始表达式：`"当前没有已生成的图片可下载。生成成功后可直接下载，现有任务和输入已保留。"`
14. `extension/canvas.js:985`：「下载失败：」
   - 原始表达式：`"下载失败：" + error.message`
15. `extension/canvas.js:1022`：「已添加。」
   - 原始表达式：`name + "已添加。"`
16. `extension/canvas.js:1026`：「识图尚未完成。」
   - 原始表达式：`"识图尚未完成。"`
17. `extension/canvas.js:1122`：「上游切图尚未完成。」
   - 原始表达式：`"上游切图尚未完成。"`
18. `extension/canvas.js:1150`：「复制卡片失败：」
   - 原始表达式：`"复制卡片失败：" + error.message`
19. `extension/canvas.js:1154`：「剪贴板中的卡片数据不完整，未修改当前画布。」
   - 原始表达式：`"剪贴板中的卡片数据不完整，未修改当前画布。"`
20. `extension/canvas.js:1183`：「剪贴板中没有可识别的卡片，未修改当前画布。」
   - 原始表达式：`"剪贴板中没有可识别的卡片，未修改当前画布。"`
21. `extension/canvas.js:1230`：「粘贴失败：」
   - 原始表达式：`"粘贴失败：" + error.message`
22. `extension/canvas.js:1241`：「拖入图片失败：」；「；可先将图片保存后拖入文件。」
   - 原始表达式：`"拖入图片失败：" + error.message + "；可先将图片保存后拖入文件。"`
23. `extension/canvas.js:1277`：「这个步骤当前没有正在执行的任务。」
   - 原始表达式：`"这个步骤当前没有正在执行的任务。"`
24. `extension/canvas.js:1592`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`
25. `extension/canvas.js:1627`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`

## 更新器状态与提示

共 13 处触发点；其中 12 处包含固定文案，1 处仅转发动态错误。

1. `extension/install.js:103`：「当前是源码目录版，不会自动覆盖源码。自动更新请加载安装器指定的 extension 目录。」
   - 原始表达式：`"当前是源码目录版，不会自动覆盖源码。自动更新请加载安装器指定的 extension 目录。"`
2. `extension/install.js:108`：「正在检查更新…」
   - 原始表达式：`"正在检查更新…"`
3. `extension/install.js:118`：「加载目录不正确。请运行 Install.cmd，并从 %LOCALAPPDATA%\MakerWorkflow\extension 加载扩展。」
   - 原始表达式：`"加载目录不正确。请运行 Install.cmd，并从 %LOCALAPPDATA%\\MakerWorkflow\\extension 加载扩展。"`
4. `extension/install.js:124`：「更新器出错，五分钟后重试。」
   - 原始表达式：`"error", result.message || "更新器出错，五分钟后重试。"`
5. `extension/install.js:127`：「已是最新版本。」
   - 原始表达式：`"已是最新版本。"`
6. `extension/install.js:129`：「更新器返回了无法确认的状态。」
   - 原始表达式：`"error", "更新器返回了无法确认的状态。"`
7. `extension/install.js:130`：「新版已下载，等待当前任务结束和画布保存。」
   - 原始表达式：`"waiting", "新版已下载，等待当前任务结束和画布保存。", result.version`
8. `extension/install.js:131`：「正在安装更新…」
   - 原始表达式：`"正在安装更新…"`
9. `extension/install.js:136`：「更新已安装，正在重新加载。」
   - 原始表达式：`"更新已安装，正在重新加载。"`
10. `extension/install.js:138`：「更新安装未完成，五分钟后重试。」
   - 原始表达式：`"error", applied.message || "更新安装未完成，五分钟后重试。"`
11. `extension/install.js:141`：「本地更新器未连接。请解压最新版并运行一次 Install.cmd，随后加载固定安装目录。」；「更新检查失败：」；「；五分钟后自动重试。」
   - 原始表达式：`missing ? "repair_required" : "offline", missing ? "本地更新器未连接。请解压最新版并运行一次 Install.cmd，随后加载固定安装目录。" : "更新检查失败：" + error.message + "；五分钟后自动重试。"`
12. `extension/update-check.js:21`：「正在检查更新…」
   - 原始表达式：`"正在检查更新…"`
13. `extension/update-check.js:23`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`

## 工作流消息拒绝

共 2 处触发点；其中 1 处包含固定文案，1 处仅转发动态错误。

1. `extension/install.js:176`：「工作流仅允许从 Maker 画布调用。」
   - 原始表达式：`"工作流仅允许从 Maker 画布调用。"`
2. `extension/install.js:178`：无固定文案，转发原始错误。
   - 原始表达式：`error.message`

## 本地处理器抛错

共 13 处触发点；其中 13 处包含固定文案，0 处仅转发动态错误。

1. `native/workflow.ts:17`：「Invalid Maker origin or project.」
   - 原始表达式：`"Invalid Maker origin or project."`
2. `native/workflow.ts:19`：「Maker project lookup failed.」
   - 原始表达式：`"Maker project lookup failed."`
3. `native/workflow.ts:22`：「Maker project unavailable.」
   - 原始表达式：`"Maker project unavailable."`
4. `native/workflow.ts:26`：「Invalid project media path.」
   - 原始表达式：`"Invalid project media path."`
5. `native/workflow.ts:29`：「Media escapes project.」
   - 原始表达式：`"Media escapes project."`
6. `native/workflow.ts:50`：「Invalid recognition request ID.」
   - 原始表达式：`"Invalid recognition request ID."`
7. `native/workflow.ts:59`：「Recognition inputs changed; previous request was not resubmitted.」
   - 原始表达式：`"Recognition inputs changed; previous request was not resubmitted."`
8. `native/workflow.ts:71`：「Source changed.」
   - 原始表达式：`"Source changed."`
9. `native/workflow.ts:130`：「Invalid workflow bundle.」
   - 原始表达式：`"Invalid workflow bundle."`
10. `native/workflow.ts:144`：「Maker CLI unavailable.」
   - 原始表达式：`"Maker CLI unavailable."`
11. `native/workflow.ts:148`：「Maker UI check did not return a structured report.」
   - 原始表达式：`"Maker UI check did not return a structured report."`
12. `native/workflow.ts:149`：「Maker UI reference check failed.」
   - 原始表达式：`"Maker UI reference check failed."`
13. `native/workflow.ts:152`：「Unknown workflow operation.」
   - 原始表达式：`"Unknown workflow operation."`

## 安装及更新脚本固定抛错

1. `distribution/Updater.ps1:12`：「Native message ended early.」
2. `distribution/Updater.ps1:20`：「Untrusted update location.」
3. `distribution/Updater.ps1:34`：「Update signature rejected.」
4. `distribution/Updater.ps1:46`：「Loaded extension ID does not match the installed release.」
5. `distribution/Updater.ps1:62`：「Staged workflow package checksum rejected.」
6. `distribution/Updater.ps1:68`：「Workflow helper missing; run the latest installer.」
7. `distribution/Updater.ps1:77`：「Node.js is required for BBox workflow processing.」
8. `distribution/Updater.ps1:95`：「Workflow processing timed out.」
9. `distribution/Updater.ps1:96`：「Workflow helper produced no result.」
10. `distribution/Updater.ps1:101`：「Update repository is not configured.」
11. `distribution/Updater.ps1:103`：「Wrong extension installation directory. Load the extension from the installed MakerWorkflow folder.」
12. `distribution/Updater.ps1:113`：「Update would downgrade the installed extension.」
13. `distribution/Updater.ps1:114`：「Invalid package filename.」
14. `distribution/Updater.ps1:119`：「Package checksum rejected.」
15. `distribution/Updater.ps1:122`：「Unknown update action.」
16. `distribution/Updater.ps1:124`：「Staged version changed.」
17. `distribution/Updater.ps1:125`：「Update would downgrade the installed extension.」
18. `distribution/Updater.ps1:127`：「Staged package checksum rejected.」
19. `distribution/Updater.ps1:134`：「Unsafe archive path.」
20. `distribution/Updater.ps1:139`：「Extension identity mismatch.」
21. `distribution/Updater.ps1:167`：「Message too large.」
22. `distribution/Setup.ps1:19`：「Invalid GitHub repository.」

`distribution/Updater.ps1` 还会透传处理器返回的 `$result.error`，以及系统异常；这些不是固定文案。

`native/NativeHost.cs` 另有一条错误包装：「Maker updater launcher failed: 」加系统异常。

## 直接显示的失败状态

- `extension/canvas.js` 图片加载失败时，缩略图变为「图片读取失败」。
- 下载失败时，弹窗也显示「下载失败：」加原始错误，与画布通知共用同一文案。
- 批次状态显示「失败：」加首条失败原因；缺少原因时显示「处理失败」。
- 图片占位状态包括「失败」「待确认」「未提交」；这些是状态标签，不是额外抛错。
- 更新状态包括「更新失败」「更新离线」「需要修复」等标签，详细原因来自上述更新提示。

未把打包后的第三方 SDK、Node、浏览器和操作系统异常文本计算成插件作者新写的固定文案。它们仍可能经动态错误入口显示，不能声称存在一个有限的全部外部报错清单。
