import { useEffect, useRef, useState } from 'react'
import './ScreenshotOverlay.scss'

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }

function normalizeRect(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return { x, y, width, height }
}

function ScreenshotOverlay() {
  const [imageUrl, setImageUrl] = useState('')
  const [scaleFactor, setScaleFactor] = useState(1)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    window.api.screenshot.getOverlayData().then((data) => {
      setImageUrl(data.imageUrl)
      setScaleFactor(data.scaleFactor)
    })
  }, [])

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.api.screenshot.cancel()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  const toLocalPoint = (e: React.MouseEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const p = toLocalPoint(e)
    setStart(p)
    setCurrent(p)
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    if (!start) return
    setCurrent(toLocalPoint(e))
  }

  const handleMouseUp = (e: React.MouseEvent): void => {
    if (!start) return
    const end = toLocalPoint(e)
    const rect = normalizeRect(start, end)
    const imgEl = imgRef.current
    const imgRect = imgEl?.getBoundingClientRect()
    setStart(null)
    setCurrent(null)
    // 太小的选区视为点击，取消
    if (rect.width < 4 || rect.height < 4) {
      window.api.screenshot.cancel()
      return
    }
    if (!imgEl || !imgRect || imgRect.width === 0 || imgRect.height === 0) {
      window.api.screenshot.cancel()
      return
    }
    // 选区相对于 img 显示框的 CSS 坐标，按显示框→原图像素的比例映射到图片像素
    // 这样无论 Windows 把窗口实际尺寸缩成多少，裁剪都能对上原图
    const naturalWidth = imgEl.naturalWidth
    const naturalHeight = imgEl.naturalHeight
    const relX = rect.x - imgRect.left
    const relY = rect.y - imgRect.top
    const cropRect = {
      x: Math.round((relX / imgRect.width) * naturalWidth),
      y: Math.round((relY / imgRect.height) * naturalHeight),
      width: Math.round((rect.width / imgRect.width) * naturalWidth),
      height: Math.round((rect.height / imgRect.height) * naturalHeight)
    }
    window.api.screenshot.select(cropRect)
  }

  const selRect = start && current ? normalizeRect(start, current) : null

  return (
    <div
      ref={containerRef}
      className="screenshot-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {imageUrl && (
        <img
          ref={imgRef}
          className="screenshot-overlay__bg"
          src={imageUrl}
          alt=""
          draggable={false}
        />
      )}
      <div className="screenshot-overlay__dim" />
      {selRect && (
        <>
          <div
            className="screenshot-overlay__hole"
            style={{
              left: selRect.x,
              top: selRect.y,
              width: selRect.width,
              height: selRect.height,
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: '100% 100%',
              backgroundPosition: `-${selRect.x}px -${selRect.y}px`,
              backgroundRepeat: 'no-repeat'
            }}
          />
          <div
            className="screenshot-overlay__border"
            style={{
              left: selRect.x,
              top: selRect.y,
              width: selRect.width,
              height: selRect.height
            }}
          />
          <div
            className="screenshot-overlay__size"
            style={{
              left: selRect.x,
              top: selRect.y + selRect.height + 6
            }}
          >
            {Math.round(selRect.width / scaleFactor)} × {Math.round(selRect.height / scaleFactor)}
          </div>
        </>
      )}
      <div className="screenshot-overlay__tip">拖动鼠标选择区域，按 Esc 取消</div>
    </div>
  )
}

export default ScreenshotOverlay
