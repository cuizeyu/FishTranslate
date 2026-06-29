import rawData from './languages.json'

export type Language = {
  code: string
  name: string
  enName: string
  ai: boolean
}

export type LanguageGroup = {
  letter: string
  languages: Language[]
}

const data = rawData as { groups: LanguageGroup[] }

export const languageGroups: LanguageGroup[] = data.groups

// 扁平化列表，方便搜索
export const allLanguages: Language[] = data.groups.flatMap((group) => group.languages)

// 快捷语言（顶部标签）
export const quickLanguages: Language[] = [
  allLanguages.find((lang) => lang.code === 'auto'),
  allLanguages.find((lang) => lang.code === 'zh'),
  allLanguages.find((lang) => lang.code === 'en'),
  allLanguages.find((lang) => lang.code === 'jp')
].filter(Boolean) as Language[]

export function findLanguage(code: string): Language | undefined {
  return allLanguages.find((lang) => lang.code === code)
}
