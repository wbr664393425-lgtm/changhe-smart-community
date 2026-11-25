// 本地离线纪实实景影像映射（纯本地静态资源，保障政务内网零外链破图）
// 时间、地点、经办人政务水印由 <EvidencePhoto> 组件高精度叠加渲染，避免图片缩放裁切水印文字

const BASE = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/')
const p = (file) => `${BASE}photos/${file}`

const BASE_PHOTOS = {
  fireBefore: p('fire-corridor-before.webp'),
  fireAfter: p('fire-corridor-after.webp'),
  kitchenBefore: p('kitchen-gas-before.webp'),
  kitchenAfter: p('kitchen-gas-after.webp'),
  dustBefore: p('construction-dust-before.webp'),
  dustAfter: p('construction-dust-after.webp'),
  drainBefore: p('drain-grate-before.webp'),
  drainAfter: p('drain-grate-after.webp'),
  parkingBefore: p('parking-shed-before.webp'),
  parkingAfter: p('parking-shed-after.webp'),
  sidewalkAfter: p('sidewalk-clutter-after.webp'),
  forestBefore: p('forest-fire-before.webp'),
  forestAfter: p('forest-fire-after.webp'),
  aerial: p('changhe-aerial.webp'),
  visit1: p('armed-visit-1.webp'),
  visit2: p('armed-visit-2.webp'),
  militia1: p('armed-militia-1.webp'),
  double1: p('armed-double-1.webp'),
  edu1: p('armed-edu-1.webp')
}

function matchRule(s) {
  if (/燃气|后厨|面馆|餐饮|油烟|早餐|食品|药房|冷链|超市|商铺.*排查/.test(s)) {
    return [BASE_PHOTOS.kitchenBefore, BASE_PHOTOS.kitchenAfter]
  }
  if (/裸土|防尘网|工地|扬尘|秸秆/.test(s)) {
    return [BASE_PHOTOS.dustBefore, BASE_PHOTOS.dustAfter]
  }
  if (/雨水|箅子|淤堵|漂浮物|支渠|排灌|河道|河湖|河岸|水渠|排水沟|积水|易涝/.test(s)) {
    return [BASE_PHOTOS.drainBefore, BASE_PHOTOS.drainAfter]
  }
  if (/消防通道|楼道.*堆|连廊|疏散通道|电动车入户|消防栓|灭火器|配电箱/.test(s)) {
    return [BASE_PHOTOS.fireBefore, BASE_PHOTOS.fireAfter]
  }
  if (/充电棚|照明|非机动车|路灯|停车|门禁|电梯|车库|健身器材/.test(s)) {
    return [BASE_PHOTOS.parkingBefore, BASE_PHOTOS.parkingAfter]
  }
  if (/林地|林缘|枯枝|杂草|绿化|防火隐患/.test(s)) {
    return [BASE_PHOTOS.forestBefore, BASE_PHOTOS.forestAfter]
  }
  if (/装修|噪声|扰民|渗水|纠纷|调解|扶手/.test(s)) {
    return [BASE_PHOTOS.visit2, BASE_PHOTOS.visit1]
  }
  if (/盲道|占道|堆放建材|摊点/.test(s)) {
    return [BASE_PHOTOS.parkingBefore, BASE_PHOTOS.sidewalkAfter]
  }
  return null
}

function pickEventPair(title, location) {
  // 优先按事件标题精准匹配，避免楼盘名/道路名（如“云河赋”“长河大道”“岔河路”）触发水系误判
  return (
    matchRule(String(title || '')) ||
    matchRule(`${title || ''} ${location || ''}`) ||
    [BASE_PHOTOS.fireBefore, BASE_PHOTOS.fireAfter]
  )
}

export function buildScenePhoto({
  scene = 'before',
  title = '现场核查照片',
  location = ''
} = {}) {
  const text = `${title} ${location}`

  if (scene === 'visit') {
    if (/喜报|泰和/.test(text)) return BASE_PHOTOS.double1
    if (/冬|回访|郭家庵/.test(text)) return BASE_PHOTOS.visit2
    return BASE_PHOTOS.visit1
  }
  if (scene === 'militia') {
    if (/消防|商圈|巡查/.test(text)) return BASE_PHOTOS.fireBefore
    return BASE_PHOTOS.militia1
  }
  if (scene === 'double') {
    if (/授牌|崇军/.test(text)) return BASE_PHOTOS.visit1
    return BASE_PHOTOS.double1
  }
  if (scene === 'edu') {
    if (/广场|户外|宣传/.test(text)) return BASE_PHOTOS.double1
    return BASE_PHOTOS.edu1
  }

  const [beforeImg, afterImg] = pickEventPair(title, location)
  return scene === 'after' ? afterImg : beforeImg
}

export function isLegacySvgPhoto(url) {
  return typeof url === 'string' && url.startsWith('data:image/svg+xml')
}

export function isBuiltInScenePhoto(url) {
  if (isLegacySvgPhoto(url)) return true
  return typeof url === 'string' && /(?:^|\/)photos\/[a-z0-9-]+\.webp$/i.test(url)
}
