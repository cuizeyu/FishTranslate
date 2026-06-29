import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义暴露给渲染进程的 API
const api = {
  translate: (text: string, fromLang: string, toLang: string): Promise<string> =>
    ipcRenderer.invoke('translate:text', text, fromLang, toLang),
  getScreenshotShortcut: (): Promise<string> => ipcRenderer.invoke('shortcut:get'),
  setScreenshotShortcut: (accelerator: string): Promise<boolean> =>
    ipcRenderer.invoke('shortcut:set', accelerator),
  screenshot: {
    getOverlayData: (): Promise<{ imageUrl: string; scaleFactor: number }> =>
      ipcRenderer.invoke('screenshot:get-overlay-data'),
    select: (rect: { x: number; y: number; width: number; height: number }): Promise<void> =>
      ipcRenderer.invoke('screenshot:select', rect),
    cancel: (): Promise<void> => ipcRenderer.invoke('screenshot:cancel'),
    getResultData: (): Promise<{
      ocrText: string
      translatedText: string
      fromLang: string
      toLang: string
      done: boolean
    }> => ipcRenderer.invoke('screenshot:get-result-data'),
    onResultUpdated: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('screenshot:result-updated', handler)
      return () => ipcRenderer.removeListener('screenshot:result-updated', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (在未开启上下文隔离时)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
