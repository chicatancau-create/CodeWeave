import './projects-view.css'
import { Code2, Copy, FilePlus2, History, Save, SquareDashed, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { LanguageId, Project } from '../types/lesson'

type ProjectsViewProps = {
  projects: Project[]
  selectedProjectId: string | undefined
  onCreate: (languageId: LanguageId) => void
  onSelect: (projectId: string) => void
  onDelete: (projectId: string) => void
  onDuplicate: (project: Project) => void
  onUpdate: (projectId: string, updates: Partial<Project>) => void
  onSaveCheckpoint: (projectId: string) => void
  onRestoreCheckpoint: (projectId: string, checkpointId: string) => void
  /**
   * 01 号方案 §4 的 error 行：草稿写不进本机存储时的原因（null = 当前这份已经落盘）。
   * 由 `useProjects` 统一给出，本组件不自己判断写成没写成。
   */
  persistFailure?: string | null
  /** 重试：把界面上现在这一份原样再写一次，不需要用户重做任何一步。 */
  onRetryPersist?: () => void
}

/**
 * §5.2「挑战与项目 = 编号列表」：项目与检查点的编号都是**渲染进 DOM 的真实文本**
 * （可复制、可读屏），不用 CSS `counter()` 注入 —— 见 前端分工程方案 §8 第 4 条。
 * 编号按当前列表顺序生成，是位置标记而非身份：项目身份仍是 `project.id`。
 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatStamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN')
}

export function ProjectsView({
  projects,
  selectedProjectId,
  onCreate,
  onSelect,
  onDelete,
  onDuplicate,
  onUpdate,
  onSaveCheckpoint,
  onRestoreCheckpoint,
  persistFailure = null,
  onRetryPersist,
}: ProjectsViewProps) {
  const [newLanguage, setNewLanguage] = useState<LanguageId>('python')
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const totalLines = selectedProject
    ? selectedProject.files.reduce((sum, file) => sum + file.code.split('\n').length, 0)
    : 0

  return (
    <section className="projects-view">
      {/*
       * 写盘失败必须说出口：改版前七个 `saveProjects` 调用点都把返回的布尔丢掉了，
       * 于是内存里的列表照改、界面照说「已保存」，重进本页却什么都没有。
       * 这里说的是「这台设备没收下」，界面上的草稿保持原样，重试按一次就再写一次。
       */}
      {persistFailure && (
        <div className="projects-persist-error" role="alert">
          <strong>改动没有保存到这台设备</strong>
          <p className="projects-persist-error-reason">{persistFailure}</p>
          <p className="projects-persist-error-note">
            下面列出的内容目前只存在于这一次会话：关掉标签页或换设备就会丢失。
            释放一些浏览器存储、或退出无痕模式后可以重试；不需要重做刚才的编辑。
          </p>
          {onRetryPersist && (
            <button type="button" className="subtle-button projects-persist-retry" onClick={onRetryPersist}>
              重试保存
            </button>
          )}
        </div>
      )}
      <div className="module-heading project-overview">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            我的练习项目
          </p>
          <h1>代码草稿</h1>
          <p>保存你的练习代码，随时回来继续。</p>
        </div>
        <div className="project-create">
          <label className="project-create-label">
            新项目语言
            <select
              className="setting-select"
              aria-label="新项目语言"
              value={newLanguage}
              onChange={(event) => setNewLanguage(event.target.value as LanguageId)}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="java">Java</option>
              <option value="c">C</option>
              <option value="csharp">C#</option>
            </select>
          </label>
          <button className="primary-action" onClick={() => onCreate(newLanguage)}>
            <FilePlus2 size={14} aria-hidden="true" />
            新建项目
          </button>
        </div>
      </div>

      <div className="projects-layout">
        <div className="project-list-column">
          <h2 className="projects-section-title">
            项目清单
            <span className="projects-section-count">{pad(projects.length)} 个</span>
          </h2>
          {projects.length === 0 ? (
            <div className="empty-state">
              <Code2 size={32} aria-hidden="true" />
              <strong>还没有保存的项目</strong>
              <p>创建第一个项目开始练习</p>
            </div>
          ) : (
            <ol className="project-list" role="list" aria-label="项目编号清单">
              {projects.map((project, index) => (
                <li key={project.id} className="project-list-item">
                  <button
                    className={`project-card ${selectedProjectId === project.id ? 'selected' : ''}`}
                    aria-pressed={selectedProjectId === project.id}
                    onClick={() => onSelect(project.id)}
                  >
                    <span className="project-card-no">{pad(index + 1)}</span>
                    <div className="project-icon" aria-hidden="true">
                      <Code2 size={15} />
                    </div>
                    <div className="project-card-body">
                      <strong>{project.name}</strong>
                      <small>
                        {project.files.length} 个文件 · {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
                      </small>
                      <small className="project-card-checkpoints">
                        {project.checkpoints?.length ? `${pad(project.checkpoints.length)} 个检查点` : '无检查点快照'}
                      </small>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {selectedProject && (
          <div className="project-detail">
            <div className="detail-header">
              <h2>{selectedProject.name}</h2>
              <div className="detail-actions">
                <button className="subtle-button" onClick={() => onDuplicate(selectedProject)}>
                  <Copy size={12} aria-hidden="true" />
                  复制
                </button>
                <button
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm(`确定删除项目「${selectedProject.name}」吗？该操作不可撤销。`)) {
                      onDelete(selectedProject.id)
                    }
                  }}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  删除
                </button>
              </div>
            </div>

            {/* ── 区 01 本机草稿：编辑即落盘到本机，但没有快照，回不去 ───────── */}
            <section className="project-zone project-zone--draft" aria-label="本机草稿（未快照）">
              <header className="project-zone-head">
                <span className="project-zone-no" aria-hidden="true">
                  01
                </span>
                <h3 className="project-zone-title">本机草稿</h3>
                <span className="project-zone-scope">改动即时写入本机 · 未快照前回不到旧版本</span>
              </header>

              <label className="field-label">
                项目名称
                <input
                  value={selectedProject.name}
                  onChange={(e) => onUpdate(selectedProject.id, { name: e.target.value })}
                  maxLength={60}
                />
              </label>

              <label className="field-label">
                项目描述
                <textarea
                  value={selectedProject.description}
                  onChange={(e) => onUpdate(selectedProject.id, { description: e.target.value })}
                  maxLength={200}
                />
              </label>

              <p className="project-draft-state">
                <SquareDashed size={13} aria-hidden="true" />
                <span className="project-draft-state-label">草稿状态</span>
                <span>
                  {selectedProject.files.length} 个文件 · {totalLines} 行 · 最后改动 {formatStamp(selectedProject.updatedAt)}
                  。这部分只存在本机，下面的检查点才是可恢复的快照。
                </span>
              </p>

              <div className="file-heading">
                <span>项目文件</span>
              </div>

              {selectedProject.files.map((file) => (
                <div key={file.id} className="project-file">
                  <div className="file-meta">
                    <Code2 size={12} aria-hidden="true" />
                    <strong>{file.name}</strong>
                    <span>最后编辑：{new Date(file.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <textarea
                    className="project-code"
                    value={file.code}
                    onChange={(e) => {
                      const updatedFiles = selectedProject.files.map((f) =>
                        f.id === file.id ? { ...f, code: e.target.value, updatedAt: new Date().toISOString() } : f,
                      )
                      onUpdate(selectedProject.id, { files: updatedFiles })
                    }}
                    placeholder="在这里输入代码..."
                  />
                </div>
              ))}
            </section>

            {/* ── 区 02 检查点快照：已固化的事实，可恢复；恢复前自动留安全点 ─── */}
            <section className="project-zone project-zone--snapshot" aria-label="检查点快照（可恢复）">
              <header className="project-zone-head">
                <span className="project-zone-no" aria-hidden="true">
                  02
                </span>
                <h3 className="project-zone-title">检查点快照</h3>
                <span className="project-zone-scope">已固化的文件副本 · 本地保留最近 10 个</span>
              </header>

              <div className="checkpoint-actions">
                <button className="subtle-button" onClick={() => onSaveCheckpoint(selectedProject.id)}>
                  <Save size={12} aria-hidden="true" />
                  保存检查点
                </button>
                <span className="checkpoint-counter">
                  已存 {pad(selectedProject.checkpoints?.length ?? 0)} / 10
                </span>
              </div>

              <p className="checkpoint-note">
                <History size={13} aria-hidden="true" />
                <span>恢复前会先用当前草稿自动留一个安全点，再回滚到所选快照；安全点同样占用 10 个名额里的一格。</span>
              </p>

              {(selectedProject.checkpoints?.length ?? 0) === 0 ? (
                <p className="checkpoint-empty">
                  还没有检查点。运行记录暂未与项目关联 —— 先保存检查点，随时可恢复到该时刻的文件。
                </p>
              ) : (
                <ol className="checkpoint-list" role="list" aria-label="检查点编号清单">
                  {selectedProject.checkpoints!.map((checkpoint, index) => (
                    <li key={checkpoint.id} className="checkpoint-row">
                      <span className="checkpoint-no">{pad(index + 1)}</span>
                      <span className="checkpoint-at">{new Date(checkpoint.at).toLocaleString('zh-CN')}</span>
                      <span className="checkpoint-files">{checkpoint.files.length} 个文件</span>
                      <button
                        className="subtle-button"
                        onClick={() => onRestoreCheckpoint(selectedProject.id, checkpoint.id)}
                      >
                        <Undo2 size={12} aria-hidden="true" />
                        恢复到该快照
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
