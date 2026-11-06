/**
 * 资料库拥有者绑定（LINK-08，02 号方案 §4 正式学习事实规则）。
 *
 * 规则：
 * - **初次绑定必须由用户显式选择**：不根据昵称、邮箱或时间自动猜测（方案 §10.1）。
 * - 正式进度（进度追踪投影）**只对拥有者开放**，任何情况下都不进入课程包或检索。
 * - 未绑定时，教材对已登录账户开放（保持既有可用性），但界面必须明确说明
 *   「拥有者尚未绑定、正式进度不对任何账户开放」，不假装已是私人资料库。
 * - 绑定记录属于**应用运行数据**，保存在应用数据目录，绝不写进资料库正文。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const OWNER_SCHEMA_VERSION = 1

export function createOwnerStore({ dataRoot }) {
  const filePath = join(dataRoot, 'vault-owner.json')

  async function read() {
    if (!existsSync(filePath)) {
      return { schemaVersion: OWNER_SCHEMA_VERSION, vaultId: null, ownerUserId: null, boundAt: null, publicContent: false }
    }
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      if (parsed?.schemaVersion !== OWNER_SCHEMA_VERSION) {
        return { schemaVersion: OWNER_SCHEMA_VERSION, vaultId: null, ownerUserId: null, boundAt: null, publicContent: false, corrupt: true }
      }
      return {
        schemaVersion: OWNER_SCHEMA_VERSION,
        vaultId: typeof parsed.vaultId === 'string' ? parsed.vaultId : null,
        ownerUserId: typeof parsed.ownerUserId === 'string' ? parsed.ownerUserId : null,
        boundAt: typeof parsed.boundAt === 'string' ? parsed.boundAt : null,
        publicContent: parsed.publicContent === true,
      }
    } catch {
      // 损坏时按未绑定处理并显式标记，不静默覆盖文件
      return { schemaVersion: OWNER_SCHEMA_VERSION, vaultId: null, ownerUserId: null, boundAt: null, publicContent: false, corrupt: true }
    }
  }

  async function write(record) {
    await mkdir(dataRoot, { recursive: true })
    const temp = `${filePath}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rename(temp, filePath)
    return record
  }

  /**
   * 显式绑定拥有者。
   * @param {string} userId 当前登录账户（由服务端会话确定，不接受客户端传入）
   * @param {string} vaultId 当前资料库 ID
   */
  async function bind(userId, vaultId) {
    if (!userId) throw Object.assign(new Error('缺少账户标识'), { code: 'invalid_owner' })
    if (!vaultId) throw Object.assign(new Error('资料库尚未连接，无法绑定拥有者'), { code: 'vault_unavailable' })
    const current = await read()
    if (current.ownerUserId && current.ownerUserId !== userId) {
      throw Object.assign(new Error('资料库已有拥有者；更换拥有者需要先解绑'), { code: 'owner_taken' })
    }
    return write({
      schemaVersion: OWNER_SCHEMA_VERSION,
      vaultId,
      ownerUserId: userId,
      boundAt: current.boundAt ?? new Date().toISOString(),
      publicContent: current.publicContent === true,
    })
  }

  /** 解绑（仅当前拥有者本人）。 */
  async function unbind(userId) {
    const current = await read()
    if (!current.ownerUserId || current.ownerUserId !== userId) {
      throw Object.assign(new Error('只有资料库拥有者才能解绑'), { code: 'not_owner' })
    }
    return write({ ...current, ownerUserId: null, publicContent: false, boundAt: null })
  }

  /** 教材可见范围：默认私人（仅拥有者）；拥有者可显式放开给其他已登录账户。 */
  async function setVisibility(userId, publicContent) {
    const current = await read()
    if (!current.ownerUserId || current.ownerUserId !== userId) {
      throw Object.assign(new Error('只有资料库拥有者才能修改教材可见范围'), { code: 'not_owner' })
    }
    return write({ ...current, publicContent: publicContent === true })
  }

  /**
   * 教材读取判定：未绑定 → 对已登录账户开放（并标记 unbound）；
   * 已绑定 → 仅拥有者，或拥有者已放开公开教材。
   */
  function contentAccess(record, userId) {
    if (record.corrupt) return { allowed: false, reason: 'owner_record_corrupt' }
    if (!record.ownerUserId) return { allowed: true, reason: 'unbound' }
    if (record.ownerUserId === userId) return { allowed: true, reason: 'owner' }
    if (record.publicContent) return { allowed: true, reason: 'public_content' }
    return { allowed: false, reason: 'vault_private' }
  }

  return { read, bind, unbind, setVisibility, contentAccess, filePath }
}