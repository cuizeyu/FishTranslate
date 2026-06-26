# 鱼语翻译

基于 Electron + Vite + React + TypeScript + Antd + Sass 的桌面应用。

## 技术栈

- **Electron** + **electron-vite**：主进程 / 预加载 / 渲染进程一体化构建
- **Vite 7** + **React 19** + **TypeScript**
- **Ant Design 5**（已配置中文 `zh_CN` 语言包）+ `@ant-design/icons`
- **Sass**（`.scss`，已配置全局变量）
- **Python**：调用 `resources/python/baidu_translate.py` 对接百度在线翻译接口
- **electron-builder**：Windows（nsis 安装包）/ macOS（dmg + zip）打包

## 目录结构

```
src/
├─ main/            主进程
│  └─ index.ts
├─ preload/         预加载脚本
│  ├─ index.ts
│  └─ index.d.ts
└─ renderer/        渲染进程（React 应用）
   ├─ index.html
   └─ src/
      ├─ main.tsx
      ├─ App.tsx
      ├─ App.scss
      └─ assets/styles/   全局样式与 Sass 变量
electron.vite.config.ts   构建配置
electron-builder.yml      打包配置
resources/python/
└─ baidu_translate.py     百度翻译接口脚本
requirements.txt          Python 依赖
```

## 常用命令

```bash
# 开发（热更新）
pnpm dev

# 类型检查
pnpm typecheck

# 仅构建（输出到 out/）
pnpm build

# 预览构建产物
pnpm start

# 重新生成图标（同时生成 Windows 的 .ico 和 macOS 的 .icns）
pnpm icon:build

# 安装 Python 翻译依赖（跨平台，自动识别 .venv）
pnpm py:install

# 打包 Windows 安装包（输出到 dist/，需在 Windows 上执行）
pnpm build:win

# 打包 macOS 安装包（dmg + zip，输出到 dist/，需在 macOS 上执行）
pnpm build:mac

# 仅生成免安装目录（便于调试打包结果）
pnpm build:unpack       # Windows
pnpm build:mac:unpack   # macOS
```

打包产物：
- Windows：`dist/鱼语翻译-1.0.0-setup.exe`
- macOS：`dist/鱼语翻译-1.0.0-<arch>.dmg`（`arch` 为 `x64` 或 `arm64`）

## 说明

- 渲染进程别名 `@renderer` 指向 `src/renderer/src`。
- 图标源文件位于 `build/icon.png`，运行 `pnpm icon:build` 会通过 Python/Pillow 同时生成 `build/icon.ico`（Windows）和 `build/icon.icns`（macOS）。
- 翻译逻辑通过 Electron 主进程常驻调用 `python resources/python/baidu_translate.py --serve`，主进程会自动按平台选择 `.venv`（Windows: `.venv/Scripts/python.exe`，macOS/Linux: `.venv/bin/python3`），前端只通过 `window.api.translate()` 获取结果。
- 跨平台打包须在对应系统上进行：Windows 安装包需在 Windows 上执行 `pnpm build:win`，macOS 安装包需在 Mac 上执行 `pnpm build:mac`。打包会把当前系统的 `.venv` 一并带入，因此请先在该系统上执行 `pnpm py:install`。
