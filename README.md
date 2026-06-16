# Claude Model Switch

[English](README.en.md)

一个用于按项目管理 Claude Code 模型配置的 VSCode 扩展。

如果你在多个项目里同时使用 Claude Code for VS Code，不同项目需要不同的模型设置时，比如一个项目用 Claude，另一个项目通过兼容接口使用 GLM、Kimi、Qwen 或 MiniMax。

这个扩展可以把这些设置保存，并在各个模型之间切换。它会更新项目里的 `.claude/settings.local.json`，让每个项目分别保存自己的模型、Base URL 和 Token 配置。

## 预览

![使用说明](docs/usage.png)

## 功能

- **模型配置管理**：添加、编辑、删除模型配置
- **按项目切换**：每个项目独立使用不同模型，切换不影响其他项目
- **状态栏**：在底部状态栏显示当前生效的模型
- **侧边栏树视图**：列出所有配置，每行带操作按钮（切换、编辑、删除）
- **导出/导入**：导出配置为 JSON 文件用于备份或分享；导入时支持冲突处理
- **模型列表与测速**：可从 Base URL 获取模型列表，模型字段支持下拉选择，并可对单个模型字段或配置进行测速
- **自动填充**：配置名称默认取模型值；空字段会从 settings 中移除对应托管项

## 使用方法

### 切换模型

- 点击底部**状态栏**中的模型名称
- 或在侧边栏树视图中点击某配置行的 ⚡ 切换按钮
- 或在命令面板中运行 `Claude: Switch to Model Profile`

> **注意**：切换模型后，需要重启 Claude Code 才能使更改生效。扩展会提示"重启 VS Code"按钮，点击可自动重新加载窗口。

### 添加配置

- 点击侧边栏树视图顶部的 ➕ 按钮
- 或在命令面板中运行 `Claude: Add Model Profile`
- 在 Webview 面板中填写字段（所有字段均可空）
- 填写 Base URL 后可点击“获取模型列表”（Base URL 不能为空），把可用模型加载到各模型字段右侧下拉框
- 每个模型字段右侧都有“模型测速”按钮，可在保存配置前直接测试当前输入的模型、Base URL 和 Token 组合

### 编辑 / 删除配置

- 使用侧边栏每行的 ✏️ / 🗑️ 按钮
- 或右键点击配置行使用上下文菜单

### 导出 / 导入

- 使用侧边栏顶部按钮或命令面板：
  - `Claude: Export Model Profiles` — 将所有配置保存为 JSON 文件
  - `Claude: Import Model Profiles` — 从 JSON 文件加载配置，遇到同名会提示处理方式

## 开发

### 前置条件

- Node.js 20+
- pnpm
- VSCode 1.85+

### 安装

```bash
git clone <repo-url>
cd claude-model-switch
pnpm install
```

### 构建

```bash
pnpm run build
```

### 开发模式（自动重建）

```bash
pnpm run watch
```

### VSCode 中调试

1. 在 VSCode 中打开本项目
2. 按 `F5` 或使用 **Run Extension** 启动配置
3. 会打开一个新的 VSCode Extension Development Host 窗口，扩展已加载
4. 修改 `src/` 中的代码，watch 任务会自动重建
5. 在 Extension Development Host 窗口中按 `Ctrl+R` / `Cmd+R` 重新加载查看变化

### 类型检查

```bash
pnpm run lint
```

### 可用脚本

- `pnpm run build` — 单次构建扩展，输出到 `out/extension.js`
- `pnpm run build:prod` — 构建用于打包和发布的生产版本
- `pnpm run watch` — 开发时自动监听并重建
- `pnpm run lint` — 执行 TypeScript 类型检查
- `pnpm run package:vsix` — 打包生成 `dist/claude-model-switch.vsix`，用于本地安装或手动分发
- `pnpm run release:patch` — 自动升级补丁版本并发布到 VSCode Marketplace
- `pnpm run release:minor` — 自动升级次版本并发布到 VSCode Marketplace
- `pnpm run release:major` — 自动升级主版本并发布到 VSCode Marketplace

## 发布

需要配置的 Secrets：

- `VSCE_PAT` — 发布到 VSCode Marketplace 必需
- `OVSX_PAT` — 可选，用于发布到 Open VSX

### 仅本地打包

适用于你只想生成 `.vsix` 文件做测试，或者直接发给别人安装。

```bash
pnpm run package:vsix
```

会生成 `dist/claude-model-switch.vsix`，可手动安装：

```bash
code --install-extension dist/claude-model-switch.vsix
```

### 本地直接发布 Marketplace

适用于你想在本机直接发布，并让 `vsce` 自动修改 `package.json` 里的版本号。

```bash
pnpm run release:patch
```

这里的 `patch` 也可以换成 `minor` 或 `major`。

### GitHub Actions：基于 tag 的发布

适用于版本号已经在本地确定并提交完成的情况。

```bash
git tag v0.0.1
git push origin v0.0.1
```

这个工作流会：

1. 用 pnpm 安装依赖
2. 构建扩展
3. 打包生成 `dist/claude-model-switch.vsix`
4. 把这个确定的包发布到 VSCode Marketplace
5. 可选地把同一个包发布到 Open VSX

### GitHub Actions：手动触发并自动升级版本发布

如果你想让 GitHub 来自动升级版本并发布，可以使用 GitHub Actions 里的 `Manual Marketplace Release` 工作流。

可选输入：

- `patch` — 补丁版本，比如 `0.0.1 -> 0.0.2`
- `minor` — 次版本，比如 `0.0.1 -> 0.1.0`
- `major` — 主版本，比如 `0.0.1 -> 1.0.0`

这个工作流会：

1. 执行 `vsce publish patch|minor|major`
2. 更新 `package.json` 版本号
3. 创建版本 tag
4. 把提交和 tag 推回 GitHub

## 工作原理

- **配置列表**存储在 VSCode 的 `globalState` 中（跨会话持久化，机器特定）
- **当前生效的配置 ID** 记录在 `<workspace>/.claude/.claude-model-switch-active.json` 中
- **切换**时只管理 `settings.local.json` 的 `model` 和支持的 `env` 字段；配置中留空的托管字段会从 `settings.local.json` 移除，其他设置会保留
- 如果配置 ID 找不到对应的 profile，会尝试全字段匹配当前的 `settings.local.json`
- 切换编辑器或 `settings.local.json` 文件变化时，状态栏和树视图自动刷新

## 安全提示

- **`.gitignore`**：建议将 `.claude/` 加入项目的 `.gitignore` 文件，因为 Token 会以明文形式保存在 `.claude/settings.local.json` 中，避免意外提交到 Git 仓库。
- **导出配置**：导出的 JSON 文件默认不包含 Token。如需包含 Token，可在导出时选择“包含 Token 导出”，但请注意妥善保管导出文件。
- **同步**：配置数据（包括 Token）会通过 VS Code Settings Sync 跨设备同步，请确保你的 Microsoft/GitHub 账户安全。
