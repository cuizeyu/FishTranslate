import { useEffect, useState, useCallback, useMemo } from 'react'
import { Popover, Modal, message } from 'antd'
import { CameraOutlined } from '@ant-design/icons'
import './ScreenshotTool.scss'

function detectIsMac(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
}

// 将 Electron accelerator 字符串转换为友好的展示文本
function formatAccelerator(accelerator: string): string {
  const isMac = detectIsMac()
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Command':
        case 'Cmd':
          return '⌘'
        case 'Control':
        case 'Ctrl':
          return isMac ? '⌃' : 'Ctrl'
        case 'Alt':
        case 'Option':
          return isMac ? '⌥' : 'Alt'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        case 'Return':
        case 'Enter':
          return 'Enter'
        case 'Space':
          return 'Space'
        default:
          return part.length === 1 ? part.toUpperCase() : part
      }
    })
    .join(' + ')
}

// 将键盘事件转换为 Electron accelerator 字符串
function eventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // 必须至少含一个修饰键
  if (parts.length === 0) return null

  let key = e.key
  if (key === 'Escape') return '__cancel__'
  if (key === ' ') key = 'Space'
  else if (key === 'Enter') key = 'Return'
  else if (key === 'Backspace') key = 'Backspace'
  else if (key === 'Tab') key = 'Tab'
  else if (key === 'Insert') key = 'Insert'
  else if (key === 'Delete') key = 'Delete'
  else if (key === 'Home') key = 'Home'
  else if (key === 'End') key = 'End'
  else if (key === 'PageUp') key = 'PageUp'
  else if (key === 'PageDown') key = 'PageDown'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) key = key
  else if (key.length === 1) key = key.toUpperCase()
  else return null

  // 单独按下修饰键不算
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null

  parts.push(key)
  return parts.join('+')
}

function ScreenshotTool() {
  const [shortcut, setShortcut] = useState('')
  const [recorderOpen, setRecorderOpen] = useState(false)
  const [recording, setRecording] = useState<string | null>(null)
  const isMac = useMemo(() => detectIsMac(), [])

  const refreshShortcut = useCallback(async () => {
    const current = await window.api.getScreenshotShortcut()
    setShortcut(current)
  }, [])

  useEffect(() => {
    refreshShortcut()
  }, [refreshShortcut])

  const handleKeydown = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const result = eventToAccelerator(e)
    if (result === '__cancel__') {
      setRecorderOpen(false)
      setRecording(null)
      return
    }
    if (result) setRecording(result)
  }, [])

  useEffect(() => {
    if (!recorderOpen) {
      setRecording(null)
      return
    }
    window.addEventListener('keydown', handleKeydown, true)
    return () => window.removeEventListener('keydown', handleKeydown, true)
  }, [recorderOpen, handleKeydown])

  const handleConfirm = async (): Promise<void> => {
    if (!recording) {
      message.warning('请先按下一个快捷键组合')
      return
    }
    try {
      const ok = await window.api.setScreenshotShortcut(recording)
      if (ok) {
        setShortcut(recording)
        setRecorderOpen(false)
        setRecording(null)
        message.success('快捷键已更新')
      } else {
        message.error('设置失败，请重试')
      }
    } catch {
      message.error('设置失败，请重试')
    }
  }

  const popoverContent = (
    <div className="screenshot-popover">
      <p className="screenshot-popover__desc">快捷截图，随时随地翻译 ~</p>
      <div className="screenshot-popover__row">
        <span className="screenshot-popover__label">当前快捷键</span>
        <kbd className="screenshot-popover__kbd">{shortcut ? formatAccelerator(shortcut) : '未设置'}</kbd>
      </div>
      <div className="screenshot-popover__row">
        <button
          type="button"
          className="screenshot-popover__set"
          onClick={() => {
            setRecording(null)
            setRecorderOpen(true)
          }}
        >
          设置快捷键
        </button>
      </div>
    </div>
  )

  return (
    <>
      <Popover
        content={popoverContent}
        trigger="hover"
        placement="topLeft"
        overlayClassName="screenshot-popover-overlay"
      >
        <button type="button" className="screenshot-tool">
          <CameraOutlined />
          <span>截图翻译</span>
        </button>
      </Popover>

      <Modal
        title="设置截图翻译快捷键"
        open={recorderOpen}
        onCancel={() => setRecorderOpen(false)}
        onOk={handleConfirm}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !recording }}
        destroyOnClose
      >
        <div className="shortcut-recorder">
          {shortcut && (
            <p className="shortcut-recorder__current">
              当前快捷键：<kbd>{formatAccelerator(shortcut)}</kbd>
            </p>
          )}
          <p className="shortcut-recorder__hint">
            请按下你想设置的快捷键组合（需包含 {isMac ? '⌘ / ⌥ / ⇧' : 'Ctrl / Alt / Shift'} 中至少一个）。
            设置后即使其他软件占用了同名快捷键，也会被本应用抢占。
          </p>
          <div className={`shortcut-recorder__box${recording ? ' shortcut-recorder__box--active' : ''}`}>
            {recording ? formatAccelerator(recording) : '等待按键...'}
          </div>
          <p className="shortcut-recorder__tip">按 Esc 取消</p>
        </div>
      </Modal>
    </>
  )
}

export default ScreenshotTool
