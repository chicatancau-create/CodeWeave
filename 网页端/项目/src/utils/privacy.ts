/** 隐私脱敏（N2 账户安全页展示用）：只显示足以辨认的片段。 */

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const visible = local.slice(0, Math.min(1, local.length))
  return `${visible}***${domain}`
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length !== 11) return '***'
  return `${digits.slice(0, 3)}****${digits.slice(7)}`
}

/** 登录方式描述（脱敏）：邮箱优先，其次手机号，都没有则显示“未设置”。 */
export function describeLoginMethod(user: { email?: string; phone?: string }): string {
  if (user.email) return `邮箱 ${maskEmail(user.email)}`
  if (user.phone) return `手机号 ${maskPhone(user.phone)}`
  return '未设置联系方式'
}
