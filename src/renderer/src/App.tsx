import { useEffect, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { SwapOutlined, DownOutlined } from '@ant-design/icons'
import LanguagePicker from './components/LanguagePicker'
import { findLanguage, type Language } from './data/languages'
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

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to'>('from')

  const openPicker = (target: 'from' | 'to'): void => {
    setPickerTarget(target)
    setPickerOpen(true)
  }

  const handlePickerSelect = (language: Language): void => {
    if (pickerTarget === 'from') {
      // 如果和目标语言相同，自动交换
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
    // 自动检测不能作为目标语言
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
        <span className="lang-bar__mode">机翻 · 通用领域</span>
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
