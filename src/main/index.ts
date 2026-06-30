import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  globalShortcut,
  desktopCapturer,
  screen,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Worker } from "worker_threads";
import { electronApp, is } from "@electron-toolkit/utils";
import appIcon from "../../resources/icon.png?asset";

const APP_NAME = "鱼语翻译";
const TRANSLATE_TIMEOUT = 45_000;
const OCR_TIMEOUT = 45_000;
const DEFAULT_SCREENSHOT_SHORTCUT = "CommandOrControl+Shift+D";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let screenshotShortcut = DEFAULT_SCREENSHOT_SHORTCUT;

// 低级键盘钩子 worker（仅 Windows 使用，真正抢占快捷键）
let hookWorker: Worker | null = null;
let hookReady = false;

function getConfigFile(): string {
  return join(app.getPath("userData"), "config.json");
}

function loadConfig(): void {
  try {
    const data = JSON.parse(readFileSync(getConfigFile(), "utf-8"));
    if (
      typeof data.screenshotShortcut === "string" &&
      data.screenshotShortcut
    ) {
      screenshotShortcut = data.screenshotShortcut;
    }
  } catch {
    // 配置文件不存在或解析失败，使用默认值
  }
}

function saveConfig(): void {
  try {
    writeFileSync(
      getConfigFile(),
      JSON.stringify({ screenshotShortcut }, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.warn("[config] save failed:", error);
  }
}

function getHookWorkerPath(): string {
  return is.dev
    ? join(getRuntimeRoot(), "resources", "hook", "keyboard-hook.worker.cjs")
    : join(process.resourcesPath, "hook", "keyboard-hook.worker.cjs");
}

// 用变量名阻止打包器静态分析，保留运行时 require.resolve
function resolveKoffiPath(): string {
  const moduleName = "koffi";
  return require.resolve(moduleName);
}

function startHookWorker(): boolean {
  if (process.platform !== "win32") return false;
  if (hookWorker) return hookReady;

  let worker: Worker;
  try {
    worker = new Worker(getHookWorkerPath(), {
      workerData: {
        koffiPath: resolveKoffiPath(),
        accelerator: screenshotShortcut,
      },
    });
  } catch (error) {
    console.warn("[hook] 启动 worker 失败:", error);
    return false;
  }

  hookWorker = worker;
  hookReady = false;

  worker.on(
    "message",
    (msg: { type: string; ok?: boolean; error?: string }) => {
      if (msg.type === "ready") {
        hookReady = !!msg.ok;
        if (msg.ok) {
          console.log(
            "[hook] 低级键盘钩子已安装，当前快捷键:",
            screenshotShortcut,
          );
        } else {
          console.warn("[hook] 钩子安装失败:", msg.error);
        }
      } else if (msg.type === "trigger") {
        console.log("[hook] 截图翻译快捷键触发");
        void startScreenshotTranslation();
      }
    },
  );
  worker.on("error", (error) => {
    console.warn("[hook] worker 异常:", error);
    hookReady = false;
  });
  worker.on("exit", (code) => {
    hookReady = false;
    if (!isQuitting) {
      console.warn("[hook] worker 退出，code =", code);
    }
  });

  return true;
}

function stopHookWorker(): void {
  if (!hookWorker) return;
  hookReady = false;
  hookWorker.terminate().catch(() => {});
  hookWorker = null;
}

function updateHookAccelerator(accelerator: string): void {
  hookWorker?.postMessage({ type: "update", accelerator });
}

// 非 Windows 平台回退到 globalShortcut（无法抢占，仅先到先得）
function registerGlobalShortcut(): boolean {
  globalShortcut.unregisterAll();
  if (!screenshotShortcut) return true;
  try {
    return globalShortcut.register(screenshotShortcut, () => {
      showMainWindow();
      mainWindow?.webContents.send("shortcut:screenshot-triggered");
    });
  } catch (error) {
    console.warn("[shortcut] 注册异常:", error);
    return false;
  }
}

// 注册当前快捷键：Windows 用低级钩子（抢占式），其他平台用 globalShortcut
function registerScreenshotShortcut(): boolean {
  if (process.platform === "win32") {
    if (!hookWorker) {
      return startHookWorker();
    }
    updateHookAccelerator(screenshotShortcut);
    return true;
  }
  return registerGlobalShortcut();
}

type PythonResponse = {
  id: number;
  ok: boolean;
  result?: string;
  text?: string;
  error?: string;
};

type PendingRequest = {
  resolve: (value: string) => void;
  reject: (reason?: Error) => void;
  timer: NodeJS.Timeout;
};

function getRuntimeRoot(): string {
  return is.dev ? join(__dirname, "../..") : process.resourcesPath;
}

function getPythonCommand(): { command: string; argsPrefix: string[] } {
  const runtimeRoot = getRuntimeRoot();
  const candidates =
    process.platform === "win32"
      ? [join(runtimeRoot, ".venv", "Scripts", "python.exe"), "python"]
      : [
          join(runtimeRoot, ".venv", "bin", "python3"),
          join(runtimeRoot, ".venv", "bin", "python"),
          "python3",
          "python",
        ];

  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) {
        return { command: candidate, argsPrefix: [] };
      }

      continue;
    }

    return { command: candidate, argsPrefix: [] };
  }

  return { command: "python", argsPrefix: [] };
}

function getDevWindowIcon(): string | undefined {
  if (!is.dev) {
    return undefined;
  }

  const runtimeRoot = getRuntimeRoot();

  if (process.platform === "darwin") {
    return join(runtimeRoot, "build", "icon.png");
  }

  if (process.platform === "win32") {
    return join(runtimeRoot, "build", "icon.ico");
  }

  return join(runtimeRoot, "build", "icon.png");
}

class PythonTranslatorService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  translate(text: string, fromLang: string, toLang: string): Promise<string> {
    const child = this.ensureProcess();
    const id = this.nextId++;
    const payload =
      JSON.stringify({ id, text, from: fromLang, to: toLang }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("翻译超时，请稍后重试"));
      }, TRANSLATE_TIMEOUT);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(payload, "utf8", (error) => {
        if (!error) return;

        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.rejectAll(new Error("翻译服务已关闭"));
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const scriptPath = is.dev
      ? join(getRuntimeRoot(), "resources", "python", "baidu_translate.py")
      : join(getRuntimeRoot(), "python", "baidu_translate.py");
    const { command, argsPrefix } = getPythonCommand();
    const child = spawn(command, [...argsPrefix, scriptPath, "--serve"], {
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      console.warn("[translator]", chunk.trim());
    });
    child.on("error", (error) => {
      this.child = null;
      this.rejectAll(error);
    });
    child.on("close", () => {
      this.child = null;
      this.rejectAll(new Error("翻译服务已退出，请重试"));
    });

    this.child = child;
    return child;
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        this.handleResponseLine(line);
      }
    }
  }

  private handleResponseLine(line: string): void {
    let response: PythonResponse;

    try {
      response = JSON.parse(line);
    } catch {
      console.warn("[translator] invalid response:", line);
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.result ?? "");
      return;
    }

    pending.reject(new Error(response.error || "翻译失败，请稍后重试"));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    this.pending.clear();
  }
}

class OcrService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  recognize(imageBase64: string, language = "CHN_ENG"): Promise<string> {
    const child = this.ensureProcess();
    const id = this.nextId++;
    const payload = JSON.stringify({ id, image: imageBase64, language }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("OCR 识别超时，请稍后重试"));
      }, OCR_TIMEOUT);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(payload, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.rejectAll(new Error("OCR 服务已关闭"));
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const scriptPath = is.dev
      ? join(getRuntimeRoot(), "resources", "python", "baidu_ocr.py")
      : join(getRuntimeRoot(), "python", "baidu_ocr.py");
    const { command, argsPrefix } = getPythonCommand();
    const child = spawn(command, [...argsPrefix, scriptPath, "--serve"], {
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      console.warn("[ocr]", chunk.trim());
    });
    child.on("error", (error) => {
      this.child = null;
      this.rejectAll(error);
    });
    child.on("close", () => {
      this.child = null;
      this.rejectAll(new Error("OCR 服务已退出，请重试"));
    });

    this.child = child;
    return child;
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleResponseLine(line);
    }
  }

  private handleResponseLine(line: string): void {
    let response: PythonResponse;
    try {
      response = JSON.parse(line);
    } catch {
      console.warn("[ocr] invalid response:", line);
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    console.log("[ocr] 响应 id=", response.id, "ok=", response.ok, "text/result=", response.text ?? response.result);
    if (response.ok) {
      pending.resolve(response.text ?? response.result ?? "");
    } else {
      pending.reject(new Error(response.error || "OCR 识别失败"));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const translatorService = new PythonTranslatorService();
const ocrService = new OcrService();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: getDevWindowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // 禁用所有打开 DevTools 的快捷键
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (
      input.key === "F12" ||
      (input.control &&
        input.shift &&
        (input.key === "I" || input.key === "i")) ||
      (input.control &&
        input.shift &&
        (input.key === "J" || input.key === "j")) ||
      (input.control && (input.key === "U" || input.key === "u"))
    ) {
      _event.preventDefault();
    }
  });

  // 点击关闭按钮时隐藏到托盘，而不是退出程序
  let hasNotifiedMinimize = false;
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      if (process.platform === "darwin") {
        app.dock?.hide();
      }

      // 首次最小化时提示用户
      if (!hasNotifiedMinimize) {
        hasNotifiedMinimize = true;
        new Notification({
          title: APP_NAME,
          body: "程序已最小化到系统托盘，右键托盘图标可退出程序。",
          icon: getTrayIconImage(),
        }).show();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // 开发环境加载本地服务，生产环境加载打包后的 HTML
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (process.platform === "darwin") {
    app.dock?.show();
  }

  mainWindow.show();
  mainWindow.focus();
}

function getTrayIconImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(appIcon);

  if (image.isEmpty()) {
    return image;
  }

  // 托盘图标使用小尺寸，避免显示过大
  return image.resize({ width: 16, height: 16 });
}

function createTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(getTrayIconImage());
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开主界面",
      click: () => showMainWindow(),
    },
    { type: "separator" },
    {
      label: "退出程序",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 左键单击托盘图标打开窗口
  tray.on("click", () => showMainWindow());
}

/* ============ 截图翻译 ============ */

type OverlayData = {
  imageUrl: string;
  scaleFactor: number;
  thumbnail: Electron.NativeImage;
  display: Electron.Display;
};

type Rect = { x: number; y: number; width: number; height: number };

type ResultData = {
  ocrText: string;
  translatedText: string;
  fromLang: string;
  toLang: string;
  done: boolean;
};

const overlayWindows: BrowserWindow[] = [];
const overlayDataByWindow = new Map<number, OverlayData>();
let resultWindow: BrowserWindow | null = null;
let resultData: ResultData | null = null;
let isCapturing = false;

function getRendererUrl(view: string): string {
  const base = process.env["ELECTRON_RENDERER_URL"] ?? "";
  if (!base)
    return `file://${join(__dirname, "../renderer/index.html")}?w=${view}`;
  const sep = base.endsWith("/") ? "" : "/";
  return `${base}${sep}?w=${view}`;
}

function closeAllOverlays(): void {
  for (const w of overlayWindows) {
    overlayDataByWindow.delete(w.id);
    w.destroy();
  }
  overlayWindows.length = 0;
  isCapturing = false;
  // 截图翻译结束后只展示结果弹框，不主动恢复主窗口，避免主页面也弹出来
}

async function startScreenshotTranslation(): Promise<void> {
  if (isCapturing) {
    console.log("[screenshot] 已在捕获中，忽略重复触发");
    return;
  }
  isCapturing = true;
  console.log("[screenshot] 开始截图翻译流程");

  // 截图前隐藏主窗口，避免它出现在截图里；结束后不再主动恢复，只展示结果弹框
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  const displays = screen.getAllDisplays();
  console.log(
    "[screenshot] 显示器数量:",
    displays.length,
    displays.map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor })),
  );
  if (displays.length === 0) {
    isCapturing = false;
    return;
  }

  for (const display of displays) {
    // 按该显示器原生分辨率捕获，避免放大导致图片过大触发 OCR 尺寸限制
    const nativeWidth = Math.round(display.bounds.width * display.scaleFactor);
    const nativeHeight = Math.round(
      display.bounds.height * display.scaleFactor,
    );

    let sources: Electron.DesktopCapturerSource[] = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: nativeWidth, height: nativeHeight },
        fetchWindowIcons: false,
      });
    } catch (error) {
      console.error("[screenshot] desktopCapturer.getSources 失败:", error);
      continue;
    }

    const source =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) continue;

    const thumbnail = source.thumbnail;
    if (thumbnail.isEmpty()) {
      console.warn("[screenshot] 缩略图为空，跳过该显示器:", display.id);
      continue;
    }
    console.log("[screenshot] 缩略图尺寸:", thumbnail.getSize(), "display:", display.id);

    // 调试：保存完整截图到磁盘
    try {
      const fullDebugPath = join(app.getPath("userData"), "screenshot_full_debug.png");
      writeFileSync(fullDebugPath, thumbnail.toPNG());
      console.log("[screenshot] 完整截图已保存:", fullDebugPath);
    } catch (e) {
      console.warn("[screenshot] 完整截图保存失败:", e);
    }

    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: false,
      movable: false,
      resizable: false,
      enableLargerThanScreen: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: "#000000",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
      },
    });

    overlayDataByWindow.set(overlay.id, {
      imageUrl: thumbnail.toDataURL(),
      scaleFactor: display.scaleFactor,
      thumbnail,
      display,
    });

    overlay.on("closed", () => {
      overlayDataByWindow.delete(overlay.id);
      const idx = overlayWindows.indexOf(overlay);
      if (idx >= 0) overlayWindows.splice(idx, 1);
    });

    overlayWindows.push(overlay);
    console.log(
      "[screenshot] 创建覆盖窗口:",
      overlay.id,
      "display:",
      display.id,
      "bounds:",
      display.bounds,
    );

    if (process.env["ELECTRON_RENDERER_URL"]) {
      overlay.loadURL(getRendererUrl("overlay"));
    } else {
      overlay.loadFile(join(__dirname, "../renderer/index.html"), {
        query: { w: "overlay" },
      });
    }

    overlay.once("ready-to-show", () => {
      console.log("[screenshot] 覆盖窗口 ready-to-show:", overlay.id, "实际 bounds:", overlay.getBounds(), "内容 bounds:", overlay.getContentBounds());
      overlay.show();
      overlay.focus();
      overlay.setAlwaysOnTop(true, "screen-saver");
    });
    overlay.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error(
        "[screenshot] 覆盖窗口加载失败:",
        overlay.id,
        code,
        desc,
        url,
      );
    });
  }

  if (overlayWindows.length === 0) {
    isCapturing = false;
  }
}

function cropAndOcr(windowId: number, imageRect: Rect): void {
  const data = overlayDataByWindow.get(windowId);
  if (!data) {
    closeAllOverlays();
    return;
  }

  const { thumbnail } = data;
  const thumbSize = thumbnail.getSize();
  // 渲染进程已根据 img 实际显示尺寸与原图像素尺寸的比值，把选区换算成图片像素坐标
  const cropRect = {
    x: Math.max(0, Math.min(imageRect.x, thumbSize.width)),
    y: Math.max(0, Math.min(imageRect.y, thumbSize.height)),
    width: Math.max(0, Math.min(imageRect.width, thumbSize.width - imageRect.x)),
    height: Math.max(0, Math.min(imageRect.height, thumbSize.height - imageRect.y)),
  };
  console.log("[screenshot] 裁剪信息:", { thumbSize, imageRect, cropRect });

  // 关闭覆盖窗口，结束捕获态
  closeAllOverlays();

  let cropped = thumbnail.crop(cropRect);
  // 百度通用文字识别限制长边 ≤ 4096px，超出则等比缩小
  const croppedSize = cropped.getSize();
  console.log("[screenshot] 裁剪后尺寸:", croppedSize);
  const longEdge = Math.max(croppedSize.width, croppedSize.height);
  if (longEdge > 4096) {
    const ratio = 4096 / longEdge;
    cropped = cropped.resize({
      width: Math.round(croppedSize.width * ratio),
      height: Math.round(croppedSize.height * ratio),
    });
  }
  const pngBuffer = cropped.toPNG();
  const imageBase64 = pngBuffer.toString("base64");
  console.log("[screenshot] PNG 字节数:", pngBuffer.length, "base64 长度:", imageBase64.length);

  // 调试：保存裁剪后的图片到磁盘便于排查
  try {
    const debugPath = join(app.getPath("userData"), "screenshot_debug.png");
    writeFileSync(debugPath, pngBuffer);
    console.log("[screenshot] 调试图片已保存:", debugPath);
  } catch (e) {
    console.warn("[screenshot] 调试图片保存失败:", e);
  }

  // 先展示结果窗口（loading 态），再异步跑 OCR + 翻译
  resultData = {
    ocrText: "",
    translatedText: "",
    fromLang: "auto",
    toLang: "zh",
    done: false,
  };
  showResultWindow();

  void processScreenshot(imageBase64);
}

async function processScreenshot(imageBase64: string): Promise<void> {
  try {
    const ocrText = (await ocrService.recognize(imageBase64, "CHN_ENG")).trim();

    if (!ocrText) {
      resultData = {
        ocrText: "",
        translatedText: "未识别到文字",
        fromLang: "auto",
        toLang: "zh",
        done: true,
      };
      resultWindow?.webContents.send("screenshot:result-updated");
      return;
    }

    // 先回显识别结果，再翻译
    resultData = {
      ocrText,
      translatedText: "",
      fromLang: "auto",
      toLang: "zh",
      done: false,
    };
    resultWindow?.webContents.send("screenshot:result-updated");

    try {
      const translated = await translatorService.translate(
        ocrText,
        "auto",
        "zh",
      );
      resultData = {
        ocrText,
        translatedText: translated,
        fromLang: "auto",
        toLang: "zh",
        done: true,
      };
    } catch (translateError) {
      resultData = {
        ocrText,
        translatedText:
          translateError instanceof Error ? translateError.message : "翻译失败",
        fromLang: "auto",
        toLang: "zh",
        done: true,
      };
    }
    resultWindow?.webContents.send("screenshot:result-updated");
  } catch (ocrError) {
    resultData = {
      ocrText: "__error__",
      translatedText:
        ocrError instanceof Error ? ocrError.message : "OCR 识别失败",
      fromLang: "auto",
      toLang: "zh",
      done: true,
    };
    resultWindow?.webContents.send("screenshot:result-updated");
  }
}

function showResultWindow(): void {
  if (resultWindow && !resultWindow.isDestroyed()) {
    resultWindow.show();
    resultWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const width = 480;
  const height = 520;

  resultWindow = new BrowserWindow({
    width,
    height,
    minWidth: 360,
    minHeight: 320,
    x: display.bounds.x + display.bounds.width - width - 40,
    y: display.bounds.y + 80,
    title: "截图翻译结果",
    autoHideMenuBar: true,
    icon: getDevWindowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  resultWindow.on("closed", () => {
    resultWindow = null;
    resultData = null;
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    resultWindow.loadURL(getRendererUrl("result"));
  } else {
    resultWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { w: "result" },
    });
  }
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  if (process.platform === "darwin" && is.dev) {
    app.dock?.setIcon(join(getRuntimeRoot(), "build", "icon.png"));
  }

  electronApp.setAppUserModelId("com.fishtranslate.app");

  ipcMain.handle(
    "translate:text",
    async (_event, text: string, fromLang: string, toLang: string) => {
      const query = text.trim();

      if (!query) {
        return "";
      }

      return translatorService.translate(query, fromLang, toLang);
    },
  );

  ipcMain.handle("shortcut:get", () => screenshotShortcut);

  ipcMain.handle("shortcut:set", (_event, accelerator: string) => {
    screenshotShortcut = accelerator;
    const ok = registerScreenshotShortcut();
    if (ok) {
      saveConfig();
    }
    return ok;
  });

  // 截图翻译相关 IPC
  ipcMain.handle("screenshot:get-overlay-data", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const data = overlayDataByWindow.get(win.id);
    if (!data) return null;
    return { imageUrl: data.imageUrl, scaleFactor: data.scaleFactor };
  });

  ipcMain.handle("screenshot:select", (event, rect: Rect) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    cropAndOcr(win.id, rect);
  });

  ipcMain.handle("screenshot:cancel", () => {
    closeAllOverlays();
  });

  ipcMain.handle("screenshot:get-result-data", () => {
    if (!resultData) {
      return {
        ocrText: "",
        translatedText: "",
        fromLang: "auto",
        toLang: "zh",
        done: false,
      };
    }
    return resultData;
  });

  loadConfig();
  registerScreenshotShortcut();

  createTray();
  createWindow();

  app.on("activate", function () {
    showMainWindow();
  });
});

// 窗口全部关闭时不退出程序，保持在系统托盘中运行；
// 仅在通过托盘“退出程序”触发退出时才真正关闭。
app.on("window-all-closed", () => {
  if (isQuitting) {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  translatorService.dispose();
  ocrService.dispose();
  stopHookWorker();
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});
