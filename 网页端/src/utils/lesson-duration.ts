/**
 * 课程时长的单一展示口径（R2-E，E.3 第 8 条）。
 *
 * 两个字段语义不同，必须区分：
 * - `content.estimatedMinutes`：结构化预计时长（分钟，数值），用于学习路径与工作台展示。
 * - `lesson.duration`：早期课程的展示字符串（如 "8 min"），仅在缺少 estimatedMinutes 时回退。
 */
import type { Lesson } from '../types/lesson'

export function lessonDurationLabel(lesson: Pick<Lesson, 'duration' | 'content'>): string {
  const estimate = lesson.content?.estimatedMinutes
  if (typeof estimate === 'number' && estimate > 0) return `预计 ${estimate} 分钟`
  return lesson.duration
}
