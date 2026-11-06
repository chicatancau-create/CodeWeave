/**
 * 掌握度地图聚合（N2 个人中心）。
 *
 * LINK-05：阶段与单元归属改为由调用方注入（内容快照驱动），默认仍用旧内置课程，
 * 保证旧调用方与测试行为不变。旧 A—M 记录只有在阶段集合仍包含 A—M 时才计入，
 * 因此切到 S0—S9 后旧记录不会自动变成新阶段通过。
 */

import type { CurriculumStage } from '../data/curriculum'
import { curriculumStages as legacyCurriculumStages } from '../data/curriculum'
import { lessons as legacyLessons } from '../data/lessons'
import type { MasteryRecord } from '../data/mastery'

export type StageMasteryRow = {
  stageId: string
  title: string
  /** 阶段内最高掌握等级（0—6）；无记录为 0 */
  level: number
  /** 阶段内证据总条数 */
  evidenceCount: number
  /** 阶段内已有记录的单元数 / 单元总数 */
  coveredUnits: number
  totalUnits: number
}

/** 旧口径默认映射：单元 id → 阶段 id（来自旧课程 content.stageId）。 */
const legacyStageByUnit = new Map(legacyLessons.map((lesson) => [lesson.id, lesson.content.stageId]))

export function aggregateMasteryByStage(
  records: Record<string, MasteryRecord>,
  stages: CurriculumStage[] = legacyCurriculumStages,
  stageByUnit: Map<string, string | undefined> = legacyStageByUnit,
): StageMasteryRow[] {
  return stages.map((stage) => {
    const stageUnits = [...stageByUnit.entries()].filter(([, stageId]) => stageId === stage.id)
    const related = Object.values(records).filter((record) => stageByUnit.get(record.refId) === stage.id)
    const level = related.reduce((max, record) => Math.max(max, record.level), 0)
    const evidenceCount = related.reduce((sum, record) => sum + record.evidence.length, 0)
    return {
      stageId: stage.id,
      title: stage.title,
      level,
      evidenceCount,
      coveredUnits: related.length,
      totalUnits: stageUnits.length,
    }
  })
}
