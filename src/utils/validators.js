// 国标 15/18 位身份证号校验、11 位手机号校验、脱敏展示、防反查拦截及安全公式计算

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export function validateIdCard(val) {
  const s = String(val || '').trim().toUpperCase()
  if (!s) return { valid: false, message: '请输入身份证号' }
  if (/^\d{15}$/.test(s)) return { valid: true, message: '' }
  if (!/^\d{17}[\dX]$/.test(s)) {
    return { valid: false, message: '身份证号须为 15 位数字或 18 位（末位可为大写 X）' }
  }
  const year = Number(s.slice(6, 10))
  const month = Number(s.slice(10, 12))
  const day = Number(s.slice(12, 14))
  if (year < 1900 || year > 2026 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, message: '身份证号出生日期段不合法，请核对原件' }
  }
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * WEIGHTS[i]
  const expected = CHECK_CODES[sum % 11]
  if (s[17] !== expected) {
    return { valid: false, message: `第 18 位校验码不符（应为 ${expected}），请核对身份证原件` }
  }
  return { valid: true, message: '' }
}

export function validatePhone(val) {
  const s = String(val || '').trim()
  if (!s) return { valid: false, message: '请输入手机号码' }
  if (!/^1[3-9]\d{9}$/.test(s)) {
    return { valid: false, message: '请输入正确的 11 位中国大陆手机号码' }
  }
  return { valid: true, message: '' }
}

export function maskValue(type, val, reveal = false) {
  const s = String(val ?? '')
  if (!s || reveal) return s
  if (type === 'idcard') {
    if (s.includes('*')) return s
    return s.length >= 14 ? `${s.slice(0, 6)}********${s.slice(-4)}` : '******'
  }
  if (type === 'phone') {
    if (s.includes('*')) return s
    return s.length === 11 ? `${s.slice(0, 3)}****${s.slice(-4)}` : s
  }
  if (type === 'name_masked') {
    if (s.length <= 1) return s
    if (s.length === 2) return `${s[0]}*`
    return `${s[0]}*${s.slice(-1)}`
  }
  return s
}

/**
 * 检测检索词是否企图对脱敏字段（手机号/身份证）进行明文撞库反查
 */
export function isSensitiveCollisionQuery(keyword) {
  const q = String(keyword || '').trim()
  if (!q) return false
  if (/^1[3-9]\d{1,9}$/.test(q)) return true
  if (/^\d{6}(19|20)\d{2}/.test(q)) return true
  if (/^\d{15}$/.test(q) || /^\d{17}[\dXx]$/.test(q)) return true
  return false
}

/**
 * 安全解析加减乘除公式（不使用 eval / Function，支持字段 key 占位符）
 * 支持常见模板：{a} - {b}, {a} + {b}, {a} * {b}
 */
export function evaluateFormula(expr, values = {}) {
  if (!expr) return 0
  const m = String(expr).match(/^\s*\{([\w\u4e00-\u9fa5]+)\}\s*([+\-*/])\s*\{([\w\u4e00-\u9fa5]+)\}\s*$/)
  if (!m) return 0
  const [, k1, op, k2] = m
  const a = Number(values[k1] ?? 0)
  const b = Number(values[k2] ?? 0)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  let res = 0
  if (op === '+') res = a + b
  else if (op === '-') res = a - b
  else if (op === '*') res = a * b
  else if (op === '/') res = b === 0 ? 0 : +(a / b).toFixed(2)
  return Math.max(0, Number.isInteger(res) ? res : Number(res.toFixed(2)))
}
