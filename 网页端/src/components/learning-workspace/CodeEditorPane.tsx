/**
 * 代码区（01 号方案 §4 目标组件表的 `CodeEditorPane`）。
 *
 * 自 `learning-workspace-view.tsx` 原样搬来的是**代码这一栏的四句话与编辑器本体**：
 * - 有代码：terminal 式区头（文件名 + 运行器 + 未保存的修改）+ 保存提示那一行 + 编辑器；
 * - 没代码但详情在路上（#105）：说「代码与练习契约还在路上」，不下「没有」的结论；
 * - 没代码且这一次读失败（01 号方案 §4 的 error 行）：指向原文区那句原因，仍然不说「没有」；
 * - 真的没有（纯阅读课 / 旧内置课）：才说「本单元没有配套代码」，并交代按证据清单确认。
 *
 * **只搬运 + 记忆化**：`#cw-pane-code`、`.cw-pane--code`、`.workspace-header`、`.cw-save-hint`
 * （`role="status"`）、`.workspace-external-note` 这些类名与全部文案、DOM 顺序一字未改。
 * `onCodeChange` / `onRetryDetail` 之类动作一律由上层 `useCallback` 给出稳定引用；
 * 编辑器的 `reveal`（EDIT-01 第 6 条的错误定位令牌）住在主编排文件，这里只透传。
 */
import { memo } from 'react'
import type { LanguageId } from '../../types/lesson'
import { CodeEditor } from '../code-editor'

type CodeEditorPaneProps = {
  /** 本课有没有代码：决定画编辑器还是画那三句「还在路上 / 没读回来 / 真的没有」。 */
  hasCode: boolean
  detailPending: boolean
  detailError: string | null
  /** 纯阅读课那句「为什么没有代码」的判据：有没有资料库来源（`lesson.source`）。 */
  hasSource: boolean
  fileName: string
  runtime: string
  isDirty: boolean
  /** SAVE-01 第 4 条：Ctrl/Cmd+S 的真实结果（成功/失败），由 app 层给，落在那句话里。 */
  saveFeedback: string
  code: string
  language: LanguageId
  languageLabel: string
  /** 当前事件所在行（没有事件时是 undefined，编辑器不高亮任何一行）。 */
  activeLine?: number
  /** EDIT-01：编辑器的三件设置（Tab 宽度 / 自动换行 / 行号），由设置弹窗真驱动。 */
  tabSize: number
  wordWrap: boolean
  lineNumbers: boolean
  /** EDIT-01 第 6 条：控制台请求把某一行送到眼前（带 token，同一行连点两次也要真的再滚）。 */
  reveal?: { line: number; token: number }
  onCodeChange: (code: string) => void
}

export const CodeEditorPane = memo(function CodeEditorPane({
  hasCode,
  detailPending,
  detailError,
  hasSource,
  fileName,
  runtime,
  isDirty,
  saveFeedback,
  code,
  language,
  languageLabel,
  activeLine,
  tabSize,
  wordWrap,
  lineNumbers,
  reveal,
  onCodeChange,
}: CodeEditorPaneProps) {
  return (
    <>
      {hasCode ? (
        <div className="cw-pane cw-pane--code" id="cw-pane-code">
          <div className="workspace-header">
            <div>
              <strong>{fileName}</strong>
              <span>
                {runtime} {isDirty && '· 未保存的修改'}
              </span>
            </div>
            {/* 保存只有键盘路径（app 层 Ctrl/Cmd+S），把快捷键写在代码区头部，避免入口不可见。
                SAVE-01 第 4 条：手动保存的**真实结果**也要落在这句话里，而不是只让脏标记消失。 */}
            <span className="cw-save-hint" role="status">
              <kbd>Ctrl</kbd> + <kbd>S</kbd> 保存草稿
              {saveFeedback ? ` · ${saveFeedback}` : isDirty ? ' · 有未保存修改' : ''}
            </span>
          </div>
          <CodeEditor
            code={code}
            language={language}
            languageLabel={languageLabel}
            runtime={runtime}
            activeLine={activeLine}
            onChange={onCodeChange}
            tabSize={tabSize}
            wordWrap={wordWrap}
            lineNumbers={lineNumbers}
            reveal={reveal}
          />
        </div>
      ) : detailPending ? (
        <div className="workspace-external-note" aria-busy="true">
          代码与练习契约还在路上：本课详情正从内容服务读取，读回来之前本页不下「没有」的结论。
        </div>
      ) : detailError ? (
        /* 「没有代码」与「代码没读回来」是两句话：读取失败时不给前者（01 号方案 §4 error 行）。 */
        <div className="workspace-external-note">
          代码与练习契约没有读回来，原因见上方「主题原文」那一区；在重试成功之前，本页不下「本单元没有配套代码」的结论。
        </div>
      ) : (
        <div className="workspace-external-note">
          本单元没有配套代码：{hasSource ? '资料库该主题为纯阅读内容' : '旧内置课程未提供代码'}。
          阅读完成后按证据清单确认，本页不会因此产生任何掌握等级。
        </div>
      )}
    </>
  )
})
