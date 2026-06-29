import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import appIcon from '../../resources/icon.png?asset'

const APP_NAME = '鱼语翻译'
const TRANSLATE_TIMEOUT = 45_000

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

type PythonResponse = {
  id: number
  ok: boolean
  result?: string
  error?: string
}

type PendingRequest = {
  resolve: (value: string) => void
  reject: (reason?: Error) => void
  timer: NodeJS.Timeout
}

function getRuntimeRoot(): string {
  return is.dev ? join(__dirname, '../..') : process.resourcesPath
}

function getPythonCommand(): { command: string; argsPrefix: string[] } {
  const runtimeRoot = getRuntimeRoot()
  const candidates = process.platform === 'win32'
    ? [join(runtimeRoot, '.venv', 'Scripts', 'python.exe'), 'python']
    : [join(runtimeRoot, '.venv', 'bin', 'python3'), join(runtimeRoot, '.venv', 'bin', 'python'), 'python3', 'python']

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        return { command: candidate, argsPrefix: [] }
      }

      continue
    }

    return { command: candidate, argsPrefix: [] }
  }

  return { command: 'python', argsPrefix: [] }
}

function getDevWindowIcon(): string | undefined {
  if (!is.dev) {
    return undefined
  }

  const runtimeRoot = getRuntimeRoot()

  if (process.platform === 'darwin') {
    return join(runtimeRoot, 'build', 'icon.png')
  }

  if (process.platform === 'win32') {
    return join(runtimeRoot, 'build', 'icon.ico')
  }

  return join(runtimeRoot, 'build', 'icon.png')
}

class PythonTranslatorService {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()

  translate(text: string, fromLang: string, toLang: string): Promise<string> {
    const child = this.ensureProcess()
    const id = this.nextId++
    const payload = JSON.stringify({ id, text, from: fromLang, to: toLang }) + '\n'

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('翻译超时，请稍后重试'))
      }, TRANSLATE_TIMEOUT)

      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return

        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
    this.rejectAll(new Error('翻译服务已关闭'))
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child
    }

    const scriptPath = is.dev
      ? join(getRuntimeRoot(), 'resources', 'python', 'baidu_translate.py')
      : join(getRuntimeRoot(), 'python', 'baidu_translate.py')
    const { command, argsPrefix } = getPythonCommand()
    const child = spawn(command, [...argsPrefix, scriptPath, '--serve'], {
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      },
      windowsHide: true
    })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk) => {
      console.warn('[translator]', chunk.trim())
    })
    child.on('error', (error) => {
      this.child = null
      this.rejectAll(error)
    })
    child.on('close', () => {
      this.child = null
      this.rejectAll(new Error('翻译服务已退出，请重试'))
    })

    this.child = child
    return child
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n')
      if (newlineIndex === -1) return

      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (line) {
        this.handleResponseLine(line)
      }
    }
  }

  private handleResponseLine(line: string): void {
    let response: PythonResponse

    try {
      response = JSON.parse(line)
    } catch {
      console.warn('[translator] invalid response:', line)
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(response.id)

    if (response.ok) {
      pending.resolve(response.result ?? '')
      return
    }

    pending.reject(new Error(response.error || '翻译失败，请稍后重试'))
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }

    this.pending.clear()
  }
}

const translatorService = new PythonTranslatorService()

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
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 禁用所有打开 DevTools 的快捷键
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && (input.key === 'I' || input.key === 'i')) ||
      (input.control && input.shift && (input.key === 'J' || input.key === 'j')) ||
      (input.control && (input.key === 'U' || input.key === 'u'))
    ) {
      _event.preventDefault()
    }
  })

  // 点击关闭按钮时隐藏到托盘，而不是退出程序
  let hasNotifiedMinimize = false
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
      if (process.platform === 'darwin') {
        app.dock?.hide()
      }

      // 首次最小化时提示用户
      if (!hasNotifiedMinimize) {
        hasNotifiedMinimize = true
        new Notification({
          title: APP_NAME,
          body: '程序已最小化到系统托盘，右键托盘图标可退出程序。',
          icon: getTrayIconImage()
        }).show()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境加载本地服务，生产环境加载打包后的 HTML
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (process.platform === 'darwin') {
    app.dock?.show()
  }

  mainWindow.show()
  mainWindow.focus()
}

function getTrayIconImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(appIcon)

  if (image.isEmpty()) {
    return image
  }

  // 托盘图标使用小尺寸，避免显示过大
  return image.resize({ width: 16, height: 16 })
}

function createTray(): void {
  if (tray) {
    return
  }

  tray = new Tray(getTrayIconImage())
  tray.setToolTip(APP_NAME)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 左键单击托盘图标打开窗口
  tray.on('click', () => showMainWindow())
}

app.whenReady().then(() => {
  app.setName(APP_NAME)
  if (process.platform === 'darwin' && is.dev) {
    app.dock?.setIcon(join(getRuntimeRoot(), 'build', 'icon.png'))
  }

  electronApp.setAppUserModelId('com.fishtranslate.app')

  ipcMain.handle('translate:text', async (_event, text: string, fromLang: string, toLang: string) => {
    const query = text.trim()

    if (!query) {
      return ''
    }

    return translatorService.translate(query, fromLang, toLang)
  })

  createTray()
  createWindow()

  app.on('activate', function () {
    showMainWindow()
  })
})

// 窗口全部关闭时不退出程序，保持在系统托盘中运行；
// 仅在通过托盘“退出程序”触发退出时才真正关闭。
app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  translatorService.dispose()
  tray?.destroy()
  tray = null
})
