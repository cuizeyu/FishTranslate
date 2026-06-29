import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义暴露给渲染进程的 API
const api = {
  translate: (text: string, fromLang: string, toLang: string): Promise<string> =>
    ipcRenderer.invoke('translate:text', text, fromLang, toLang)
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
