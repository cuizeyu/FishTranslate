import { useEffect, useState } from 'react'
import { Input } from 'antd'
import './App.scss'

const { TextArea } = Input

function App() {
  const [sourceText, setSourceText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [error, setError] = useState('')

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
        const result = await window.api.translate(query)

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
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sourceText])

  const resultContent = (() => {
    if (error) return error
    if (isTranslating) return 'Translating...'
    if (translatedText) return translatedText
    return ''
  })()

  return (
    <main className="app">
      <section className="translate-panel translate-panel--source">
        <TextArea
          className="translate-panel__textarea"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          placeholder="请输入文本"
          autoSize={false}
          variant="borderless"
        />
      </section>

      <section className="translate-panel translate-panel--result">
        <div className={`translate-panel__content${error ? ' translate-panel__content--error' : ''}`}>
          {resultContent}
        </div>
      </section>
    </main>
  )
}

export default App
