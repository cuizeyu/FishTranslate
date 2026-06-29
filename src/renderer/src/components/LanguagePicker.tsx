import { useMemo, useState, useEffect, useRef } from 'react'
import { Modal, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { languageGroups, quickLanguages, type Language } from '../data/languages'
import './LanguagePicker.scss'

type Props = {
  open: boolean
  title: string
  selectedCode: string
  excludeCode?: string
  showAuto?: boolean
  onSelect: (language: Language) => void
  onClose: () => void
}

function LanguagePicker({
  open,
  title,
  selectedCode,
  excludeCode,
  showAuto = true,
  onSelect,
  onClose
}: Props) {
  const [keyword, setKeyword] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (!open) {
      setKeyword('')
    }
  }, [open])

  const filteredGroups = useMemo(() => {
    const kw = keyword.trim().toLowerCase()

    if (!kw) {
      return languageGroups.filter((group) => {
        if (!showAuto && group.letter === '#') {
          return group.languages.some((lang) => lang.code !== 'auto')
        }
        return true
      })
    }

    return languageGroups
      .map((group) => ({
        ...group,
        languages: group.languages.filter((lang) => {
          if (lang.code === excludeCode) return false
          return (
            lang.name.toLowerCase().includes(kw) ||
            lang.enName.toLowerCase().includes(kw) ||
            lang.code.toLowerCase().includes(kw)
          )
        })
      }))
      .filter((group) => group.languages.length > 0)
  }, [keyword, excludeCode, showAuto])

  const availableQuick = useMemo(() => {
    return quickLanguages.filter((lang) => {
      if (!showAuto && lang.code === 'auto') return false
      return lang.code !== excludeCode
    })
  }, [excludeCode, showAuto])

  const letters = useMemo(() => {
    return filteredGroups.map((group) => group.letter)
  }, [filteredGroups])

  const handleSelect = (language: Language): void => {
    onSelect(language)
    onClose()
  }

  const scrollToLetter = (letter: string): void => {
    const el = sectionRefs.current[letter]
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: el.offsetTop - scrollRef.current.offsetTop - 8,
        behavior: 'smooth'
      })
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      className="lang-picker"
      closable
    >
      {/* 快捷语言标签 */}
      <div className="lang-picker__quick">
        {availableQuick.map((lang) => (
          <button
            key={lang.code}
            className={`lang-picker__chip${lang.code === selectedCode ? ' lang-picker__chip--active' : ''}`}
            onClick={() => handleSelect(lang)}
            type="button"
          >
            {lang.name}
          </button>
        ))}
      </div>

      {/* 搜索框 */}
      <Input
        className="lang-picker__search"
        placeholder="搜索语言"
        allowClear
        prefix={<SearchOutlined />}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />

      {/* 主体：字母分组网格 + 右侧索引 */}
      <div className="lang-picker__body">
        <div className="lang-picker__scroll" ref={scrollRef}>
          {filteredGroups.length === 0 && (
            <div className="lang-picker__empty">未找到匹配的语言</div>
          )}

          {filteredGroups.map((group) => (
            <section
              key={group.letter}
              className="lang-picker__section"
              ref={(el) => {
                sectionRefs.current[group.letter] = el
              }}
            >
              <h4 className="lang-picker__letter">{group.letter}</h4>
              <div className="lang-picker__grid">
                {group.languages
                  .filter((lang) => {
                    if (lang.code === excludeCode) return false
                    if (!showAuto && lang.code === 'auto') return false
                    return true
                  })
                  .map((lang) => (
                    <button
                      key={lang.code}
                      className={`lang-picker__item${lang.code === selectedCode ? ' lang-picker__item--active' : ''}`}
                      onClick={() => handleSelect(lang)}
                      type="button"
                      title={lang.enName}
                    >
                      <span className="lang-picker__item-name">{lang.name}</span>
                      {lang.ai && <span className="lang-picker__ai">AI</span>}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>

        {/* 右侧字母索引 */}
        {!keyword && letters.length > 0 && (
          <nav className="lang-picker__index">
            {letters.map((letter) => (
              <button
                key={letter}
                className="lang-picker__index-item"
                onClick={() => scrollToLetter(letter)}
                type="button"
              >
                {letter}
              </button>
            ))}
          </nav>
        )}
      </div>
    </Modal>
  )
}

export default LanguagePicker
