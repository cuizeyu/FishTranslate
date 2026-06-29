export type HistoryItem = {
  id: string
  source: string
  target: string
  fromCode: string
  toCode: string
  time: number
}

const STORAGE_KEY = 'fish-translate-history'
const MAX_ITEMS = 50

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as HistoryItem[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function addHistory(item: Omit<HistoryItem, 'id' | 'time'>): HistoryItem[] {
  const history = loadHistory()
  const newItem: HistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now()
  }

  // 最新的放在最前面，最多保留 50 条
  const updated = [newItem, ...history].slice(0, MAX_ITEMS)
  saveHistory(updated)
  return updated
}

export function clearHistory(): void {
  saveHistory([])
}

function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 存储满或不可用时静默失败
  }
}
