import { useCallback, useEffect, useRef, useState } from 'react'
import type { LanguageId, Project } from '../types/lesson'
import { makeLocalId, makeProject, readProjects, saveProjects } from '../utils/project-helpers'

/** 落盘失败时给界面的一句话（01 号方案 §4 的 error 行：可理解原因 + 重试 + 保留输入）。 */
export const PROJECT_PERSIST_FAILURE =
  '这台设备的浏览器没有收下这次改动（本地存储配额已满，或浏览器禁止写入站点数据）。'

/**
 * 项目草稿：按账户作用域隔离（scope 变化时重新加载该作用域的数据）。
 *
 * 关于六态（01 号方案 §4）：
 * - **没有 loading 态，是有意的**：草稿来自同步的 `localStorage` 读取（`readProjects`），
 *   不走网络，也不像教材详情那样有「在路上」的一秒。给这一档挂骨架就是造一个永远不会出现的空转态。
 * - **有 error 态**：改版前七个写盘调用点全部丢掉 `saveProjects` 的布尔返回值——
 *   内存里的列表照改、界面照说「已保存」，重进本页就没了。那是把写失败说成写成功。
 *   现在落盘只有一个出口，失败留下原因与重试，界面上的列表保持用户看到的样子。
 *
 * 落盘走**写穿（write-through）副作用**而不是在 `setProjects` 的更新函数里顺手写：
 * 更新函数必须纯净，React 严格模式会把它调用两次，在里边写盘与记失败都数不对
 * （`react-hooks/refs` 与规则本身都会拦）。改动只置一个 dirty 标记，效果里写一次。
 */
export function useProjects(scope: string | undefined) {
  const [projects, setProjects] = useState<Project[]>(() => readProjects(scope))
  const [selectedProjectId, setSelectedProjectId] = useState<string>()
  const [persistFailure, setPersistFailure] = useState<string | null>(null)
  /** 重试用的触发器：内容没变也要再走一次落盘。 */
  const [writeNonce, setWriteNonce] = useState(0)
  const previousScope = useRef(scope)
  /** 只有真的被改过才写盘：换账户读回来的原样内容不该再动用户的数据一次。 */
  const dirty = useRef(false)

  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    dirty.current = false
    setProjects(readProjects(scope))
    setSelectedProjectId(undefined)
    // 这一句说的是上一个账户的写盘结果，换账户后不能还挂着。
    setPersistFailure(null)
  }, [scope])

  useEffect(() => {
    if (!dirty.current) return
    dirty.current = false
    setPersistFailure(saveProjects(projects, scope) ? null : PROJECT_PERSIST_FAILURE)
  }, [projects, scope, writeNonce])

  /** 唯一的改动出口：置标记 + 换内存列表；落盘由上面那一个效果负责。 */
  const mutate = useCallback((next: (current: Project[]) => Project[]) => {
    dirty.current = true
    setProjects(next)
  }, [])

  /** 重试：把界面上现在这一份原样再写一次，用户不需要重做任何一步。 */
  const retryPersist = useCallback(() => {
    dirty.current = true
    setWriteNonce((current) => current + 1)
  }, [])

  const handleCreateProject = useCallback(
    (languageId: LanguageId) => {
      const project = makeProject(languageId)
      mutate((current) => [project, ...current])
      setSelectedProjectId(project.id)
    },
    [mutate],
  )

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      mutate((current) => current.filter((project) => project.id !== projectId))
      setSelectedProjectId((current) => (current === projectId ? undefined : current))
    },
    [mutate],
  )

  const handleDuplicateProject = useCallback(
    (project: Project) => {
      const copyProject: Project = {
        ...project,
        id: makeLocalId('project'),
        name: `${project.name} 副本`,
        updatedAt: new Date().toISOString(),
        files: project.files.map((file) => ({
          ...file,
          id: makeLocalId('file'),
        })),
      }
      mutate((current) => [copyProject, ...current])
      setSelectedProjectId(copyProject.id)
    },
    [mutate],
  )

  const handleUpdateProject = useCallback(
    (projectId: string, updates: Partial<Project>) => {
      mutate((current) =>
        current.map((project) =>
          project.id === projectId ? { ...project, ...updates, updatedAt: new Date().toISOString() } : project,
        ),
      )
    },
    [mutate],
  )

  /** 保存检查点（F6）：克隆当前文件快照，本地保留最近 10 个，超出淘汰最旧。 */
  const handleSaveCheckpoint = useCallback(
    (projectId: string) => {
      mutate((current) =>
        current.map((project) => {
          if (project.id !== projectId) return project
          const checkpoint = {
            id: makeLocalId('cp'),
            at: new Date().toISOString(),
            files: project.files.map((file) => ({ ...file })),
          }
          const checkpoints = [checkpoint, ...(project.checkpoints ?? [])].slice(0, 10)
          return { ...project, checkpoints }
        }),
      )
    },
    [mutate],
  )

  /** 恢复检查点：用快照覆盖当前文件（当前文件先自动留一个检查点兜底）。 */
  const handleRestoreCheckpoint = useCallback(
    (projectId: string, checkpointId: string) => {
      mutate((current) =>
        current.map((project) => {
          if (project.id !== projectId) return project
          const checkpoint = (project.checkpoints ?? []).find((cp) => cp.id === checkpointId)
          if (!checkpoint) return project
          const safety = {
            id: makeLocalId('cp'),
            at: new Date().toISOString(),
            files: project.files.map((file) => ({ ...file })),
          }
          const checkpoints = [safety, ...(project.checkpoints ?? [])].slice(0, 10)
          return { ...project, files: checkpoint.files.map((file) => ({ ...file })), checkpoints }
        }),
      )
    },
    [mutate],
  )

  return {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    handleCreateProject,
    handleDeleteProject,
    handleDuplicateProject,
    handleUpdateProject,
    handleSaveCheckpoint,
    handleRestoreCheckpoint,
    /** 落盘失败的原因；null 代表当前这一份已经写进本机存储。 */
    persistFailure,
    retryPersist,
  }
}
