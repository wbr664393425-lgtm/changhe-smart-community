// 本地离线纪实实景影像映射（纯本地静态资源，保障政务内网零外链破图）
// 时间、地点、经办人政务水印由 <EvidencePhoto> 组件高精度叠加渲染，避免图片缩放裁切水印文字

const BASE = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/')
const p = (file) => `${BASE}photos/${file}`

const BASE_PHOTOS = {
  fireBefore: p('fire-corridor-before.jpg'),
  fireAfter: p('fire-corridor-after.jpg'),
  kitchenBefore: p('kitchen-gas-before.jpg'),
  kitchenAfter: p('kitchen-gas-after.jpg'),
  dustBefore: p('construction-dust-before.jpg'),
  dustAfter: p('construction-dust-after.jpg'),
  drainBefore: p('drain-grate-before.jpg'),
  drainAfter: p('drain-grate-after.jpg'),
  parkingBefore: p('parking-shed-before.jpg'),
  parkingAfter: p('parking-shed-after.jpg'),
  sidewalkAfter: p('sidewalk-clutter-after.jpg'),
  forestBefore: p('forest-fire-before.jpg'),
  forestAfter: p('forest-fire-after.jpg'),
  aerial: p('changhe-aerial.jpg'),
  visit1: p('armed-visit-1.jpg'),
  visit2: p('armed-visit-2.jpg'),
  militia1: p('armed-militia-1.jpg'),
  double1: p('armed-double-1.jpg'),
  edu1: p('armed-edu-1.jpg')
}

function pickEventPair(text) {
  const s = String(text || '')
  if (/燃气|后厨|面馆|餐饮|油烟|早餐|食品|药房|冷链|超市|商铺.*排查/.test(s)) {
    return [BASE_PHOTOS.kitchenBefore, BASE_PHOTOS.kitchenAfter]
  }
  if (/裸土|防尘网|工地|扬尘|秸秆/.test(s)) {
    return [BASE_PHOTOS.dustBefore, BASE_PHOTOS.dustAfter]
  }
  if (/雨水|箅子|淤堵|漂浮物|支渠|排灌|河|排水|积水|易涝/.test(s)) {
    return [BASE_PHOTOS.drainBefore, BASE_PHOTOS.drainAfter]
  }
  if (/充电棚|照明|非机动车|路灯|停车|门禁|电梯|车库|健身器材/.test(s)) {
    return [BASE_PHOTOS.parkingBefore, BASE_PHOTOS.parkingAfter]
  }
  if (/林地|林缘|枯枝|杂草|绿化|防火隐患/.test(s)) {
    return [BASE_PHOTOS.forestBefore, BASE_PHOTOS.forestAfter]
  }
  if (/盲道|占道|堆放建材|摊点|扰民|噪声|纠纷|调解|扶手/.test(s)) {
    return [BASE_PHOTOS.fireBefore, BASE_PHOTOS.sidewalkAfter]
  }
  return [BASE_PHOTOS.fireBefore, BASE_PHOTOS.fireAfter]
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

  const [beforeImg, afterImg] = pickEventPair(text)
  return scene === 'after' ? afterImg : beforeImg
}

export function isLegacySvgPhoto(url) {
  return typeof url === 'string' && url.startsWith('data:image/svg+xml')
}
