/**
 * 由 `node scripts/contract-types.mjs` 从 contracts/openapi.yaml + contracts/errors.yaml 生成，不要手改。
 * 契约版本：1.0.0 · OpenAPI 3.1.0
 * 源文件哈希见 contracts/generated/sync-manifest.json。
 */

/** 服务端可能返回的 HTTP 错误码（不含内容管线校验码，那份在 validation-codes.yaml）。 */
export type ApiErrorCode =
  | 'already_synced'
  | 'asset_not_found'
  | 'asset_rate_limited'
  | 'asset_too_large'
  | 'asset_type_forbidden'
  | 'bind_failed'
  | 'body_too_large'
  | 'commit_failed'
  | 'confirmation_required'
  | 'cross_site_rejected'
  | 'email_taken'
  | 'evidence_not_found'
  | 'evidence_store_unreadable'
  | 'export_failed'
  | 'forbidden'
  | 'internal_error'
  | 'invalid_bio'
  | 'invalid_content_id'
  | 'invalid_credentials'
  | 'invalid_credentials_format'
  | 'invalid_email'
  | 'invalid_evidence'
  | 'invalid_json'
  | 'invalid_manifest'
  | 'invalid_name'
  | 'invalid_password'
  | 'invalid_path_encoding'
  | 'invalid_phone'
  | 'invalid_relative_path'
  | 'job_not_found'
  | 'not_found'
  | 'operation_rolled_back'
  | 'owner_record_corrupt'
  | 'owner_taken'
  | 'owner_unbound'
  | 'password_unchanged'
  | 'path_escape'
  | 'phone_taken'
  | 'preview_failed'
  | 'progress_pending'
  | 'progress_unavailable'
  | 'publish_failed'
  | 'rollback_blocked'
  | 'rollback_failed'
  | 'source_changed'
  | 'source_not_found'
  | 'stale_preview'
  | 'storage_corrupt'
  | 'storage_error'
  | 'structure_unsupported'
  | 'sync_conflict'
  | 'sync_rate_limited'
  | 'too_many_attempts'
  | 'transaction_corrupt'
  | 'transactions_unreadable'
  | 'unauthorized'
  | 'unbind_failed'
  | 'unsupported_media_type'
  | 'vault_private'
  | 'vault_unavailable'
  | 'visibility_failed'
  | 'wrong_current_password'

/** 错误码 -> 默认 HTTP 状态码，与 contracts/errors.yaml 同一来源。 */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  'unauthorized': 401,
  'forbidden': 403,
  'vault_private': 403,
  'owner_record_corrupt': 403,
  'storage_corrupt': 503,
  'invalid_path_encoding': 400,
  'internal_error': 500,
  'not_found': 404,
  'cross_site_rejected': 403,
  'unsupported_media_type': 415,
  'invalid_json': 400,
  'body_too_large': 413,
  'invalid_name': 400,
  'invalid_email': 400,
  'invalid_phone': 400,
  'invalid_password': 400,
  'password_unchanged': 400,
  'wrong_current_password': 400,
  'email_taken': 409,
  'phone_taken': 409,
  'invalid_credentials_format': 400,
  'invalid_credentials': 401,
  'too_many_attempts': 429,
  'storage_error': 500,
  'invalid_bio': 400,
  'invalid_content_id': 400,
  'invalid_relative_path': 400,
  'path_escape': 403,
  'asset_type_forbidden': 403,
  'asset_too_large': 413,
  'invalid_manifest': 409,
  'source_changed': 409,
  'publish_failed': 409,
  'sync_rate_limited': 429,
  'vault_unavailable': 503,
  'job_not_found': 404,
  'asset_not_found': 404,
  'asset_rate_limited': 429,
  'confirmation_required': 400,
  'owner_unbound': 409,
  'owner_taken': 409,
  'bind_failed': 400,
  'unbind_failed': 403,
  'visibility_failed': 403,
  'progress_unavailable': 503,
  'evidence_not_found': 400,
  'invalid_evidence': 400,
  'already_synced': 400,
  'evidence_store_unreadable': 503,
  'transactions_unreadable': 503,
  'preview_failed': 400,
  'commit_failed': 400,
  'rollback_failed': 400,
  'export_failed': 400,
  'sync_conflict': 409,
  'stale_preview': 409,
  'structure_unsupported': 409,
  'rollback_blocked': 409,
  'operation_rolled_back': 409,
  'transaction_corrupt': 409,
  'progress_pending': 409,
  'source_not_found': 404,
} as const

/** 客户端做分支用：可重试性不靠猜 HTTP 状态。 */
export const ERROR_RETRYABLE: Record<ApiErrorCode, string> = {
  'unauthorized': 'never',
  'forbidden': 'never',
  'vault_private': 'never',
  'owner_record_corrupt': 'afterRepair',
  'storage_corrupt': 'afterRepair',
  'invalid_path_encoding': 'never',
  'internal_error': 'retry',
  'not_found': 'never',
  'cross_site_rejected': 'never',
  'unsupported_media_type': 'never',
  'invalid_json': 'never',
  'body_too_large': 'never',
  'invalid_name': 'never',
  'invalid_email': 'never',
  'invalid_phone': 'never',
  'invalid_password': 'never',
  'password_unchanged': 'never',
  'wrong_current_password': 'never',
  'email_taken': 'never',
  'phone_taken': 'never',
  'invalid_credentials_format': 'never',
  'invalid_credentials': 'never',
  'too_many_attempts': 'afterWindow',
  'storage_error': 'afterRepair',
  'invalid_bio': 'never',
  'invalid_content_id': 'never',
  'invalid_relative_path': 'never',
  'path_escape': 'never',
  'asset_type_forbidden': 'never',
  'asset_too_large': 'never',
  'invalid_manifest': 'afterRepair',
  'source_changed': 'manual',
  'publish_failed': 'afterRepair',
  'sync_rate_limited': 'afterWindow',
  'vault_unavailable': 'afterRepair',
  'job_not_found': 'never',
  'asset_not_found': 'never',
  'asset_rate_limited': 'afterWindow',
  'confirmation_required': 'never',
  'owner_unbound': 'manual',
  'owner_taken': 'never',
  'bind_failed': 'manual',
  'unbind_failed': 'never',
  'visibility_failed': 'never',
  'progress_unavailable': 'afterRepair',
  'evidence_not_found': 'never',
  'invalid_evidence': 'never',
  'already_synced': 'never',
  'evidence_store_unreadable': 'afterRepair',
  'transactions_unreadable': 'retry',
  'preview_failed': 'manual',
  'commit_failed': 'manual',
  'rollback_failed': 'manual',
  'export_failed': 'manual',
  'sync_conflict': 'manual',
  'stale_preview': 'manual',
  'structure_unsupported': 'never',
  'rollback_blocked': 'never',
  'operation_rolled_back': 'never',
  'transaction_corrupt': 'afterRepair',
  'progress_pending': 'retry',
  'source_not_found': 'never',
} as const

/** 路由表：两端只能按这里的方法 + 路径模板发请求，不许自己拼未登记的地址。 */
export const API_OPERATIONS = [
  { method: 'GET', path: '/api/health', requiresSession: false, bodyless: false, summary: "健康检查与实例身份" },
  { method: 'POST', path: '/api/auth/register', requiresSession: false, bodyless: false, summary: "注册并直接建立会话" },
  { method: 'POST', path: '/api/auth/login', requiresSession: false, bodyless: false, summary: "登录（邮箱或手机号同一字段提交）" },
  { method: 'POST', path: '/api/auth/logout', requiresSession: true, bodyless: true, summary: "登出并清除会话 Cookie" },
  { method: 'GET', path: '/api/auth/me', requiresSession: true, bodyless: false, summary: "当前会话对应的账户" },
  { method: 'POST', path: '/api/auth/change-password', requiresSession: true, bodyless: false, summary: "修改密码并使其它会话失效" },
  { method: 'PATCH', path: '/api/profile', requiresSession: true, bodyless: false, summary: "更新昵称与个人简介" },
  { method: 'GET', path: '/api/content/status', requiresSession: true, bodyless: false, summary: "内容联动就绪状态" },
  { method: 'GET', path: '/api/content/catalog', requiresSession: true, bodyless: false, summary: "课程目录（阶段 / 单元 / 练习索引）" },
  { method: 'GET', path: '/api/content/lessons/{id}', requiresSession: true, bodyless: false, summary: "单份教学单元正文" },
  { method: 'GET', path: '/api/content/exercises/{id}', requiresSession: true, bodyless: false, summary: "单份练习" },
  { method: 'GET', path: '/api/content/asset', requiresSession: true, bodyless: false, summary: "按白名单读取发布包内的附件" },
  { method: 'POST', path: '/api/content/sync', requiresSession: true, bodyless: false, summary: "请求重建内容快照（异步作业）" },
  { method: 'GET', path: '/api/content/sync/{jobId}', requiresSession: true, bodyless: false, summary: "查询同步作业状态" },
  { method: 'GET', path: '/api/learning/status', requiresSession: true, bodyless: false, summary: "拥有者绑定与可见范围状态" },
  { method: 'POST', path: '/api/learning/owner', requiresSession: true, bodyless: false, summary: "把自己绑定为该资料库的拥有者" },
  { method: 'DELETE', path: '/api/learning/owner', requiresSession: true, bodyless: true, summary: "解除拥有者绑定" },
  { method: 'PATCH', path: '/api/learning/owner/visibility', requiresSession: true, bodyless: false, summary: "切换教材对其它账户的可见性" },
  { method: 'GET', path: '/api/learning/vault-progress', requiresSession: true, bodyless: false, summary: "正式学习进度只读投影" },
  { method: 'GET', path: '/api/learning/evidence', requiresSession: true, bodyless: false, summary: "读取暂存证据队列" },
  { method: 'POST', path: '/api/learning/evidence', requiresSession: true, bodyless: false, summary: "暂存一条学习证据" },
  { method: 'POST', path: '/api/learning/evidence/remove', requiresSession: true, bodyless: false, summary: "删除一条尚未同步的暂存证据" },
  { method: 'POST', path: '/api/learning/evidence-preview', requiresSession: true, bodyless: false, summary: "预览将写入资料库的内容（不落盘）" },
  { method: 'POST', path: '/api/learning/evidence-commit', requiresSession: true, bodyless: false, summary: "确认写回（事务提交）" },
  { method: 'POST', path: '/api/learning/evidence-rollback', requiresSession: true, bodyless: false, summary: "回滚一次写回事务（用写入前的备份覆盖回来）" },
  { method: 'POST', path: '/api/learning/evidence-export', requiresSession: true, bodyless: false, summary: "把暂存证据导出为可核对的 Markdown" },
  { method: 'GET', path: '/api/learning/evidence-transactions', requiresSession: true, bodyless: false, summary: "列出拥有者的写回事务账本（新→旧）" },
  { method: 'GET', path: '/api/learning/evidence-transaction/{operationId}', requiresSession: true, bodyless: false, summary: "单个事务的状态与明细" },
] as const

export type ApiOperation = (typeof API_OPERATIONS)[number]

/** 会话 Cookie 名与固定属性，端侧只读参考：真正的属性由服务端下发。 */
export const SESSION_COOKIE = 'code_canvas_session'
export const SESSION_COOKIE_ATTRIBUTES = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800'] as const

// --- components.schemas ---------------------------------------------------
export type Error = {
  error: string
  message: string
  details?: unknown
  [key: string]: unknown
}

export type User = {
  id: string
  email?: null
  phone?: null
  name: string
  bio: string
  createdAt: string
}

export type EvidenceRecord = {
  evidenceId: string
  topic: string
  stage?: null
  createdAt: string
  [key: string]: unknown
}

export type WritebackOutcome = {
  operationId?: string
  status?: string
  targets?: Record<string, unknown>[]
  [key: string]: unknown
}
