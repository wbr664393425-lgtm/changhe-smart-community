import * as THREE from 'three'
import { WORLD_DIV } from './cityModelCache'
import badgeAtlasUrl from '../assets/staff-map-badges.png'
import { createStaffAvatarGeometry, createStaffAvatarMaterial } from './cockpitStaffAvatar'
import { createStaffScreenLayout, createStaffStatusTexture } from './cockpitStaffOverview'
import { STAFF_MAP_HEIGHT, STAFF_GROUND_Y } from './cockpitStaffView'

const { clamp, lerp, smoothstep } = THREE.MathUtils
const TAU = Math.PI * 2
const STATUS_SIZE = [14, 16, 21]
const EMPTY = []

export function staffOverviewWeight(viewDistance) {
  return smoothstep(viewDistance, 285, 480)
}

// 全街道先看社区人数；锁定一个社区时，其人员在社区镜头的落点完整展开。
export function staffPointOpacity(viewDistance, scoped) {
  return 1 - (scoped ? smoothstep(viewDistance, 235, 335) : smoothstep(viewDistance, 140, 235))
}

function createFootprint() {
  const shape = new THREE.Shape()
  const start = -Math.PI / 2 + 0.25
  shape.absarc(0, 0, 0.5, start, start + TAU - 0.5, false)
  shape.lineTo(0, -0.73)
  shape.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.38, 0, TAU, true)
  shape.holes.push(hole)
  return new THREE.ShapeGeometry(shape, 12).rotateX(-Math.PI / 2)
}

function createBadgeMaterial(atlas, symbols) {
  return new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlas }, symbols: { value: symbols } },
    vertexShader: `
      attribute vec4 badgeStyle;
      varying vec2 portraitUv, symbolUv, blend;
      void main() {
        portraitUv = (uv + badgeStyle.xy) / 3.0;
        symbolUv = vec2((uv.x + badgeStyle.x) / 3.0, uv.y);
        blend = badgeStyle.zw / 255.0;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D atlas, symbols;
      varying vec2 portraitUv, symbolUv, blend;
      void main() {
        vec4 mark;
        if (blend.x > 0.999) mark = texture2D(symbols, symbolUv);
        else if (blend.x < 0.001) mark = texture2D(atlas, portraitUv);
        else {
          vec4 a = texture2D(atlas, portraitUv), b = texture2D(symbols, symbolUv);
          mark.a = mix(a.a, b.a, blend.x);
          mark.rgb = mix(a.rgb * a.a, b.rgb * b.a, blend.x) / max(mark.a, 0.0001);
        }
        mark.a *= blend.y;
        if (mark.a < 0.02) discard;
        gl_FragColor = mark;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false
  })
}

function createFootMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute float footAlpha;
      varying vec4 footColor;
      void main() {
        footColor = vec4(instanceColor, footAlpha);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec4 footColor;
      void main() {
        gl_FragColor = footColor;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false
  })
}

function dynamicAttribute(array, size, normalized = false) {
  return new THREE.InstancedBufferAttribute(array, size, normalized).setUsage(THREE.DynamicDrawUsage)
}

// 全景状态符号和街区头像始终共用一个公告板、一个脚尖；近景模型在同一地面坐标交叉淡入。
export function createStaffMarkers(capacity, onTextureReady) {
  const group = new THREE.Group()
  function batch(geometry, material, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    group.add(mesh)
    return mesh
  }
  let atlasReady = false, portraitAvailability = 0
  const atlas = new THREE.TextureLoader().load(badgeAtlasUrl, texture => {
    atlasReady = true
    onTextureReady?.(texture)
  })
  atlas.colorSpace = THREE.SRGBColorSpace
  const symbols = createStaffStatusTexture()
  const badgePlane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
  const styles = dynamicAttribute(new Uint8Array(capacity * 4), 4)
  badgePlane.setAttribute('badgeStyle', styles)
  const badges = batch(badgePlane, createBadgeMaterial(atlas, symbols), 'staff-portraits')
  badges.renderOrder = 8

  const uniformMaterial = createStaffAvatarMaterial()
  function makeFigure(gender) {
    const geometry = createStaffAvatarGeometry(gender)
    const stride = dynamicAttribute(new Float32Array(capacity), 1)
    const fade = dynamicAttribute(new Uint8Array(capacity * 2), 2, true)
    geometry.setAttribute('aStridePhase', stride)
    geometry.setAttribute('aStaffFade', fade)
    return { mesh: batch(geometry, uniformMaterial, `staff-figures-${gender}`), stride, fade }
  }
  const male = makeFigure('male'), female = makeFigure('female')
  const bodies = [male, female]
  female.mesh.userData.sharedMat = true
  const footprintGeometry = createFootprint()
  const footAlpha = dynamicAttribute(new Uint8Array(capacity), 1, true)
  footprintGeometry.setAttribute('footAlpha', footAlpha)
  const feet = batch(footprintGeometry, createFootMaterial(), 'staff-footprints')
  feet.renderOrder = 7

  // 跟拍只有一个人。两片三角面给鞋底做接触阴影，沿用整城的静态阴影贴图。
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 } },
    vertexShader: `
      varying vec2 groundUv;
      void main() {
        groundUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float opacity;
      varying vec2 groundUv;
      void main() {
        float soft = 1.0 - smoothstep(0.02, 1.0, length(groundUv));
        vec2 boots = vec2(abs(groundUv.x) - 0.16, groundUv.y);
        float sole = 1.0 - smoothstep(0.0, 1.0, length(boots * vec2(9.0, 5.0)));
        gl_FragColor = vec4(0.035, 0.047, 0.054, opacity * (0.29 * soft * soft + 0.26 * sole));
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1
  }))
  contact.visible = false
  group.add(contact)

  const lineGeometry = new THREE.BufferGeometry()
  const linePosition = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage)
  lineGeometry.setAttribute('position', linePosition)
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
    color: 0x506761, transparent: true, opacity: 0.50, depthTest: false, depthWrite: false, toneMapped: false
  }))
  lines.name = 'staff-leaders'
  lines.frustumCulled = false
  lines.renderOrder = 6
  group.add(lines)

  const locations = Array.from({ length: capacity }, () => ({ visible: false, close: false, dx: 0, dy: 0 }))
  const ordered = []
  const layout = createStaffScreenLayout(capacity)
  const transform = new THREE.Object3D()
  const view = new THREE.Vector3(), head = new THREE.Vector3(), color = new THREE.Color()
  let camera, width, height, focalPixels, reducedMotion, statusFocus
  let overview, street, layoutWeight, layoutStep, obstacles, lineCount
  let cameraSettleSeconds = 0

  function begin(activeCamera, w, h, night, reduceMotion, options = {}) {
    camera = activeCamera
    width = w
    height = h
    camera.updateMatrixWorld()
    focalPixels = camera.projectionMatrix.elements[5] * h / 2
    reducedMotion = reduceMotion
    if (atlasReady) {
      portraitAvailability = reduceMotion || !(options.dt > 0) ? 1 : Math.min(1, portraitAvailability + options.dt / 0.16)
    }
    const fallbackDistance = Math.abs(camera.position.y - STAFF_GROUND_Y) / Math.max(0.1, camera.matrixWorld.elements[9])
    const distance = Number.isFinite(options.viewDistance) ? options.viewDistance : fallbackDistance
    overview = staffOverviewWeight(distance)
    street = 1 - smoothstep(distance, 125, 210)
    layoutWeight = overview + (1 - overview) * 0.30 * smoothstep(distance, 210, 285)
    const frameSeconds = Math.min(0.05, Math.max(0, options.dt || 0))
    const blocks = options.obstacles || EMPTY
    const firstLabels = blocks.length > 0 && !obstacles?.length
    cameraSettleSeconds = options.cameraMoving || firstLabels ? 0.8 : Math.max(0, cameraSettleSeconds - frameSeconds)
    // 入场或运镜时完成排位。镜头停稳后，人员只随实点移动，拥挤处的微调严格限速。
    layoutStep = reduceMotion ? Infinity : frameSeconds * (cameraSettleSeconds > 0 ? 110 : 0.3)
    statusFocus = options.statusFocus || 'all'
    obstacles = blocks
    uniformMaterial.userData.uLift.value = night ? 0.80 : 0.12
    lines.material.color.setHex(night ? 0xc5e0d5 : 0x506761)
    lineCount = 0
    contact.visible = false
    ordered.length = 0
    for (const mesh of group.children) if (mesh.isInstancedMesh) mesh.count = 0
    for (const loc of locations) {
      loc.wasVisible = loc.visible
      loc.visible = false
    }
  }

  function place(st, selected, following, tone, opacity = 1) {
    const loc = locations[st.idx]
    view.set(st.x, STAFF_GROUND_Y, st.z).applyMatrix4(camera.matrixWorldInverse)
    const depth = -view.z
    if (depth < camera.near || depth > camera.far || !focalPixels) return false
    const px = width / 2 + focalPixels * view.x / depth
    const py = height / 2 - focalPixels * view.y / depth
    if (px < -44 || px > width + 44 || py < -44 || py > height + 85) return false
    loc.visible = true
    loc.person = st
    loc.selected = selected
    loc.following = following
    loc.opacity = opacity
    loc.tone = tone
    loc.depth = depth
    loc.anchorX = px
    loc.anchorY = py
    // UV 自底向上：未登记、女、男。
    loc.row = st.gender === 'female' ? 1 : st.gender === 'male' ? 2 : 0
    loc.column = st.status === '滞留提醒' ? 2 : st.status === '在办处置' ? 1 : 0
    loc.emphasis = statusFocus === 'all' || st.status === statusFocus ? 1 : selected ? 0.60 : 0.40
    loc.priority = (selected || following ? 8 : 0) + (loc.emphasis === 1 ? 4 : 0) + loc.column
    ordered.push(loc)
    return true
  }

  function draw(loc) {
    const st = loc.person
    const worldPerPixel = loc.depth / focalPixels
    const upright = Math.max(0.32, camera.matrixWorldInverse.elements[5])
    const apparent = STAFF_MAP_HEIGHT * upright / worldPerPixel
    const targetPixels = loc.following ? 58 : loc.selected ? 52 : clamp(apparent, 28, 40)
    const modelHeight = clamp(targetPixels * worldPerPixel / upright, 0.85, loc.following ? 4.2 : 5.2)
    const closeup = loc.selected ? 1 - smoothstep(loc.depth, 0.95, 2.4) : 0
    loc.figureTop = loc.anchorY
    loc.figureHeadX = loc.anchorX
    const detail = street * (loc.following ? 1 : smoothstep(apparent, 8, 17))
    const hasFigure = loc.row !== 0 || loc.following
    const figure = hasFigure ? detail : 0
    const portrait = loc.selected ? 26 : loc.column === 2 ? 24 : 22
    // 图标和立体人物在同一地面坐标交接，人物按沙盘标记的屏幕尺寸显示。
    const projectedBody = modelHeight * upright / worldPerPixel
    const nearBadge = hasFigure ? clamp(projectedBody, portrait, 46) : loc.selected ? 36 : 28
    const size = lerp(lerp(portrait, nearBadge, detail), STATUS_SIZE[loc.column], overview)
    layout.place(loc, size, layoutWeight, layoutStep)
    loc.close = figure >= 0.5
    loc.figureWeight = figure
    loc.badgeSize = size
    loc.figureHalfWidth = 0
    loc.footRadius = 0

    if (figure > 0.002) {
      head.set(st.x, STAFF_GROUND_Y + modelHeight, st.z).project(camera)
      loc.figureTop = height * (1 - head.y) / 2
      loc.figureHeadX = width * (1 + head.x) / 2
      transform.position.set(st.x, STAFF_GROUND_Y, st.z)
      transform.rotation.set(0, st.heading, 0)
      transform.scale.setScalar(modelHeight)
      transform.updateMatrix()
      const body = st.gender === 'female' ? female : male
      const slot = body.mesh.count++
      body.mesh.setMatrixAt(slot, transform.matrix)
      const walking = !reducedMotion && st.speedKmh > 0
      // 一次左右脚循环约走 1.3 米。整数圈保证跨过巡防线路首尾时步相连续。
      const cycles = Math.max(1, Math.round(st._total * WORLD_DIV / 1.3))
      body.stride.setX(slot, walking && st._total > 0 ? (TAU * cycles * st._dist / st._total) % TAU : -1)
      body.fade.setXY(slot, 1 - figure * loc.opacity, 1 - loc.emphasis)
      if (closeup > 0.002) {
        contact.visible = true
        contact.position.set(st.x, STAFF_GROUND_Y * 0.8, st.z)
        contact.rotation.y = st.heading
        contact.scale.set(modelHeight * 0.65, 1, modelHeight * 0.87)
        contact.material.uniforms.opacity.value = closeup * figure * loc.opacity
      }
      if (closeup < 0.998) {
        const footprint = modelHeight * (loc.selected ? 0.60 : 0.52)
        transform.scale.setScalar(footprint)
        transform.updateMatrix()
        feet.setMatrixAt(feet.count, transform.matrix)
        feet.setColorAt(feet.count, color.set(loc.tone))
        footAlpha.setX(feet.count++, 0.88 * figure * loc.emphasis * loc.opacity * (1 - closeup))
        loc.footRadius = footprint / worldPerPixel * 0.73
      }
      loc.figureHalfWidth = Math.max(7, modelHeight / worldPerPixel * 0.27)
    }

    if (figure < 0.998) {
      const dx = loc.x - loc.anchorX, dy = loc.y - loc.anchorY
      const axes = camera.matrixWorld.elements
      transform.position.set(
        st.x + (axes[0] * dx - axes[4] * dy) * worldPerPixel,
        STAFF_GROUND_Y + (axes[1] * dx - axes[5] * dy) * worldPerPixel,
        st.z + (axes[2] * dx - axes[6] * dy) * worldPerPixel
      )
      if (loc.opacity > 0.7 && dx * dx + dy * dy > 16) {
        linePosition.setXYZ(lineCount * 2, st.x, STAFF_GROUND_Y, st.z)
        linePosition.setXYZ(lineCount * 2 + 1, transform.position.x, transform.position.y, transform.position.z)
        lineCount++
      }
      transform.quaternion.copy(camera.quaternion)
      transform.scale.setScalar(size * worldPerPixel)
      transform.updateMatrix()
      // 全员都是公告板时，先安放的高优先级人员最后绘制，密集处仍可辨认。
      const index = badges.count++
      const slot = street === 0 && layoutWeight > 0.005 ? ordered.length - 1 - index : index
      badges.setMatrixAt(slot, transform.matrix)
      const symbolMix = 1 - (1 - overview) * portraitAvailability
      styles.setXYZW(slot, loc.column, loc.row, Math.round(255 * symbolMix), Math.round(255 * (1 - figure) * loc.emphasis * loc.opacity))
    }
    loc.top = lerp(loc.y - size, loc.figureTop, figure)
    loc.headX = lerp(loc.x, loc.figureHeadX, figure)
    loc.halfWidth = lerp(size / 2, loc.figureHalfWidth, figure)
  }

  function finish() {
    // 先给选中者、匹配筛选者和滞留点保留原位，其他点再避让。
    if (layoutWeight > 0.005) ordered.sort((a, b) => b.priority - a.priority || a.person.idx - b.person.idx)
    layout.prepare(ordered, width, height, obstacles, layoutWeight)
    for (const loc of ordered) draw(loc)
    lines.visible = lineCount > 0
    lineGeometry.setDrawRange(0, lineCount * 2)
    if (lineCount) linePosition.needsUpdate = true
    for (const mesh of group.children) {
      if (!mesh.isInstancedMesh) continue
      mesh.visible = mesh.count > 0
      if (mesh.visible) mesh.instanceMatrix.needsUpdate = true
    }
    if (badges.count) styles.needsUpdate = true
    for (const body of bodies) if (body.mesh.count) {
      body.stride.needsUpdate = true
      body.fade.needsUpdate = true
    }
    if (feet.count) {
      feet.instanceColor.needsUpdate = true
      footAlpha.needsUpdate = true
    }
  }

  function pick(x, y) {
    let hit = null, best = Infinity
    for (const loc of locations) {
      if (!loc.visible || loc.opacity < 0.35) continue
      let score = Infinity
      if (loc.figureWeight < 0.92) {
        const half = loc.badgeSize / 2 + 2
        const dx = Math.abs(x - loc.x) / half
        const dy = Math.abs(y - (loc.y - loc.badgeSize / 2)) / half
        if (dx <= 1 && dy <= 1) score = Math.max(dx, dy)
      }
      if (loc.figureWeight > 0.08 && y >= loc.figureTop - 3 && y <= loc.anchorY + Math.max(3, loc.footRadius * 0.75)) {
        const t = clamp((loc.anchorY - y) / Math.max(1, loc.anchorY - loc.figureTop), 0, 1)
        const dx = Math.abs(x - lerp(loc.anchorX, loc.figureHeadX, t))
        const half = (t < 0.15 ? Math.max(loc.figureHalfWidth, loc.footRadius) : loc.figureHalfWidth) + 3
        if (dx <= half) score = Math.min(score, dx / half + Math.abs(t - 0.5) * 0.36)
      }
      score += loc.depth * 0.0001 - (loc.selected ? 0.12 : 0) + (1 - loc.emphasis) * 0.16
      if (score < best) { best = score; hit = loc.person }
    }
    return hit
  }

  let texturesReleased = false
  function disposeTexture() {
    if (texturesReleased) return
    texturesReleased = true
    atlas.dispose()
    symbols.dispose()
  }
  function dispose() {
    disposeTexture()
    for (const mesh of group.children) {
      if (mesh.isInstancedMesh) mesh.dispose()
      mesh.geometry.dispose()
      if (!mesh.userData.sharedMat) mesh.material.dispose()
    }
    group.removeFromParent()
    group.clear()
  }
  return { group, begin, place, finish, pick, locations, disposeTexture, dispose }
}
