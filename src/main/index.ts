import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const APP_NAME = '鱼语翻译'
const TRANSLATE_TIMEOUT = 45_000

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
  const bundledPython = join(getRuntimeRoot(), '.venv', 'Scripts', 'python.exe')

  if (existsSync(bundledPython)) {
    return { command: bundledPython, argsPrefix: [] }
  }

  return { command: 'python', argsPrefix: [] }
}

class PythonTranslatorService {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()

  translate(text: string): Promise<string> {
    const child = this.ensureProcess()
    const id = this.nextId++
    const payload = JSON.stringify({ id, text }) + '\n'

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
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: is.dev ? join(__dirname, '../../build/icon.ico') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

app.whenReady().then(() => {
  app.setName(APP_NAME)
  electronApp.setAppUserModelId('com.fishtranslate.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('translate:text', async (_event, text: string) => {
    const query = text.trim()

    if (!query) {
      return ''
    }

    return translatorService.translate(query)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  translatorService.dispose()
})
