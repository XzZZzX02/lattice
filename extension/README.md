# Lattice for ChatGPT · 悬浮树形对话原型 0.3.0

在冗长对话里读到不熟悉的专业名词，选中它，在引用旁展开悬浮支线卡片连续追问。原文留下下划线，点击即可重新展开；回到主线阅读或输入时自动收起。支线可以再长出子支线，每张卡片绑定自己的 ChatGPT 原生分支。

## 安装与更新

1. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
2. 开启开发者模式，加载仓库 `dist-extension/`；使用 `artifacts/lattice-chatgpt-extension.zip` 时先解压，再选择包含 manifest.json 的文件夹。
3. 已安装的版本点击“重新加载”，再刷新 ChatGPT。最低 Chromium 版本为 120。

## 核心用法

1. 在 ChatGPT 中正常提问，让主线回答出现。
2. 选中回答中的名词，如“KV Cache”，点击“支线追问”。也可从右侧对话树点击“就地追问”。此时只创建本地草稿，不发送问题。
3. 在引用旁的悬浮卡片中输入问题，点击发送。扩展在单独的原生标签页创建 ChatGPT 分支，卡片显示分支里的回答。卡片不插入主线排版，不推开后续消息。
4. 点击主线正文、进入主线输入框、滚动主线、按 Esc 或点击“返回主线”，卡片自动收起；上下文、草稿和树形关系保留。再次点击原文的下划线，恢复同一条支线。滚动卡片内部历史不会收起。
5. 在支线回答中选中文字，再点击追问按钮创建子支线。父卡片的引用也会有下划线，点击可重开子卡片；顶部路径可以回到父支线。每次显示当前正在阅读的一张悬浮卡片。
6. 主线继续使用 ChatGPT 原生输入框。侧栏对话树也可以打开各张卡片；重新加载页面时默认收起，保留原文下划线。

支线顶部的“打开原生分支”用于查看完整原文、交互式引用、附件、Canvas、模型选择、工具和 agent 操作或确认窗口。卡片展示的是可阅读的 Markdown 投影；这些复杂原生界面在原生页继续使用。

## 保留的辅助功能

- 原文卡片排版、回答定位、卡片标题、置顶和搜索。
- 选区摘录、笔记、回到原文、CSS 原文高亮与关联浮动卡片。
- 摘录加入思维图、概念与关系编辑、连线及来源定位。
- 原生分支关系图及手动关联已有会话。
- JSON 备份/恢复与 Markdown 导出。新版 JSON 包含树形关系、支线草稿、收起状态与原生上下文地址；兼容旧版整理文件。备份不创建或恢复 ChatGPT 云端对话。

## 原生能力与数据边界

- 问答、上下文、模型、引用、文件和 agent 由 ChatGPT 处理。主线消息不会被支线追问自动追加；每个分支继承范围遵循 ChatGPT 原生分支规则。
- 只注入 `https://chatgpt.com/*`，manifest 权限仍只有 storage。没有独立 API Key，不请求模型 API 或私有 ChatGPT 接口，不读取 Cookie、凭据或网络响应。
- 扩展创建普通的原生标签页承载支线。可以在浏览器中看到并打开这些页面。不会导航或提交主线标签页。
- 卡片关系、原文选区、用户草稿、摘录和笔记保存在 Chrome local storage。支线回答的临时投影与任务状态保存在 session storage；浏览器或扩展重启后可能清空，真实上下文仍由原生会话保存。
- 发送命令只领取一次。超时、页面变化、未识别菜单或输入框已有草稿时，会提示打开原生页核对，不静默重复发送或覆盖草稿。
- 清空整理只清除本会话的本地组织数据，不删除 ChatGPT 消息或云端分支。

## 兼容性边界

这是开发原型，尚未发布到扩展商店。后台页面可能受浏览器节流、登录状态、原生确认窗口影响；处理较久时可打开原生分支查看。原生富文本、交互式来源、图表和工具状态的完整体验仍在原生页面。

长对话只索引已经进入 DOM 的主线回答；虚拟化的历史消息可能需要先滚动加载。页面结构或菜单文案变化时，适配器可能需要更新。桌面版的本地文档数据库、模型配置与自动 AI 思维图建议仍留在桌面版。

## 开发与验证

```bash
pnpm extension:build
pnpm test
pnpm lint
pnpm build
pnpm extension:dev
```

构建输出与桌面版隔离。生成 ZIP 前会直接执行最终 content script 和 service worker，检查无 Node 全局对象时的启动、新旧原生 DOM 与原生控件保留。本地演示使用模拟分支与回答，页面明确标注，不产生模型调用。

原生分支上下文与本轮悬浮交互的验证范围分开记录，详见 [验证记录](ACCEPTANCE.md)。

代码：`src/ConversationTree.tsx` 为悬浮卡片与树目录，`src/tree-reference.ts` 为非破坏式引用标记，`src/tree-background.ts` 为原生分支协调，`src/native-relay.ts` 为原生页面输入与只读回答投影。详见 `docs/adr/0006-reference-anchored-floating-tree.md`。

参考：[Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Chrome Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)。
