export const STORAGE_KEYS = {
  WORKSPACE: 'code-canvas.workspace.v2',
  PROJECTS: 'code-canvas.projects.v1',
  CHALLENGES: 'code-canvas.challenge-progress.v2',
  CHECKIN: 'code-canvas.checkin.v1',
  SETTINGS: 'code-canvas.settings.v1',
  MASTERY: 'code-canvas.mastery.v1',
  CODE_DRAFTS: 'code-canvas.challenge-drafts.v1',
  EXTERNAL_EVIDENCE: 'code-canvas.external-evidence.v1',
  NOTIFICATIONS: 'code-canvas.notifications.v1',
  NOTIF_EVENTS: 'code-canvas.notification-events.v1',
} as const

export const EXECUTION_SETTINGS = {
  STEP_DELAY_MS: 850,
  MAX_OUTPUT_LINES: 100,
  MAX_EXECUTION_MS: 1500,
} as const

/**
 * 本地学习数据一律按账户隔离：同一浏览器不同账户互不可见。
 * 未登录时使用 guest 作用域。
 */
export function scopedKey(base: string, scope: string | undefined): string {
  return `${base}:${scope ?? 'guest'}`
}
