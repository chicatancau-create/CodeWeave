// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import type { Challenge, ChallengeRecord } from '../types/lesson'

const record = (evidence = '完成了全部证据项'): Record<string, ChallengeRecord> => ({
  'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence },
})

const renderView = (progress: Record<string, ChallengeRecord> = {}) =>
  render(
    <ChallengesView
      challenges={challenges}
      progress={progress}
      unitsByStage={{
        A: [{ id: 'java-env-a1', title: 'A1 · 开发环境清点' }],
        C: [
          { id: 'java-algo-c1', title: 'C1 · 找出较大值' },
          { id: 'java-algo-c2', title: 'C2 · 循环累加与复杂度' },
          { id: 'java-algo-c3', title: 'C3 · while 倒数与终止条件' },
        ],
      }}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )

const selectOption = (label: string, value: string) => {
  const select = screen.getByLabelText(label) as HTMLSelectElement
  fireEvent.change(select, { target: { value } })
}

beforeEach(() => {
  // 草稿写在 localStorage（guest 作用域），不清就会跨条泄漏：
  // 上一条测试把 B 关代码写成起始代码，下一条「从没编辑过代码」的断言就被这份遗留草稿喂假了。
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('ChallengesView（CHAL-01：列表网格 + 独立详情页）', () => {
  it('无筛选时第 1 页渲染 12 张卡片，概览仍统计全部 13 关', () => {
    renderView()
    expect(document.querySelectorAll('.stage-card')).toHaveLength(12)
    expect(screen.getByText(/已完成 0 \/ 13/)).toBeTruthy()
  })

  it('按轨道、难度、运行方式筛选后数量正确（后三类在更多筛选中）', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    selectOption('轨道', '算法竞赛')
    expect(document.querySelectorAll('.stage-card')).toHaveLength(1)

    selectOption('轨道', 'all')
    selectOption('难度', '进阶')
    expect(document.querySelectorAll('.stage-card')).toHaveLength(6)

    selectOption('难度', 'all')
    selectOption('运行方式', 'browser')
    expect(document.querySelectorAll('.stage-card')).toHaveLength(2)

    selectOption('运行方式', 'external')
    expect(document.querySelectorAll('.stage-card')).toHaveLength(9)
  })

  it('状态筛选：已通过只显示已通过关卡（旧 boolean 进度也算通过）', () => {
    // 旧版布尔进度经 validateProgress 迁移后为 { completedAt, evidence, status: 'passed' }
    renderView({ 'stage-b': { completedAt: '迁移自旧版本', evidence: '', status: 'passed' } })
    selectOption('状态', 'passed')
    expect(document.querySelectorAll('.stage-card')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /B 关：Java 核心编程，已通过/ })).toBeTruthy()
  })

  it('点击 M 关后详情严格绑定 M（标题、技术栈、单元跳转），不显示 A 关内容', () => {
    const onOpenUnit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{ M: [{ id: 'm-unit-1', title: 'M1 · 实战单元' }] }}
        onOpenUnit={onOpenUnit}
        onSubmit={vi.fn()}
      />,
    )
    // M 关在第 2 页：先用阶段主筛选定位
    selectOption('阶段', 'M')
    fireEvent.click(screen.getByRole('button', { name: /M 关：竞赛综合实战/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'M 关卡验收：竞赛综合实战' })).toBeTruthy()
    expect(screen.getByText('全栈组合')).toBeTruthy()
    // 单元跳转位于「题目」标签页（默认激活）
    fireEvent.click(screen.getByRole('button', { name: 'M1 · 实战单元' }))
    expect(onOpenUnit).toHaveBeenCalledWith('m-unit-1')
  })

  it('教学运行器：未识别结构不增加完成数；证据为空不能提交', async () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    // 选中 B 关（教学运行器）
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    // 制造一次未识别结构（R4：不猜测成功，也不增加完成数）
    const editor = screen.getByRole('textbox', { name: /B 关卡验收：Java 核心编程 代码编辑器/ })
    fireEvent.change(editor, { target: { value: '// 只有注释，无可识别结构' } })
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    // 运行结果同时渲染在「编写与运行」与「提交记录」面板（hidden 面板仍在 DOM）
    expect((await screen.findAllByText(/未识别代码结构，未产生通过判定/)).length).toBeGreaterThan(0)

    // 切到提交记录：未识别 → 提交禁用
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    const submit = screen.getByRole('button', { name: /提交答案/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()

    // 让运行通过：恢复原始代码并运行；证据为空仍不能提交
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor2 = screen.getByRole('textbox', { name: /B 关卡验收：Java 核心编程 代码编辑器/ })
    fireEvent.change(editor2, { target: { value: challenges[1]!.starterCode } })
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    expect((await screen.findAllByText(/输出与验收点一致/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    const submit2 = screen.getByRole('button', { name: /提交答案/ }) as HTMLButtonElement
    expect(submit2.disabled).toBe(true)

    // 未识别与未提交都不增加完成数（回到列表查看概览）
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(screen.getByText(/已完成 0 \/ 13/)).toBeTruthy()
  })

  it('运行一致 + 证据后可提交，且 onSubmit 收到 passed 提交', async () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    expect((await screen.findAllByText(/输出与验收点一致/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), {
      target: { value: '教学运行器输出 15，与验收点一致。' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const call = onSubmit.mock.calls[0]![0] as Challenge
    expect(call.id).toBe('stage-b')

    // 提交只清证据、不动代码：从没编辑过代码的人，提交后编辑器必须还是起始代码。
    // 旧实现在 patchDraft 的基底里凭空补 code:''，这一次提交就把起始代码顶成了空白。
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    expect((screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement).value).toBe(
      challenges[1]!.starterCode,
    )
    expect(document.querySelector('.challenge-draft-state--code')?.textContent).toContain('本机无代码草稿')
  })

  it('外部实验关卡不调用运行器，并显示不伪造声明与证据要求', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /编写与运行/ }))
    expect(screen.getByText(/本页面不会伪造真实运行结果/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /运行检查/ })).toBeNull()
  })

  it('R4：外部关卡提交随机长文本不会进入已验证通过状态（结构化必填校验）', () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))

    // 只填“结果摘要”一栏的随机长文本：必填字段缺失 → 不能提交
    fireEvent.change(screen.getByLabelText(/结果摘要/), {
      target: { value: '这是一段足够长的随机文本，用来模拟原先仅凭长度即可通过的情况。'.repeat(3) },
    })
    expect((screen.getByRole('button', { name: /提交证据/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()

    // 必填项缺失时有可访问的错误提示
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('R4：外部关卡填齐必填字段后可提交，且 onSubmit 收到 passed=false 与 external 等级', () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))

    fireEvent.change(screen.getByLabelText(/执行环境/), { target: { value: 'Windows 11 + JDK 17' } })
    fireEvent.change(screen.getByLabelText(/执行命令/), { target: { value: 'java -version' } })
    fireEvent.change(screen.getByLabelText(/结果摘要/), {
      target: { value: '完成四个工具链版本输出记录，并定位一次构建错误后修复。' },
    })
    fireEvent.change(screen.getByLabelText(/复现日期/), { target: { value: '2026-09-01' } })

    const submit = screen.getByRole('button', { name: /提交证据/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [, submission] = onSubmit.mock.calls[0]!
    expect(submission.passed).toBe(false)
    expect(submission.tier).toBe('external')
    expect(submission.evidence).toContain('执行环境：Windows 11 + JDK 17')
    expect(submission.externalEvidence?.command).toBe('java -version')
  })

  it('R4：外部证据命中隐私字段时拒绝提交', () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))

    fireEvent.change(screen.getByLabelText(/执行环境/), { target: { value: 'Windows 11' } })
    fireEvent.change(screen.getByLabelText(/执行命令/), { target: { value: 'mysql -u root password=secret123' } })
    fireEvent.change(screen.getByLabelText(/结果摘要/), { target: { value: '完成版本输出记录与构建错误定位' } })
    fireEvent.change(screen.getByLabelText(/复现日期/), { target: { value: '2026-09-01' } })

    expect((screen.getByRole('button', { name: /提交证据/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/疑似包含密码/)).toBeTruthy()
  })

  it('R4：运行结果展示执行等级', async () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: /编写与运行/ }))
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    expect((await screen.findAllByText(/教学模拟（子集语法，非真实编译器）/)).length).toBeGreaterThan(0)
  })

  it('R4：教学运行器未识别结构时给出未识别状态而非通过', async () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: /编写与运行/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: '// 只有注释，没有任何可识别结构' },
    })
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    expect((await screen.findAllByText(/未识别代码结构，未产生通过判定/)).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))
    expect((screen.getByRole('button', { name: /提交答案/ }) as HTMLButtonElement).disabled).toBe(true)
    // 回到列表查看概览：未识别结构不增加完成数
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(screen.getByText(/已完成 0 \/ 13/)).toBeTruthy()
  })

  it('R4：待人工确认的记录不影响完成数，并显示待确认提示', () => {
    render(
      <ChallengesView
        challenges={challenges}
        progress={{
          'stage-a': {
            completedAt: '2026-09-13T00:00:00.000Z',
            evidence: '执行环境：Windows 11',
            status: 'submitted',
            tier: 'external',
          },
        }}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    // 完成数仍为 0，但单独显示待人工确认
    expect(screen.getByText(/已完成 0 \/ 13/)).toBeTruthy()
    expect(screen.getByText(/待人工确认 1 关/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))
    expect(screen.getByText(/待人工确认（未计入已通过）/)).toBeTruthy()
  })

  it('R4 人工复核（LEARN-01 第 4 条）：submitted 这一档真有出口，状态迁移整个交回 hook', () => {
    const onVerifySubmission = vi.fn()
    const onRejectSubmission = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{
          'stage-a': {
            completedAt: '2026-09-13T00:00:00.000Z',
            evidence: '执行环境：Windows 11',
            status: 'submitted',
            tier: 'external',
          },
        }}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
        onVerifySubmission={onVerifySubmission}
        onRejectSubmission={onRejectSubmission}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))
    // 这一行说的是**谁在判定**：人工确认不等于系统验证过外部结果。
    expect(screen.getByText(/人工复核改的就是这条记录的状态/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /确认通过（人工复核）/ }))
    expect(onVerifySubmission).toHaveBeenCalledWith('stage-a', undefined)

    selectOption('学习状态标注（可选，不参与通过判定）', 'partially-completed')
    fireEvent.click(screen.getByRole('button', { name: /标记不通过/ }))
    expect(onRejectSubmission).toHaveBeenCalledWith('stage-a')
    expect(onVerifySubmission).toHaveBeenCalledTimes(1)
  })

  it('调用方没有复核能力时不画这两个按钮：不给一个按了没用的假动作', () => {
    renderView({
      'stage-a': {
        completedAt: '2026-09-13T00:00:00.000Z',
        evidence: '执行环境：Windows 11',
        status: 'submitted',
        tier: 'external',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: /提交记录/ }))
    expect(screen.getByText(/待人工确认（未计入已通过）/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认通过（人工复核）/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /标记不通过/ })).toBeNull()
  })

  it('切换标签页不清空代码草稿与证据说明', async () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor = screen.getByRole('textbox', { name: /代码编辑器/ })
    fireEvent.change(editor, { target: { value: 'int total = 999; // 我的草稿' } })
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), {
      target: { value: '证据草稿内容' },
    })
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor2 = screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement
    expect(editor2.value).toContain('我的草稿')
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect((screen.getByRole('textbox', { name: '完成证据说明' }) as HTMLTextAreaElement).value).toBe('证据草稿内容')
  })

  it('空筛选结果显示清除筛选按钮，点击后回到第 1 页 12 张卡片', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    selectOption('轨道', '安全')
    selectOption('难度', '入门')
    expect(screen.getByText('当前筛选条件下一个关卡都不匹配。')).toBeTruthy()
    // 空态内也提供清除筛选；与筛选条中的清除按钮并存
    const emptyState = screen.getByText('当前筛选条件下一个关卡都不匹配。').parentElement!
    fireEvent.click(emptyState.querySelector('button')!)
    expect(document.querySelectorAll('.stage-card')).toHaveLength(12)
  })

  it('键盘：卡片可聚焦并回车选择；标签页支持方向键切换', () => {
    renderView()
    // Tab 进入网格后用 Enter 选择 M 关（先用阶段筛选定位到第 1 页）
    selectOption('阶段', 'M')
    const mCard = screen.getByRole('button', { name: /M 关：竞赛综合实战/ })
    mCard.focus()
    fireEvent.keyDown(mCard, { key: 'Enter' })
    fireEvent.click(mCard) // 浏览器原生按钮 Enter 触发 click；jsdom 中显式验证 click 生效
    expect(screen.getByRole('heading', { level: 2, name: /M 关卡验收/ })).toBeTruthy()

    // 详情标签页：焦点在第一个标签（题目），ArrowRight 切到第二个并移动焦点
    const overviewTab = screen.getByRole('tab', { name: '题目' })
    overviewTab.focus()
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '编写与运行' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: '编写与运行' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '题目' }).getAttribute('aria-selected')).toBe('true')
  })

  it('概览进度条带 aria 数值与文本', () => {
    renderView(record())
    const bar = screen.getByRole('progressbar', { name: '挑战完成进度' })
    expect(bar.getAttribute('aria-valuemax')).toBe('13')
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(screen.getByText(/已完成 1 \/ 13/)).toBeTruthy()
  })
})
