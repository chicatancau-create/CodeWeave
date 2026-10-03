// @vitest-environment jsdom
/**
 * DATA-09 导入入口（界面侧）。三合一方案 §6.2：导入需先预览版本、scope 与冲突，
 * 不覆盖目标现有记录；账户 ID 不重映射。
 *
 * 覆盖的真实风险：预览就写数据、冲突被静默覆盖、跨账户文件被当成自己的记录恢复、
 * 未注册键被文件指定成任意 localStorage 键。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from '../utils/constants'
import { EXPORT_SCHEMA, EXPORT_VERSION } from '../utils/local-data'
import { DataPrivacyView } from './data-privacy-view'

const ACCOUNT = 'user-aa11'
const OTHER = 'user-bb22'
const WORKSPACE = `${STORAGE_KEYS.WORKSPACE}:${ACCOUNT}`
const PROJECTS = `${STORAGE_KEYS.PROJECTS}:${ACCOUNT}`
const SMUGGLED = 'some-other-app.key'

const envelope = (value: unknown) => JSON.stringify({ schemaVersion: 3, savedAt: '2026-09-20T00:00:00.000Z', data: value })

function payloadFor(scope: string, data: Record<string, unknown>) {
  return JSON.stringify({
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: '2026-09-20T00:00:00.000Z',
    scope,
    categories: [
      { base: STORAGE_KEYS.WORKSPACE, category: 'account', label: '课程工作区与代码草稿' },
      { base: STORAGE_KEYS.PROJECTS, category: 'account', label: '项目草稿' },
    ],
    data,
  })
}

function renderView() {
  return render(
    <DataPrivacyView
      user={{ id: ACCOUNT, name: '验收账户', contactType: 'phone', phone: '', email: '' } as never}
      onExportData={vi.fn()}
      onClearLocalData={() => ({ removed: true, keys: [], failedKeys: [], failures: [], categories: 0 })}
    />,
  )
}

async function chooseFile(text: string): Promise<void> {
  const input = (await screen.findByLabelText(/选择导出的 JSON 文件/)) as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([text], 'export.json', { type: 'application/json' })] } })
}

beforeEach(() => {
  localStorage.clear()
  // 目标位置：workspace 已有不同内容（冲突），projects 为空位（可恢复）
  localStorage.setItem(WORKSPACE, envelope({ lessonId: 'current-one' }))
})

afterEach(() => {
  cleanup()
})

describe('DATA-09 从导出文件恢复', () => {
  it('未选择文件前没有确认入口', async () => {
    renderView()
    expect(await screen.findByText('从导出文件恢复')).toBeTruthy()
    expect(screen.queryByText(/确认导入/)).toBeNull()
  })

  it('预览阶段不写任何数据，并如实区分空位与冲突', async () => {
    renderView()
    const before = localStorage.getItem(WORKSPACE)
    await chooseFile(payloadFor(ACCOUNT, { [WORKSPACE]: { savedAt: 'x', data: { lessonId: 'from-file' } }, [PROJECTS]: { savedAt: 'x', data: { a: 1 } } }))

    expect(await screen.findByText(/本次将写入 1 项 \/ 文件内共 2 项/)).toBeTruthy()
    expect(screen.getByText(/目标已有不同内容/)).toBeTruthy()
    expect(screen.getByText(/空位可恢复/)).toBeTruthy()
    expect(localStorage.getItem(WORKSPACE)).toBe(before)
    expect(localStorage.getItem(PROJECTS)).toBeNull()
  })

  it('默认只填空位：冲突项不勾选就不覆盖', async () => {
    renderView()
    const kept = localStorage.getItem(WORKSPACE)
    await chooseFile(payloadFor(ACCOUNT, { [WORKSPACE]: { savedAt: 'x', data: { lessonId: 'from-file' } }, [PROJECTS]: { savedAt: 'x', data: { a: 1 } } }))
    fireEvent.click(await screen.findByRole('button', { name: /确认导入/ }))

    await waitFor(() => expect(screen.getByText(/已写入 1 项，跳过 1 项/)).toBeTruthy())
    expect(localStorage.getItem(WORKSPACE)).toBe(kept)
    expect(localStorage.getItem(PROJECTS)).toContain('"a":1')
  })

  it('显式勾选「覆盖现有记录」才替换冲突项', async () => {
    renderView()
    await chooseFile(payloadFor(ACCOUNT, { [WORKSPACE]: { savedAt: 'x', data: { lessonId: 'from-file' } }, [PROJECTS]: { savedAt: 'x', data: { a: 1 } } }))
    // 预览是异步算出来的（读文件 → previewImport），先等表格出现再点勾选框
    fireEvent.click(await screen.findByLabelText(/覆盖现有记录/))
    fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))

    await waitFor(() => expect(screen.getByText(/已写入 2 项，跳过 0 项/)).toBeTruthy())
    expect(localStorage.getItem(WORKSPACE)).toContain('from-file')
  })

  it('跨账户导出件不给出可勾选项，确认也不会写入他人槽位', async () => {
    renderView()
    const before = localStorage.getItem(WORKSPACE)
    await chooseFile(payloadFor(OTHER, { [`${STORAGE_KEYS.WORKSPACE}:${OTHER}`]: { savedAt: 'x', data: { lessonId: 'theirs' } } }))

    expect(await screen.findByText(/属于其他账户/)).toBeTruthy()
    expect(screen.getByText(/本次将写入 0 项/)).toBeTruthy()
    expect(screen.queryByLabelText(/覆盖现有记录/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
    await waitFor(() => expect(screen.getByText(/已写入 0 项/)).toBeTruthy())
    expect(localStorage.getItem(WORKSPACE)).toBe(before)
    expect(localStorage.getItem(`${STORAGE_KEYS.WORKSPACE}:${OTHER}`)).toBeNull()
  })

  it('未注册的键被拒绝，文件不能指定任意 localStorage 键', async () => {
    renderView()
    await chooseFile(payloadFor(ACCOUNT, { [SMUGGLED]: { savedAt: 'x', data: { anything: 1 } }, [PROJECTS]: { savedAt: 'x', data: { a: 1 } } }))

    expect(await screen.findByText(/被拒绝（未注册的键名/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
    await waitFor(() => expect(screen.getByText(/已写入 1 项/)).toBeTruthy())
    expect(localStorage.getItem(SMUGGLED)).toBeNull()
  })

  it('不是导出文件时给出可读错误，不进入确认步骤', async () => {
    renderView()
    await chooseFile(JSON.stringify({ hello: 'world' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认导入/ })).toBeNull()
  })
})
