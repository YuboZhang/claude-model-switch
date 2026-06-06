# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- `pnpm install` — 安装依赖；本项目使用 pnpm 和 Node.js 20+。
- `pnpm run build` — 使用 esbuild 从 `src/extension.ts` 打包 VS Code 扩展到 `out/extension.js`。
- `pnpm run build:prod` — 生成发布/打包前使用的压缩生产包。
- `pnpm run watch` — 开发时监听源码变化并自动重新构建。
- `pnpm run lint` — 通过 `tsc --noEmit` 运行 TypeScript 类型检查。
- `pnpm run package:vsix` — 构建并打包本地安装用的 `dist/claude-model-switch.vsix`。
- `code --install-extension dist/claude-model-switch.vsix` — 安装本地打包出的扩展。

当前仓库没有测试脚本、测试运行器或测试文件，因此没有单测或单测筛选命令。除非后续添加测试体系，否则本地验证优先使用 `pnpm run lint` 和 `pnpm run build`。

手动测试扩展时，在 VS Code 中打开本仓库，通过 F5 / “Run Extension” 启动 Extension Development Host；`.vscode/launch.json` 的 `Run Extension` 配置会先执行 build。使用 `pnpm run watch` 开发时，改动后重新加载 Extension Development Host 窗口。

## 架构概览

这是一个在 `onStartupFinished` 激活的 VS Code 扩展；`package.json` 贡献 activity bar 容器、`claudeModelSwitchProfiles` tree view、命令面板命令、上下文菜单项，以及来自 `package.nls*.json` 的本地化贡献文案。扩展入口是 `src/extension.ts`，负责组装存储、工作区设置写入器、树视图、状态栏、命令注册、context key，以及 `.claude/settings.local.json` 变更监听。

Profile 类型定义在 `src/models/profile.ts`，由 `src/storage/profileStore.ts` 持久化到 VS Code `globalState` 的 `claudeModelSwitchProfiles` key 下。`src/extension.ts` 调用 `context.globalState.setKeysForSync(['claudeModelSwitchProfiles'])`，因此 profile 数据会参与 VS Code Settings Sync。导出/导入使用 `src/ui/importExport.ts`，导入时按 profile 名称处理冲突。

切换 profile 由 `src/storage/settingsWriter.ts` 处理。它优先使用当前活动编辑器所属的 workspace folder，找不到时回退到第一个 workspace folder。切换时会把 active profile id 写入 `<workspace>/.claude/.claude-model-switch-active.json`，并且只管理 `<workspace>/.claude/settings.local.json` 中的 `model` 和支持的 env key，保留其他无关设置；当 profile 的 `model` 或受支持 env 字段为空时，会删除对应托管字段，避免旧值残留。新增受支持的环境字段时，需要同步更新 `ProfileEnv`、`settingsWriter.ts` 中的 `ENV_KEYS`、webview 模板/JS，以及需要展示该字段的 UI 代码。

UI 状态分布在以下位置：

- `src/ui/treeDataProvider.ts` — tree row、拖拽排序、active/speed 图标、批量测速和批量删除的选择模式。批量选择依赖 VS Code checkbox state 与 context key。
- `src/ui/statusBar.ts` — 根据 active profile id 或当前 workspace model 更新状态栏文本，点击后执行切换命令。
- `src/ui/webviewPanel.ts` 加 `media/webview.html`、`media/webview.css`、`media/webview.js` — 通过静态 HTML 模板、占位符替换和基于 nonce 的 CSP 渲染新增/编辑/复制 profile 表单；网络/API 请求应由扩展宿主处理，再通过 webview message 回传。
- `src/ui/importExport.ts` — JSON 导出/导入，并按 profile 名称处理冲突。

`src/commands/registerCommands.ts` 是命令编排层。命令通常会更新 `ProfileStore` 或 `SettingsWriter`，然后调用本地 `refreshAll()` 同时刷新 tree view 和状态栏。批量测速/删除流程使用 VS Code context keys：`claudeModelSwitch.speedSelectionMode` 和 `claudeModelSwitch.deleteSelectionMode`，这些 key 必须与 `package.json` 中的 `when` 条件保持一致。

测速和模型 API 逻辑在 `src/services/speedTester.ts` 中实现，使用 `@anthropic-ai/sdk`。单个 profile 测试会发送一次最小化的 `messages.create` 请求，`max_tokens: 1`；批量测试并发数为 3。配置解析优先使用 profile 的 env/model 值，然后回退到 `~/.claude/settings.json` 中的 env/model 值。Base URL 会去掉末尾斜杠和末尾 `/v1`；模型列表获取要求显式填写 Base URL（不允许空值回退到 SDK 默认地址），还会处理末尾 `/anthropic` 后再走 SDK 的 Models API。webview 配置页的每行模型测速会构造临时 `Profile`，把当前行模型写入 `model` 和 `env.ANTHROPIC_MODEL` 后调用同一个 `testProfile()`，不会保存到 `ProfileStore`。认证分支保持 `sk-ant-` 使用 `apiKey`，其他 token 使用 `authToken`，避免同时发送两类认证头。

运行时本地化在 `src/i18n.ts` 中实现，根据 `vscode.env.language` 在英文和中文词典之间选择；VS Code contribution 字符串则通过 `package.nls.json` 和 `package.nls.zh-cn.json` 单独本地化。新增用户可见命令、菜单、提示或 webview 文案时，需要保持对应本地化入口同步。

## 发布流程

GitHub Actions 发布 workflow 是手动触发的（`.github/workflows/release.yml`）：在 Node 20 和 pnpm 10 下安装依赖，运行 `pnpm run build:prod`，通过 `pnpm exec vsce publish <patch|minor|major> --no-dependencies` 发布，推送版本提交和 tag，打包 VSIX，并上传为 artifact。README 中还记录了本地 `release:patch|minor|major` 脚本；这些命令会发布到 Marketplace，只有明确需要发布时再运行。
