import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import ScreenshotOverlay from './screenshots/ScreenshotOverlay'
import ScreenshotResult from './screenshots/ScreenshotResult'
import './assets/styles/global.scss'

function getQueryParam(name: string): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

const win = getQueryParam('w')

let content: React.ReactNode = <App />
if (win === 'overlay') {
  content = <ScreenshotOverlay />
} else if (win === 'result') {
  content = <ScreenshotResult />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>{content}</ConfigProvider>
  </React.StrictMode>
)
