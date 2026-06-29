import { useEffect, useState, useCallback } from 'react'
import { Button, Tooltip, Dropdown, message } from 'antd'
import type { MenuProps } from 'antd'
import { SwapOutlined, DownOutlined, CopyOutlined, HistoryOutlined } from '@ant-design/icons'
import LanguagePicker from './components/LanguagePicker'
import { findLanguage, type Language } from './data/languages'
import { loadHistory, addHistory, type HistoryItem } from './data/history'
import './App.scss'

const DEFAULT_FROM: Language = { code: 'auto', name: '自动检测', enName: 'Auto Detect', ai: false }
const DEFAULT_TO: Language = { code: 'en', name: '英语', enName: 'English', ai: true }

function App() {
  const [sourceText, setSourceText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [error, setError] = useState('')
  const [fromLang, setFromLang] = useState<Language>(DEFAULT_FROM)
  const [toLang, setToLang] = useState<Language>(DEFAULT_TO)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [copied, setCopied] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to'>('from')

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const openPicker = (target: 'from' | 'to'): void => {
    setPickerTarget(target)
    setPickerOpen(true)
  }

  const handlePickerSelect = (language: Language): void => {
    if (pickerTarget === 'from') {
      if (language.code === toLang.code) {
        setToLang(fromLang)
      }
      setFromLang(language)
    } else {
      if (language.code === fromLang.code) {
        setFromLang(toLang)
      }
      setToLang(language)
    }
  }

  const handleSwap = (): void => {
    if (fromLang.code === 'auto') {
      const zh = findLanguage('zh')
      if (zh) {
        setFromLang(toLang)
        setToLang(zh)
      }
      return
    }
    setFromLang(toLang)
    setToLang(fromLang)
  }

  useEffect(() => {
    const query = sourceText.trim()

    if (!query) {
      setTranslatedText('')
      setError('')
      setIsTranslating(false)
      return
    }

    let cancelled = false
    setIsTranslating(true)
    setError('')

    const timer = window.setTimeout(async () => {
      try {
        const result = await window.api.translate(query, fromLang.code, toLang.code)

        if (!cancelled) {
          setTranslatedText(result)
          // 翻译成功后存入历史记录
          if (result) {
            setHistory(addHistory({
              source: query,
              target: result,
              fromCode: fromLang.code,
              toCode: toLang.code
            }))
          }
        }
      } catch (unknownError) {
        if (!cancelled) {
          setTranslatedText('')
          setError(unknownError instanceof Error ? unknownError.message : '翻译失败，请稍后重试')
        }
      } finally {
        if (!cancelled) {
          setIsTranslating(false)
        }
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sourceText, fromLang, toLang])

  const handleCopy = useCallback(async () => {
    if (!translatedText) return

    try {
      await navigator.clipboard.writeText(translatedText)
      setCopied(true)
      message.success('已复制到剪贴板', 0.8)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      message.error('复制失败')
    }
  }, [translatedText])

  const handleHistoryClick = (item: HistoryItem): void => {
    setSourceText(item.source)
    setTranslatedText(item.target)
    const fromLangItem = findLanguage(item.fromCode)
    const toLangItem = findLanguage(item.toCode)
    if (fromLangItem) setFromLang(fromLangItem)
    if (toLangItem) setToLang(toLangItem)
  }

  const historyMenuItems: MenuProps['items'] = history.length === 0
    ? [{ key: 'empty', label: '暂无历史记录', disabled: true }]
    : history.map((item) => ({
        key: item.id,
        label: (
          <div className="history-item" onClick={() => handleHistoryClick(item)}>
            <span className="history-item__source">{item.source}</span>
            <span className="history-item__time">
              {new Date(item.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )
      }))

  const resultContent = (() => {
    if (error) return error
    if (isTranslating) return 'Translating...'
    if (translatedText) return translatedText
    return ''
  })()

  return (
    <main className="app">
      {/* 顶部语言选择栏 */}
      <header className="lang-bar">
        <Dropdown menu={{ items: historyMenuItems }} trigger={['click']} overlayClassName="history-dropdown">
          <button className="lang-bar__select" type="button" title="历史记录">
            <HistoryOutlined />
            <span>历史记录</span>
            <DownOutlined className="lang-bar__arrow" />
          </button>
        </Dropdown>

        <button className="lang-bar__select" onClick={() => openPicker('from')} type="button">
          <span>{fromLang.name}</span>
          <DownOutlined className="lang-bar__arrow" />
        </button>

        <Tooltip title="交换语言">
          <Button
            className="lang-bar__swap"
            shape="circle"
            size="small"
            icon={<SwapOutlined />}
            onClick={handleSwap}
          />
        </Tooltip>

        <button className="lang-bar__select" onClick={() => openPicker('to')} type="button">
          <span>{toLang.name}</span>
          <DownOutlined className="lang-bar__arrow" />
        </button>

        <div className="lang-bar__spacer" />
      </header>

      {/* 双栏翻译区 */}
      <div className="translate-area">
        <section className="translate-panel translate-panel--source">
          <textarea
            className="translate-panel__textarea"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="请输入文本"
            spellCheck={false}
          />
        </section>

        <section className="translate-panel translate-panel--result">
          <div className={`translate-panel__content${error ? ' translate-panel__content--error' : ''}`}>
            {resultContent}
          </div>
          <Tooltip title={copied ? '已复制' : '复制译文'}>
            <Button
              className="translate-panel__copy"
              shape="circle"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              disabled={!translatedText}
            />
          </Tooltip>
        </section>
      </div>

      <LanguagePicker
        open={pickerOpen}
        title={pickerTarget === 'from' ? '选择源语言' : '选择目标语言'}
        selectedCode={pickerTarget === 'from' ? fromLang.code : toLang.code}
        excludeCode={pickerTarget === 'from' ? toLang.code : fromLang.code}
        showAuto={pickerTarget === 'from'}
        onSelect={handlePickerSelect}
        onClose={() => setPickerOpen(false)}
      />
    </main>
  )
}

export default App
