/**
 * 资料库正式进度的只读投影（LINK-08，02 号方案 §4 正式学习事实规则）。
 *
 * 铁律（依据 `进度追踪.md` 自身的更新规则与 §8 声明）：
 * - **只读**：本项目不修改进度追踪、不写回、不重排任何笔记。
 * - **不确定必须保持不确定**：`无法确认`、`暂估`、`0—1 级` 不能折算成一个整数。
 *   只有 `N 级` 才是确定数值；区间仍是区间。
 * - **解析不了就展示原文**：任何结构不符的块进入 `unparsed`，附原文与原因
 *   （界面显示「结构待适配」），绝不默认成 0、绝不用猜测值覆盖。
 * - **环境核验 ≠ 学习证据**：环境核验日期单独保留，不推导「环境齐全 = 阶段通过」。
 *
 * 解析范围（用户可见的正式事实）：
 * 当前阶段、阶段状态、证据日期、下一步行动、掌握矩阵、阶段状态总表、环境清单。
 */
import { headings, normalizeText, parseRestrictedFrontmatter, sha256, visibleLines } from '../content/markdown.mjs'

export const PROGRESS_PATH = '全栈工程师学习计划/进度追踪.md'

export const PROGRESS_STATUS = {
  OK: 'ok',
  PARTIAL: 'partial',
  STRUCTURE_UNSUPPORTED: 'structure_unsupported',
  MISSING: 'missing',
}

/** 章节按 `## <编号>. 标题` 的编号定位：标题改名不影响解析，编号缺失才判结构不符。 */
const SECTION_NUMBER = /^(\d+)\.\s*(.*)$/

/**
 * 掌握等级：只有 `N 级` 是确定数值。
 * @returns {{kind:'numeric',value:number,label:string}
 *   | {kind:'range',low:number,high:number,label:string}
 *   | {kind:'uncertain',label:string}}
 */
export function parseMasteryLevel(raw) {
  const text = plainText(raw).trim()
  if (!text) return { kind: 'uncertain', label: '未填写' }
  const numeric = /^(\d+)\s*级$/.exec(text)
  if (numeric) {
    const value = Number(numeric[1])
    return { kind: 'numeric', value, label: `${value} 级` }
  }
  const range = /^(\d+)\s*[—–\-~至]\s*(\d+)\s*级$/.exec(text)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    return { kind: 'range', low, high, label: `${low}—${high} 级` }
  }
  // `无法确认` / `未核验` / `待确认` / `暂估` 等都是不确定，不得转成数字
  return { kind: 'uncertain', label: text }
}

/** 去掉 Markdown 行内标记，得到可比对的纯文本（保留原文另存）。 */
export function plainText(raw) {
  return normalizeText(String(raw ?? ''))
    .replace(/\\\|/g, '|')
    .replace(/\[\[([^\]]+)\]\]/g, (_match, body) => body.split('|').at(-1) ?? body)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim()
}

/** 拆分表格行；支持单元格内的转义竖线 `\|`。 */
export function parseTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const cells = []
  let current = ''
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '|'
      index += 1
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  // 首尾竖线产生空壳单元格，去掉
  if (cells[0]?.trim() === '') cells.shift()
  if (cells.at(-1)?.trim() === '') cells.pop()
  return cells.map((cell) => cell.trim())
}

const isSeparatorRow = (cells) => cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))

/** 按 `## N.` 小节切分，返回每个小节的正文行。 */
function sectionsOf(text) {
  const lines = text.split('\n')
  const marks = headings(text).filter((heading) => heading.level === 2)
  const sections = new Map()
  for (let index = 0; index < marks.length; index += 1) {
    const match = SECTION_NUMBER.exec(marks[index].title)
    if (!match) continue
    const number = match[1]
    const end = marks[index + 1]?.line ?? lines.length + 1
    sections.set(number, {
      number,
      title: match[2].trim(),
      headingLine: marks[index].line,
      body: lines.slice(marks[index].line, end - 1),
    })
  }
  return sections
}

/** 取小节里第一张表格（表头 + 数据行）。 */
function firstTable(section) {
  const rows = []
  for (const line of section.body) {
    const cells = parseTableRow(line)
    if (!cells) {
      if (rows.length > 0) break
      continue
    }
    rows.push(cells)
  }
  if (rows.length < 2) return null
  const header = rows[0]
  const body = rows.slice(1).filter((cells) => !isSeparatorRow(cells))
  return { header, rows: body }
}

/** 表头列名 → 索引；列名变化时返回 -1，由调用方记录「结构待适配」。 */
function columnIndex(header, names) {
  for (const name of names) {
    const index = header.findIndex((cell) => plainText(cell) === name)
    if (index !== -1) return index
  }
  return -1
}

function cellOf(cells, index) {
  if (index < 0) return ''
  return cells[index] ?? ''
}

/** 顶部说明行里的三个日期：结构维护 / 环境核验与补齐 / 最近学习证据。 */
function parseHeaderDates(text) {
  const line = visibleLines(text).map(([, value]) => value).find((value) => value.includes('最近学习证据'))
  if (!line) {
    return {
      value: null,
      unparsed: [{ key: 'headerDates', scope: 'value', reason: '顶部说明行未找到「最近学习证据」', raw: '' }],
    }
  }
  const pick = (label) => {
    const match = new RegExp(`${label}[：:]\\s*(\\d{4}-\\d{2}-\\d{2})`).exec(plainText(line))
    return match?.[1] ?? null
  }
  return {
    value: {
      structureUpdatedOn: pick('结构维护'),
      environmentVerifiedOn: pick('环境核验与补齐'),
      latestEvidenceOn: pick('最近学习证据'),
      raw: line.trim(),
    },
    unparsed: [],
  }
}

/**
 * 解析进度追踪正文。
 * @returns 投影对象（含 status / unparsed），无异常抛出——结构不符只降级、不失败。
 */
export function parseProgress(text, { path = PROGRESS_PATH } = {}) {
  const normalized = normalizeText(text)
  const fileHash = sha256(normalized)
  const unparsed = []

  const header = parseHeaderDates(normalized)
  unparsed.push(...header.unparsed)

  const sections = sectionsOf(normalized)
  const require = (number) => {
    const section = sections.get(number)
    if (!section) {
      unparsed.push({ key: `section-${number}`, scope: 'section', reason: `缺少「## ${number}.」小节`, raw: '' })
      return null
    }
    const table = firstTable(section)
    if (!table) {
      unparsed.push({
        key: `section-${number}`,
        scope: 'section',
        reason: `小节「${section.title}」内没有可解析的表格`,
        raw: section.body.join('\n').trim().slice(0, 2000),
      })
      return null
    }
    return { section, table }
  }

  // §1 当前状态快照：项目 | 当前值 | 证据
  const snapshot = { items: [], raw: '' }
  const section1 = require('1')
  if (section1) {
    const valueIndex = columnIndex(section1.table.header, ['当前值'])
    const evidenceIndex = columnIndex(section1.table.header, ['证据'])
    if (valueIndex === -1) {
      unparsed.push({ key: 'section-1', scope: 'section', reason: '表头缺少「当前值」列', raw: section1.table.header.join(' | ') })
    } else {
      for (const cells of section1.table.rows) {
        const label = plainText(cellOf(cells, 0))
        if (!label) continue
        snapshot.items.push({
          label,
          value: plainText(cellOf(cells, valueIndex)),
          valueRaw: cellOf(cells, valueIndex),
          evidence: plainText(cellOf(cells, evidenceIndex)),
        })
      }
      snapshot.raw = section1.section.body.join('\n').trim()
    }
  }
  const itemOf = (...labels) => snapshot.items.find((item) => labels.some((label) => item.label.includes(label))) ?? null

  // §3 掌握程度矩阵：技能 | 等级 | 状态 | 最新证据
  const mastery = { rows: [], raw: '', note: '' }
  const section3 = require('3')
  if (section3) {
    const levelIndex = columnIndex(section3.table.header, ['等级'])
    const statusIndex = columnIndex(section3.table.header, ['状态'])
    const evidenceIndex = columnIndex(section3.table.header, ['最新证据'])
    if (levelIndex === -1) {
      unparsed.push({ key: 'section-3', scope: 'section', reason: '表头缺少「等级」列', raw: section3.table.header.join(' | ') })
    } else {
      for (const cells of section3.table.rows) {
        const skill = plainText(cellOf(cells, 0))
        if (!skill) continue
        const levelRaw = cellOf(cells, levelIndex)
        const level = parseMasteryLevel(levelRaw)
        if (level.kind === 'uncertain' && !/无法确认|未核验|待确认|暂估|未填写/.test(level.label)) {
          // 既不是数字也不是已知的不确定词：保留原文并显式记录结构待适配。
          // scope=value：只有这一格无法识别，不把整份投影判成结构不受支持。
          unparsed.push({
            key: 'section-3',
            scope: 'value',
            reason: `等级写法未被识别：「${plainText(levelRaw)}」`,
            raw: `${skill} | ${levelRaw}`,
          })
        }
        mastery.rows.push({
          skill,
          level,
          levelRaw,
          status: plainText(cellOf(cells, statusIndex)) || null,
          evidence: plainText(cellOf(cells, evidenceIndex)),
        })
      }
      mastery.raw = section3.section.body.join('\n').trim()
      mastery.note = section3.section.body
        .map((line) => line.trim())
        .find((line) => line.startsWith('>')) ?? ''
    }
  }

  // §6 下一步行动：顺序 | 行动 | 产出物 | 关联
  const nextActions = { rows: [], raw: '' }
  const section6 = require('6')
  if (section6) {
    for (const cells of section6.table.rows) {
      const order = plainText(cellOf(cells, 0))
      const actionRaw = cellOf(cells, 1)
      const action = plainText(actionRaw)
      if (!order && !action) continue
      nextActions.rows.push({
        order,
        action,
        actionRaw,
        deliverable: plainText(cellOf(cells, 2)),
        relation: plainText(cellOf(cells, 3)),
        // `~~...~~` 表示该项已完成或被取代（原文保留）
        done: /~~/.test(actionRaw),
      })
    }
    nextActions.raw = section6.section.body.join('\n').trim()
  }

  // §7 阶段状态总表：阶段 | 名称 | 状态 | 说明
  const stages = { rows: [], raw: '' }
  const section7 = require('7')
  if (section7) {
    for (const cells of section7.table.rows) {
      const id = plainText(cellOf(cells, 0))
      if (!/^S\d+$/.test(id)) {
        if (id) unparsed.push({ key: 'section-7', scope: 'value', reason: `阶段标识未被识别：「${id}」`, raw: cells.join(' | ') })
        continue
      }
      stages.rows.push({
        id,
        name: plainText(cellOf(cells, 1)),
        status: plainText(cellOf(cells, 2)),
        note: plainText(cellOf(cells, 3)),
        raw: cells.join(' | '),
      })
    }
    stages.raw = section7.section.body.join('\n').trim()
  }

  // §2 环境核验清单：环境 | 状态 | 版本 | 证据
  const environment = { rows: [], raw: '', conclusion: '' }
  const section2 = require('2')
  if (section2) {
    for (const cells of section2.table.rows) {
      const name = plainText(cellOf(cells, 0))
      if (!name) continue
      environment.rows.push({
        name,
        status: plainText(cellOf(cells, 1)),
        version: plainText(cellOf(cells, 2)),
        evidence: plainText(cellOf(cells, 3)),
      })
    }
    environment.raw = section2.section.body.join('\n').trim()
    environment.conclusion = section2.section.body
      .map((line) => line.trim())
      .find((line) => line.startsWith('**结论**')) ?? ''
  }

  // §10 会话接续：字段 | 当前记录
  const handoff = { rows: [], raw: '' }
  const section10 = require('10')
  if (section10) {
    for (const cells of section10.table.rows) {
      const field = plainText(cellOf(cells, 0))
      if (!field) continue
      handoff.rows.push({ field, value: plainText(cellOf(cells, 1)) })
    }
    handoff.raw = section10.section.body.join('\n').trim()
  }

  const hasUnparsed = unparsed.length > 0
  /**
   * 状态口径：
   * - `section` 级问题（必需小节缺失、必需列缺失）→ structure_unsupported，界面按原文展示；
   * - `value` 级问题（个别单元格写法未识别）→ partial，该格保持「未识别」但不影响其余投影；
   * - 无问题 → ok。
   */
  const status = unparsed.some((item) => item.scope === 'section')
    ? PROGRESS_STATUS.STRUCTURE_UNSUPPORTED
    : hasUnparsed
      ? PROGRESS_STATUS.PARTIAL
      : PROGRESS_STATUS.OK

  return {
    schemaVersion: 1,
    status,
    source: { path, fileHash, parsedAt: new Date().toISOString() },
    header: header.value,
    snapshot: {
      items: snapshot.items,
      currentStage: itemOf('当前阶段'),
      stageProgress: itemOf('阶段进度'),
      stagePassable: itemOf('阶段能否通过'),
      nextStage: itemOf('下一阶段'),
      deadline: itemOf('计划截止'),
      mainBlocker: itemOf('最大阻塞'),
    },
    mastery,
    nextActions,
    stages,
    environment,
    handoff,
    unparsed,
    /**
     * 只读声明：软件只投影这些事实，不推断阶段通过、不提升任何等级。
     * 环境核验日期（header.environmentVerifiedOn）与学习证据日期分开保留。
     */
    readOnlyNotice: '本投影只读；环境核验不构成学习证据，不提升任何掌握等级，也不代表阶段通过。',
  }
}

/** 供测试与诊断：解析 frontmatter（进度追踪当前没有 frontmatter，缺失不算错误）。 */
export function progressFrontmatter(text) {
  try {
    return parseRestrictedFrontmatter(normalizeText(text), PROGRESS_PATH)
  } catch {
    return { fields: {}, present: false, bodyStartLine: 1, lineCount: 0 }
  }
}