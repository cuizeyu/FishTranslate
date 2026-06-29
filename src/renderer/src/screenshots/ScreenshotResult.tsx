import { useEffect, useState } from 'react'
import { Button, Tooltip, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import './ScreenshotResult.scss'

type ResultData = {
  ocrText: string
  translatedText: string
  fromLang: string
  toLang: string
  done: boolean
}

function copyText(text: string, label: string): void {
  if (!text) return
  navigator.clipboard
    .writeText(text)
    .then(() => message.success(`${label}已复制`, 0.8))
    .catch(() => message.error('复制失败'))
}

function ScreenshotResult() {
  const [data, setData] = useState<ResultData | null>(null)

  useEffect(() => {
    const refresh = (): void => {
      window.api.screenshot.getResultData().then((d) => setData(d))
    }
    refresh()
    const off = window.api.screenshot.onResultUpdated(refresh)
    return () => off()
  }, [])

  if (!data) {
    return (
      <div className="screenshot-result screenshot-result--loading">
        <p>正在识别并翻译...</p>
      </div>
    )
  }

  if (data.ocrText === '__error__') {
    return (
      <div className="screenshot-result screenshot-result--error">
        <p>{data.translatedText || '识别失败'}</p>
      </div>
    )
  }

  return (
    <div className="screenshot-result">
      <section className="screenshot-result__panel">
        <header className="screenshot-result__head">
          <span>识别原文</span>
          <Tooltip title="复制原文">
            <Button
              size="small"
              shape="circle"
              icon={<CopyOutlined />}
              onClick={() => copyText(data.ocrText, '原文')}
            />
          </Tooltip>
        </header>
        <div className="screenshot-result__content">{data.ocrText || '（未识别到文字）'}</div>
      </section>

      <section className="screenshot-result__panel">
        <header className="screenshot-result__head">
          <span>
            翻译结果
            {!data.done && data.ocrText && <span className="screenshot-result__pending"> 翻译中...</span>}
          </span>
          <Tooltip title="复制译文">
            <Button
              size="small"
              shape="circle"
              icon={<CopyOutlined />}
              onClick={() => copyText(data.translatedText, '译文')}
            />
          </Tooltip>
        </header>
        <div className="screenshot-result__content">
          {data.translatedText || (!data.done ? '' : '（无）')}
        </div>
      </section>
    </div>
  )
}

export default ScreenshotResult
