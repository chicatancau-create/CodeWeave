/** 全局搜索（N1）：对本地课程/挑战/项目标题做包含匹配的纯函数。不读取认证数据。 */

export type SearchTarget = {
  id: string
  type: 'lesson' | 'challenge' | 'project'
  /** 主标题 */
  title: string
  /** 副标题（语言/轨道/文件数） */
  subtitle: string
  /**
   * LINK-07：别名与来源定位。
   *
   * 资料库主题名（如「流程控制语句」）往往不等于课程标题（如「条件分支：让程序做决定」），
   * 只匹配标题会让用户搜不到自己知道的那个名字；方案 §8.2 也要求
   * 「旧标题可找到新主题」。因此把来源标题链等作为别名参与匹配。
   */
  aliases?: string[]
}

export type SearchMatch = 'title' | 'subtitle' | 'alias'
export type SearchResult = SearchTarget & {
  /** 命中位置信息 */
  matchedIn: SearchMatch
  /** 命中别名时的具体别名，用于在结果里说明「为什么匹配」 */
  matchedAlias?: string
}

const MAX_RESULTS = 8

export function filterTargets(targets: SearchTarget[], keyword: string): SearchResult[] {
  const trimmed = keyword.trim().toLowerCase()
  if (!trimmed) return []
  const results: SearchResult[] = []
  for (const target of targets) {
    const inTitle = target.title.toLowerCase().includes(trimmed)
    const inSubtitle = target.subtitle.toLowerCase().includes(trimmed)
    // 别名按顺序取第一个命中的，便于界面解释匹配原因
    const matchedAlias = inTitle || inSubtitle
      ? undefined
      : target.aliases?.find((alias) => alias.toLowerCase().includes(trimmed))
    if (inTitle || inSubtitle || matchedAlias !== undefined) {
      results.push({
        ...target,
        matchedIn: matchedAlias !== undefined ? 'alias' : inTitle ? 'title' : 'subtitle',
        matchedAlias,
      })
    }
    if (results.length >= MAX_RESULTS) break
  }
  return results
}
