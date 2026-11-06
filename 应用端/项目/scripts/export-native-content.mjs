import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const appRoot = resolve(import.meta.dirname, '..')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const tsv = (rows) => rows.map((row) => row.map((value) => Buffer.from(String(value), 'utf8').toString('hex')).join('\t')).join('\n') + '\n'
const json = (value) => JSON.stringify(value, null, 2) + '\n'

// Compile only these three local, versioned curriculum modules at build time.
// No web server, bundler, package installation or user data is involved.
export async function loadCurriculum(source = resolve(appRoot, '../../网页端/项目/src/data')) {
  const sources = {}
  for (const name of ['curriculum', 'lessons', 'challenges']) sources[name] = await readFile(join(source, `${name}.ts`), 'utf8')
  const dataUrl = (text) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const curriculumUrl = dataUrl(sources.curriculum)
  const challengeSource = sources.challenges.replace("from './curriculum'", `from '${curriculumUrl}'`)
  const [{ lessons }, { challenges }, { curriculumStages }] = await Promise.all([
    import(dataUrl(sources.lessons)), import(dataUrl(challengeSource)), import(curriculumUrl),
  ])
  return { lessons, challenges, stages: curriculumStages,
    sources: Object.fromEntries(Object.entries(sources).map(([name, text]) => [`${name}.ts`, sha256(text)])) }
}

const section = (name, value) => {
  if (value === undefined || value === null || value === '') return ''
  return `\n【${name}】\n${Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : value}\n`
}
const lessonBody = (lesson) => {
  const unit = lesson.content
  return `${lesson.title}\n${lesson.description}\n` +
    section('来源', 'CodeWeave 内置课程快照；学习进度由当前账户证据决定。') +
    section('运行环境', lesson.runtime) + section('目标', unit.objective) +
    section('先备知识', unit.prerequisites) + section('讲解', unit.explanation) +
    section('例子与反例', unit.examples.map((x) => `正例：${x.good}\n${x.bad ? `反例：${x.bad}\n` : ''}解释：${x.why}`)) +
    section('示例代码', lesson.code) + section('理解要点', lesson.insight) +
    section('跟做', unit.guidedSteps) + section('独立练习', unit.exercise) +
    section('变式', unit.variant) + section('项目任务', unit.projectTask) +
    section('常见错误', unit.mistakes) + section('运行方法', unit.runCommand) +
    section('完成标准', unit.completion) + section('验收条件', unit.acceptanceCriteria) +
    section('证据清单', unit.evidenceChecklist) + section('复测间隔（天）', unit.reviewOffsetsDays)
}
const challengeBody = (item) => `${item.title}\n${item.description}\n` +
  section('阶段', item.stageId) + section('技术栈', item.stack) + section('运行要求', item.runner) +
  section('先决条件', item.prerequisites) + section('起始代码', item.starterCode) +
  section('目标输出或验收点', item.targetOutput) + section('证据清单', item.evidence)

function starter(language, original) {
  // The web teaching runner accepts Java statements; the real JDK needs Main.
  if (language === 'java' && !/\bclass\s+\w+/.test(original)) {
    return `public class Main {\n  public static void main(String[] args) {\n${original}\n  }\n}\n`
  }
  return original
}

export function createContentPackage(curriculum) {
  const files = new Map()
  const catalog = [], exercises = [], starters = [], metadata = [], hints = []
  const ids = new Set()
  const add = (item, kind) => {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate content ID: ${item.id}`)
    ids.add(item.id)
    const body = kind === 'lesson' ? lessonBody(item) : challengeBody(item)
    const sourcePolicy = kind === 'lesson' ? item.content.runEnvironment ?? 'teaching' : item.runner
    const policy = sourcePolicy !== 'external' && ['python', 'java', 'javascript'].includes(item.language) ? 'native' : 'external'
    const code = kind === 'lesson' ? item.code : item.starterCode
    const stage = kind === 'lesson' ? item.content.stageId ?? '' : item.stageId
    files.set(`${item.id}.txt`, body)
    catalog.push([item.id, item.title, 'published', item.language, sha256(body), '1'])
    starters.push([item.id, item.language, policy === 'native' ? starter(item.language, code) : code])
    metadata.push([item.id, kind, stage, policy, sourcePolicy, kind === 'lesson' ? item.fileName : ''])
    if (kind === 'challenge') {
      const hint = section('提示', item.hint) + section('解释', item.explanation)
      files.set(`hints/${item.id}.txt`, hint)
      hints.push([item.id, sha256(hint)])
    }
    // Lesson exercise prompts do not declare machine-readable expected output.
    // Never convert narrative completion criteria or external evidence into a pass.
    if (kind === 'challenge' && policy === 'native') {
      exercises.push([item.id, `${item.id}-challenge`, item.targetOutput.join('\n'), 'L1'])
    }
  }
  curriculum.lessons.forEach((item) => add(item, 'lesson'))
  curriculum.challenges.forEach((item) => add(item, 'challenge'))
  files.set('catalog.v1.tsv', tsv(catalog))
  files.set('exercises.v1.tsv', tsv(exercises))
  files.set('starter-code.v1.tsv', tsv(starters))
  files.set('metadata.v1.tsv', tsv(metadata))
  files.set('hints.v1.tsv', tsv(hints))
  files.set('curriculum.v1.json', json({ schemaVersion: 1, sourceHashes: curriculum.sources,
    stages: curriculum.stages,
    lessons: curriculum.lessons.map(({ progress, ...lesson }) => lesson),
    challenges: curriculum.challenges }))
  return { files, counts: { lessons: curriculum.lessons.length, challenges: curriculum.challenges.length,
    stages: curriculum.stages.length, catalog: catalog.length, automaticExercises: exercises.length,
    external: metadata.filter((x) => x[3] === 'external').length } }
}

export async function exportContent(output = join(appRoot, 'native/content')) {
  const result = createContentPackage(await loadCurriculum())
  await mkdir(output, { recursive: true })
  // Refuse stale/unknown output instead of deleting unowned files or silently
  // publishing a mixed snapshot when a curriculum ID has been retired.
  const rootStatus = await lstat(output)
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) throw new Error('Output must be a real directory')
  for (const name of await readdir(output)) {
    const status = await lstat(join(output, name))
    if (status.isSymbolicLink()) throw new Error(`Refusing symbolic output: ${name}`)
    if (name === 'hints' && status.isDirectory()) {
      for (const hint of await readdir(join(output, name))) {
        const fileStatus = await lstat(join(output, name, hint))
        if (fileStatus.isSymbolicLink() || !fileStatus.isFile() || !result.files.has(`hints/${hint}`)) throw new Error(`Unexpected hint output: ${hint}`)
      }
    } else if (!status.isFile() || !result.files.has(name)) throw new Error(`Unexpected content output: ${name}`)
  }
  for (const [name, text] of result.files) {
    await mkdir(dirname(join(output, name)), { recursive: true })
    await writeFile(join(output, name), text, 'utf8')
  }
  return result.counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--out')) throw new Error('Usage: node scripts/export-native-content.mjs [--out directory]')
  console.log(JSON.stringify(await exportContent(args.length ? resolve(args[1]) : undefined), null, 2))
}
