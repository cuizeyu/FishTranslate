# 鱼语翻译

基于 Electron + Vite + React + TypeScript + Antd + Sass 的桌面应用。

## 技术栈

- **Electron** + **electron-vite**：主进程 / 预加载 / 渲染进程一体化构建
- **Vite 7** + **React 19** + **TypeScript**
- **Ant Design 5**（已配置中文 `zh_CN` 语言包）+ `@ant-design/icons`
- **Sass**（`.scss`，已配置全局变量）
- **Python**：调用 `resources/python/baidu_translate.py` 对接百度在线翻译接口
- **electron-builder**：Windows 打包（nsis 安装包）

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

# 重新生成 Windows 图标
pnpm icon:build

# 安装 Python 翻译依赖
pnpm py:install

# 打包 Windows 安装包（输出到 dist/）
pnpm build:win

# 仅生成免安装目录（dist/win-unpacked，便于调试打包结果）
pnpm build:unpack
```

打包产物：`dist/鱼语翻译-1.0.0-setup.exe`

## 说明

- 渲染进程别名 `@renderer` 指向 `src/renderer/src`。
- 图标源文件位于 `build/icon.png`，运行 `pnpm icon:build` 会通过 Python/Pillow 生成 `build/icon.ico`。
- 翻译逻辑通过 Electron 主进程常驻调用 `.venv/Scripts/python.exe resources/python/baidu_translate.py --serve`，前端只通过 `window.api.translate()` 获取结果。
