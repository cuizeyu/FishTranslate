import { ElectronAPI } from '@electron-toolkit/preload'

type ResultData = {
  ocrText: string
  translatedText: string
  fromLang: string
  toLang: string
  done: boolean
}
type Rect = { x: number; y: number; width: number; height: number }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      translate: (text: string, fromLang: string, toLang: string) => Promise<string>
      getScreenshotShortcut: () => Promise<string>
      setScreenshotShortcut: (accelerator: string) => Promise<boolean>
      screenshot: {
        getOverlayData: () => Promise<OverlayData>
        select: (rect: Rect) => Promise<void>
        cancel: () => Promise<void>
        getResultData: () => Promise<ResultData>
        onResultUpdated: (callback: () => void) => () => void
      }
    }
  }
}
