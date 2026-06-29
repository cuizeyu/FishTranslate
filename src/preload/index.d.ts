import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      translate: (text: string, fromLang: string, toLang: string) => Promise<string>
      getScreenshotShortcut: () => Promise<string>
      setScreenshotShortcut: (accelerator: string) => Promise<boolean>
    }
  }
}
