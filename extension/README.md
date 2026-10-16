# Lattice for ChatGPT

Chrome / Edge 可本地加载的 Manifest V3 原型。沿用 Lattice 的卡片、选区关联和思维图，问答、上下文和 agent 能力继续使用 ChatGPT。

## 安装

已经构建的版本位于仓库根目录的 `dist-extension/`，压缩包位于 `artifacts/lattice-chatgpt-extension.zip`。使用压缩包时先解压，选择包含 `manifest.json` 的文件夹。

1. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
2. 开启“开发者模式”，选择“加载已解压的扩展程序”，选择 `dist-extension/` 或解压后的文件夹。
3. 打开或刷新 `https://chatgpt.com/`，进入一条对话。右侧出现 Lattice 工作区。

扩展源码更新后重新构建，在扩展管理页面点击“重新加载”，再刷新 ChatGPT。最低 Chromium 版本为 120。

## 功能与原生能力配合

| 已有产品能力 | 网页扩展的处理方式 |
| --- | --- |
| 回答卡片与导航 | 自动索引当前页面的回答，支持卡片排版、定位、标题改名、置顶和问题/回答搜索。原文仍由 ChatGPT 渲染。 |
| 选区关联卡片 | 选中文字后摘录；保留来源消息与文字偏移。原文高亮使用 CSS Highlight，不插入包裹标签。点击高亮打开浮动关联卡片。 |
| 摘录与笔记 | 本地保存、编辑、复制、删除；可以定位回来源文字。复制后可在 ChatGPT 原生输入框中追问。 |
| 对话分支与独立上下文 | “从这里分支”查找所选回答自己的原生菜单，触发 ChatGPT 原生分支。由 ChatGPT 决定分支上下文与可用工具。 |
| 分支关系图 | 记录通过扩展触发、在当前或子标签打开的新会话；带回原回答的定位链接。无法自动关联时可粘贴已创建分支的会话地址，手动补充关系。 |
| 选区触发的分支 | 先保存摘录，再创建原生分支；新分支工作区展示探索线索，可复制后继续提问。不会自动发送或改写提问。 |
| 思维图 | 摘录可转为概念节点；支持拖动、连线、概念/关系改名、删除，以及回到来源。它是本地知识组织，不控制模型上下文。支持展开工作区。 |
| 导入导出 | JSON 备份本地整理、思维图与分支关系；Markdown 导出摘录、笔记和来源链接。导入限同一原生会话，替换前显示确认。 |
| 项目、会话历史、文件、引用、搜索与 agent 工具 | 继续从 ChatGPT 原生入口使用。扩展不接管上传、检索、推理、工具执行、编辑问题、重试或停止生成。 |
| 模型选择与账号 | 继续使用 ChatGPT 原生选择器与当前账号；扩展没有独立 API Key 或模型请求。 |

点击右上角收起工作区时，卡片排版、选区高亮和预留空间一起撤去。原生回答节点和事件处理器不被克隆、移动或替换。

检测到原生模态对话框时，工作区会暂时让出界面；关闭原生对话框后恢复。选区工具栏优先放在选区下方，减少与原生选区操作重叠。

桌面版原先的 `child` / `divergent` / `branch` 有自己的 Rust 上下文拼装规则。扩展版使用真实的 ChatGPT 原生会话/分支来表达探索方向，不把图上的连线当作模型可见的上下文。原生新对话、项目和记忆是否影响上下文，以 ChatGPT 自身行为为准。

原来的本地文档数据库、Keychain 模型配置和独立模型调用保留在桌面版。思维图的自动 AI 建议尚未迁移；可以先用 ChatGPT 原生问答整理概念，再编辑本地图。

## 数据范围

- 只注入 `https://chatgpt.com/*`；manifest 权限仅为 `storage`。
- 只读取当前页面已渲染的消息用于导航；不读取登录凭据、Cookie、私有接口或网络响应，不调用任何模型 API，也不上传对话。
- 自动持久化的是卡片自定义标题、置顶、用户主动保存的摘录和笔记、思维图、分支会话地址及分支起点。不会自动备份完整聊天、附件或工具结果。
- 临时页面或尚未生成会话地址时，整理只保留于当前页面；稳定的会话地址出现后才启用持久化。临时聊天不会被按路径长期保存。
- 同一会话在多个标签中的修改由后台顺序处理，避免覆盖彼此的整理。
- JSON 和 Markdown 导出包含用户保存的摘录、笔记及相关会话地址；完整聊天与文件仍保存在 ChatGPT。
- “清空整理”清除当前会话的本地卡片设置、摘录和思维图，不删除 ChatGPT 消息或会话。跨会话分支关系保留。

## 当前兼容性边界

这是可安装的开发原型，已通过本地 DOM 兼容性夹具和浏览器演示验证；尚未在用户登录的真实 ChatGPT 页面逐项验收，也没有发布到扩展商店。

1. ChatGPT 的页面结构和菜单文案可能变化。当前适配明确的消息角色、稳定消息 ID、回答操作菜单，以及中英文原生分支菜单。未识别稳定 ID 时只保留导航，防止摘录或卡片错误绑定到另一条回答。
2. 未识别原生分支按钮时会提示使用原生菜单；不会改用私有接口或自己拼接上下文。若原生分支打开新标签时没有提供 opener 关系，自动关联可能失败，可回到来源会话的“分支”页手动关联新会话地址。
3. 分支图只展示本机记录或用户导入/手动关联的关系，不扫描账号全部历史，也不自动还原旧分支树。
4. 只索引已经进入 DOM 的消息；长会话中尚未加载或被虚拟化移除的消息可能需要在 ChatGPT 中先滚动加载。消息被编辑、删除或重生成后，摘录可能不能精确定位；会明确提示，不擅自匹配同一句话的其他重复位置。
5. 引用、文件、Canvas 和 agent 界面保持原生，但不能仅凭本地夹具证明所有线上版本都兼容。首次使用时应检查这些原生交互，并可随时收起工作区。
6. 当前本地数据不跨设备同步，桌面版 SQLite 项目也没有自动迁入浏览器。备份文件仅恢复组织数据，不创建或恢复 ChatGPT 云端会话。

## 开发与验证

在仓库根目录使用现有 pnpm 依赖：

```bash
pnpm extension:build
pnpm extension:test
pnpm lint
pnpm test
pnpm build
```

构建输出为独立 `dist-extension/`，不会覆盖桌面版的 `dist/`。Content script 和 service worker 分别打包为 IIFE；所有脚本与样式都包含在扩展包中，没有 CDN 或远程脚本。

```bash
pnpm extension:dev
```

本地演示地址为 `http://127.0.0.1:1421/`。演示数据、菜单和 Chrome 存储桥接是模拟实现，真实 UI、选区锚点和 DOM 适配逻辑与扩展共用。演示不会登录 ChatGPT 或产生模型调用。

主要代码：`src/host.ts` 为 DOM 适配与原生操作边界；`src/background.ts` 处理存储和原生分支关联；`src/App.tsx` 为 Shadow DOM 工作区；`src/presentation.ts` 与 `src/backup.ts` 管理本地数据。

参考：[Chrome Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[OpenAI Plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[OpenAI Plugin Extensions](https://developers.openai.com/plugins/build/extensions)。官方插件 UI 是独立的受控界面；此原型使用浏览器扩展来为现有原生回答增加组织方式。
