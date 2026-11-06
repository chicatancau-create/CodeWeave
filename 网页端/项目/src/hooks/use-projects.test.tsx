// @vitest-environment jsdom
/**
 * R2-A / F6 项目草稿 Hook：账户隔离、检查点上限与恢复语义。
 * 对应审计结论：项目数据曾绕过信封且缺少深层校验；检查点需要"恢复前自动兜底"。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_PERSIST_FAILURE, useProjects } from './use-projects'
import { readProjects } from '../utils/project-helpers'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'

const projectsKey = (scope: string) => scopedKey(STORAGE_KEYS.PROJECTS, scope)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('R2-A 项目账户隔离', () => {
  it('不同作用域各自独立，切换账户后重新加载', () => {
    const { result, rerender } = renderHook(({ scope }) => useProjects(scope), {
      initialProps: { scope: 'user-1' },
    })
    act(() => result.current.handleCreateProject('python'))
    expect(result.current.projects).toHaveLength(1)

    rerender({ scope: 'user-2' })
    // 新账户看不到他人项目
    expect(result.current.projects).toHaveLength(0)
    expect(result.current.selectedProjectId).toBeUndefined()

    act(() => result.current.handleCreateProject('javascript'))
    expect(result.current.projects).toHaveLength(1)

    // 切回原账户，数据仍在
    rerender({ scope: 'user-1' })
    expect(result.current.projects).toHaveLength(1)
    expect(result.current.projects[0]!.files[0]!.language).toBe('python')
  })

  it('新建项目后自动选中，且写入版本化信封', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('java'))
    expect(result.current.selectedProjectId).toBe(result.current.projects[0]!.id)

    const raw = JSON.parse(localStorage.getItem(projectsKey('user-1'))!)
    expect(raw.schemaVersion).toBeDefined()
    expect(Array.isArray(raw.data)).toBe(true)
  })

  it('同一毫秒内连续新建多个项目也生成互不相同的 id', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    // 原实现用 Date.now() 生成 id：同一毫秒内的多次调用会得到相同 id，
    // 导致 React key 冲突，且删除一个项目会按 id 误删另一个。
    act(() => {
      result.current.handleCreateProject('python')
      result.current.handleCreateProject('python')
      result.current.handleCreateProject('java')
    })
    const ids = result.current.projects.map((project) => project.id)
    expect(new Set(ids).size).toBe(3)

    // 删除其中一个，其余两个必须保留
    act(() => result.current.handleDeleteProject(ids[0]!))
    expect(result.current.projects).toHaveLength(2)
    expect(result.current.projects.map((p) => p.id)).not.toContain(ids[0])
  })

  it('删除当前选中项目后清空选中态，且不误删其他项目', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('python'))
    act(() => result.current.handleCreateProject('javascript'))
    const [first, second] = result.current.projects
    act(() => result.current.setSelectedProjectId(first!.id))

    act(() => result.current.handleDeleteProject(first!.id))
    expect(result.current.projects.map((p) => p.id)).toEqual([second!.id])
    expect(result.current.selectedProjectId).toBeUndefined()
    expect(readProjects('user-1')).toHaveLength(1)
  })

  it('复制项目生成新 id 与新文件 id，名称带副本后缀', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('python'))
    const original = result.current.projects[0]!

    act(() => result.current.handleDuplicateProject(original))
    const copy = result.current.projects[0]!
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe(`${original.name} 副本`)
    expect(copy.files[0]!.id).not.toBe(original.files[0]!.id)
    expect(result.current.selectedProjectId).toBe(copy.id)
  })
})

describe('F6 检查点', () => {
  it('保存检查点后记录快照，且恢复会先留一个兜底检查点', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('python'))
    const projectId = result.current.projects[0]!.id

    act(() => result.current.handleUpdateProject(projectId, { files: [{ id: 'f1', name: 'main.py', language: 'python', code: 'v1', updatedAt: '' }] }))
    act(() => result.current.handleSaveCheckpoint(projectId))
    expect(result.current.projects[0]!.checkpoints).toHaveLength(1)
    const checkpointId = result.current.projects[0]!.checkpoints![0]!.id

    // 改动代码后恢复：当前代码应被兜底检查点保存，文件回到 v1
    act(() => result.current.handleUpdateProject(projectId, { files: [{ id: 'f1', name: 'main.py', language: 'python', code: 'v2', updatedAt: '' }] }))
    act(() => result.current.handleRestoreCheckpoint(projectId, checkpointId))

    const restored = result.current.projects[0]!
    expect(restored.files[0]!.code).toBe('v1')
    expect(restored.checkpoints).toHaveLength(2)
  })

  it('检查点保留上限为 10，超出淘汰最旧', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('python'))
    const projectId = result.current.projects[0]!.id

    for (let i = 0; i < 13; i += 1) {
      act(() => result.current.handleUpdateProject(projectId, { description: `第 ${i} 次` }))
      act(() => result.current.handleSaveCheckpoint(projectId))
    }
    expect(result.current.projects[0]!.checkpoints).toHaveLength(10)
  })

  it('恢复不存在的检查点时不改变文件', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    act(() => result.current.handleCreateProject('python'))
    const projectId = result.current.projects[0]!.id
    const before = result.current.projects[0]!.files

    act(() => result.current.handleRestoreCheckpoint(projectId, 'cp-not-exist'))
    expect(result.current.projects[0]!.files).toEqual(before)
  })
})

describe('R2-A 损坏项目数据不扩散', () => {
  it('存储中是对象而非数组时返回空列表，不抛错', () => {
    localStorage.setItem(projectsKey('user-1'), JSON.stringify({ schemaVersion: 3, data: { not: 'an array' } }))
    const { result } = renderHook(() => useProjects('user-1'))
    expect(result.current.projects).toEqual([])
  })

  it('项目缺少 files 字段时整条丢弃', () => {
    localStorage.setItem(
      projectsKey('user-1'),
      JSON.stringify({ schemaVersion: 3, data: [{ id: 'p1' }, { id: 'p2', files: [] }] }),
    )
    const { result } = renderHook(() => useProjects('user-1'))
    // p1 因 files 非数组被丢弃；p2 保留
    expect(result.current.projects.map((p) => p.id)).toEqual(['p2'])
  })
})

/**
 * 01 号方案 §4 的 error 行（落盘失败）。
 *
 * 改版前七个写盘调用点都把 `saveProjects` 的布尔返回值丢掉了：内存里的列表照改，
 * 界面照说「已保存」，重进本页却什么都没有——那是把写失败说成写成功。
 * 现在所有落盘只走 `persist()` 一处，失败留下原因、留下重试，并且**不吞掉用户的编辑**。
 */
describe('项目草稿的落盘失败（§4 error 行）', () => {
  /** 模拟浏览器存储写不进去（配额满 / 禁止站点数据）：setItem 抛错就是这一档的真实形态。 */
  function blockStorage() {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    return spy
  }

  it('写不进本机：列表仍按用户看到的样子留着，并给出可重试的原因', () => {
    const spy = blockStorage()
    try {
      const { result } = renderHook(() => useProjects('user-1'))
      act(() => result.current.handleCreateProject('javascript'))
      expect(result.current.projects).toHaveLength(1)
      expect(result.current.persistFailure).toBe(PROJECT_PERSIST_FAILURE)
      // 磁盘上确实没有：读回来还是空
      expect(readProjects('user-1')).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('恢复可写之后按一次重试，就把界面上这一份原样落盘，不需要用户重做', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    const spy = blockStorage()
    act(() => result.current.handleCreateProject('javascript'))
    expect(result.current.persistFailure).toBeTruthy()
    spy.mockRestore()

    act(() => result.current.retryPersist())
    expect(result.current.persistFailure).toBeNull()
    expect(readProjects('user-1')).toHaveLength(1)
    expect(result.current.projects).toHaveLength(1)
  })

  it('写成功时不留任何失败痕迹（失败态不能挂旧的那一条）', () => {
    const { result } = renderHook(() => useProjects('user-1'))
    const spy = blockStorage()
    act(() => result.current.handleCreateProject('javascript'))
    spy.mockRestore()

    act(() => result.current.handleCreateProject('python'))
    expect(result.current.persistFailure, '这一次写成功了，上一条失败必须撤下').toBeNull()
    expect(result.current.projects).toHaveLength(2)
  })

  it('换账户重新加载时清掉上一账户的失败说明', () => {
    const { result, rerender } = renderHook(({ scope }) => useProjects(scope), {
      initialProps: { scope: 'user-1' as string | undefined },
    })
    const spy = blockStorage()
    act(() => result.current.handleCreateProject('javascript'))
    expect(result.current.persistFailure).toBeTruthy()
    spy.mockRestore()

    rerender({ scope: 'user-2' })
    expect(result.current.persistFailure, '这一句说的是上一个账户的写盘，不该跟着换账户还挂着').toBeNull()
  })

  it('读侧不需要 loading：草稿来自同步的 localStorage 读取，不走网络', () => {
    // 这一条不测 DOM，测的是「不要为不存在的一秒造骨架」这个判断本身：
    // readProjects 在同一次调用里就把结果给回来，因此本 hook 没有 loading 语义可言。
    const { result } = renderHook(() => useProjects('user-1'))
    expect(result.current.projects).toEqual([])
  })
})
