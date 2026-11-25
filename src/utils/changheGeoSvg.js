import { CHANGHE_OUTER_BOUNDARY, CHANGHE_COMMUNITY_GEO } from './changheGeo'
import { LOADER_HQ_LATLNG, LOADER_WATER_COORDS } from './cockpitLoaderGeo'

export const SVG_W = 460
export const SVG_H = 312
const PAD_X = 38
const PAD_Y = 24
const COS_LAT = Math.cos((37.4408 * Math.PI) / 180)

/**
 * 一次性将长河街道真实经纬度轮廓、14 社区界线及真实岔河/长河水系等比投影至 SVG 视口
 * （零大 JSON 与 Three.js 依赖，供登录页与驾驶舱加载幕 1:1 像素级无缝承接）
 */
export const CHANGHE_GEO_SVG = (() => {
  const toXY = ([lat, lng]) => [lng * COS_LAT, -lat]
  const rawOuter = CHANGHE_OUTER_BOUNDARY.map(toXY)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  rawOuter.forEach(([x, y]) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })

  const spanX = Math.max(1e-6, maxX - minX)
  const spanY = Math.max(1e-6, maxY - minY)
  const scale = Math.min((SVG_W - PAD_X * 2) / spanX, (SVG_H - PAD_Y * 2) / spanY)
  const drawW = spanX * scale
  const drawH = spanY * scale
  const offX = (SVG_W - drawW) / 2
  const offY = (SVG_H - drawH) / 2

  const project = ([lat, lng]) => {
    const [rx, ry] = toXY([lat, lng])
    return [
      Number((offX + (rx - minX) * scale).toFixed(2)),
      Number((offY + (ry - minY) * scale).toFixed(2))
    ]
  }

  const ptsToPath = (coords) => {
    if (!coords?.length) return ''
    const p = coords.map(project)
    return `M ${p[0][0]} ${p[0][1]} ` + p.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') + ' Z'
  }

  const waterPaths = LOADER_WATER_COORDS.map(ptsToPath)

  const outerPts = CHANGHE_OUTER_BOUNDARY.map(project)
  const closedOuter = [...outerPts, outerPts[0]]
  const cumLens = [0]
  let totalLen = 0
  for (let i = 1; i < closedOuter.length; i++) {
    const dx = closedOuter[i][0] - closedOuter[i - 1][0]
    const dy = closedOuter[i][1] - closedOuter[i - 1][1]
    totalLen += Math.hypot(dx, dy)
    cumLens.push(totalLen)
  }

  const hqPt = project(LOADER_HQ_LATLNG)

  // 将 14 社区按自西南向东北依次排序，随进度均匀优雅点亮
  const commEntries = Object.entries(CHANGHE_COMMUNITY_GEO).map(([name, geo]) => {
    const cPt = project(geo.center)
    return {
      name,
      shortName: name.replace('社区', ''),
      path: ptsToPath(geo.polygon),
      cx: cPt[0],
      cy: cPt[1],
      orderScore: cPt[0] * 0.65 - cPt[1] * 0.85
    }
  })
  commEntries.sort((a, b) => a.orderScore - b.orderScore)
  const communities = commEntries.map((item, idx) => ({
    ...item,
    threshold: 8 + Math.round((idx / Math.max(1, commEntries.length - 1)) * 80)
  }))

  return {
    outerPath: ptsToPath(CHANGHE_OUTER_BOUNDARY),
    waterPaths,
    closedOuter,
    cumLens,
    totalLen: Math.max(1, totalLen),
    hqPt,
    communities
  }
})()

/** 按 0..1 进度比例计算长河疆域外轮廓上的精确坐标点 */
export function computeOuterPointAtRatio(ratio) {
  const { closedOuter, cumLens, totalLen } = CHANGHE_GEO_SVG
  if (ratio <= 0 || ratio >= 1) return { x: closedOuter[0][0], y: closedOuter[0][1] }
  const target = ratio * totalLen
  let idx = 1
  while (idx < cumLens.length - 1 && cumLens[idx] < target) idx++
  const segStart = cumLens[idx - 1]
  const segLen = Math.max(1e-6, cumLens[idx] - segStart)
  const t = Math.max(0, Math.min(1, (target - segStart) / segLen))
  const p0 = closedOuter[idx - 1]
  const p1 = closedOuter[idx]
  return {
    x: p0[0] + (p1[0] - p0[0]) * t,
    y: p0[1] + (p1[1] - p0[1]) * t
  }
}
