import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  TYPE_CONFIG,
  validatePlacement,
  findNearestValidPosition,
  isManual,
  typeZone
} from '../layout/engine.js'

const HIGHLIGHT_COLOR = 0x0ea5e9
const VALID_COLOR = 0x22c55e
const INVALID_COLOR = 0xef4444

export class SceneManager {
  constructor(container, callbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.objects = []
    this.params = null
    this.selectedId = null
    this.meshes = new Map()
    this.siteSignature = ''
    this.drag = null
    this.spring = null
    this.pointer = new THREE.Vector2()
    this.raycaster = new THREE.Raycaster()
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.clock = new THREE.Clock()

    this.initRenderer()
    this.initScene()
    this.initLights()
    this.initControls()
    this.initGroups()
    this.bindEvents()
    this.initObserver()
    this.animate()
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'three-canvas'
    this.renderer.domElement.setAttribute('aria-label', '应急演练场地三维布置画布')
    this.container.appendChild(this.renderer.domElement)
  }

  initScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xe9eff6)
    this.scene.fog = new THREE.Fog(0xe9eff6, 180, 420)

    const width = this.container.clientWidth || 800
    const height = this.container.clientHeight || 600
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    this.camera.position.set(48, 58, 64)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: 0xdde5ee, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.08
    ground.receiveShadow = true
    this.scene.add(ground)
  }

  initLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8aa0b8, 1.8)
    this.scene.add(hemi)

    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    this.scene.add(ambient)

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2)
    this.sun.position.set(-45, 80, 35)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -90
    this.sun.shadow.camera.right = 90
    this.sun.shadow.camera.top = 90
    this.sun.shadow.camera.bottom = -90
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 220
    this.sun.shadow.bias = -0.00025
    this.scene.add(this.sun)
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI / 2.12
    this.controls.minDistance = 12
    this.controls.maxDistance = 260
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  initGroups() {
    this.siteGroup = new THREE.Group()
    this.zoneGroup = new THREE.Group()
    this.objectGroup = new THREE.Group()
    this.scene.add(this.siteGroup, this.zoneGroup, this.objectGroup)
  }

  bindEvents() {
    this.onPointerDown = this.handlePointerDown.bind(this)
    this.onPointerMove = this.handlePointerMove.bind(this)
    this.onPointerUp = this.handlePointerUp.bind(this)
    this.onPointerCancel = this.handlePointerCancel.bind(this)
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerCancel)
  }

  initObserver() {
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
  }

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  sync(objects, params) {
    this.objects = objects || []
    this.params = params
    if (!params) return
    const signature = JSON.stringify(params)
    if (signature !== this.siteSignature) {
      this.siteSignature = signature
      this.buildSite(params)
      this.fitCamera(params)
    }
    this.syncMeshes()
    this.updateZones()
    this.setSelected(this.selectedId, true)
  }

  // ---------- 场地 ----------

  disposeGroup(group) {
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((m) => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      }
    })
    group.clear()
  }

  buildSite(p) {
    this.disposeGroup(this.siteGroup)

    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(p.length, p.width),
      new THREE.MeshStandardMaterial({ color: 0xf2ecdd, roughness: 0.96 })
    )
    slab.rotation.x = -Math.PI / 2
    slab.receiveShadow = true
    this.siteGroup.add(slab)

    this.addGrid(p)
    this.addBoundary(p)
    this.addPassage(p)
    this.updateShadowCamera(p)
  }

  addGrid(p) {
    const step = 5
    const minor = []
    const major = []
    const x0 = -p.length / 2
    const x1 = p.length / 2
    const z0 = -p.width / 2
    const z1 = p.width / 2

    for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-6; x += step) {
      const arr = Math.round(x / step) % 2 === 0 ? major : minor
      arr.push(x, 0.018, z0, x, 0.018, z1)
    }
    for (let z = Math.ceil(z0 / step) * step; z <= z1 + 1e-6; z += step) {
      const arr = Math.round(z / step) % 2 === 0 ? major : minor
      arr.push(x0, 0.018, z, x1, 0.018, z)
    }

    const minorGeo = new THREE.BufferGeometry()
    minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minor, 3))
    const minorLines = new THREE.LineSegments(
      minorGeo,
      new THREE.LineBasicMaterial({ color: 0xd6d3c7, transparent: true, opacity: 0.72 })
    )
    this.siteGroup.add(minorLines)

    const majorGeo = new THREE.BufferGeometry()
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(major, 3))
    const majorLines = new THREE.LineSegments(
      majorGeo,
      new THREE.LineBasicMaterial({ color: 0xbdb7a6, transparent: true, opacity: 0.8 })
    )
    this.siteGroup.add(majorLines)
  }

  addBoundary(p) {
    const points = [
      new THREE.Vector3(-p.length / 2, 0.08, -p.width / 2),
      new THREE.Vector3(p.length / 2, 0.08, -p.width / 2),
      new THREE.Vector3(p.length / 2, 0.08, p.width / 2),
      new THREE.Vector3(-p.length / 2, 0.08, p.width / 2)
    ]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x334155, linewidth: 2 }))
    this.siteGroup.add(line)

    const cornerGeo = new THREE.SphereGeometry(0.35, 16, 8)
    const cornerMat = new THREE.MeshStandardMaterial({ color: 0x334155 })
    points.forEach((pt) => {
      const s = new THREE.Mesh(cornerGeo, cornerMat)
      s.position.copy(pt)
      s.position.y = 0.2
      s.castShadow = true
      this.siteGroup.add(s)
    })
  }

  addPassage(p) {
    const alongLength = p.orientation === 'length'
    const geo = alongLength
      ? new THREE.PlaneGeometry(p.length, p.passageWidth)
      : new THREE.PlaneGeometry(p.passageWidth, p.width)
    const passage = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.42,
        roughness: 0.9,
        depthWrite: false
      })
    )
    passage.rotation.x = -Math.PI / 2
    passage.position.y = 0.035
    passage.receiveShadow = true
    this.siteGroup.add(passage)

    const edgePoints = []
    const hw = p.passageWidth / 2
    if (alongLength) {
      edgePoints.push(
        -p.length / 2, 0.09, -hw, p.length / 2, 0.09, -hw,
        -p.length / 2, 0.09, hw, p.length / 2, 0.09, hw
      )
    } else {
      edgePoints.push(
        -hw, 0.09, -p.width / 2, -hw, 0.09, p.width / 2,
        hw, 0.09, -p.width / 2, hw, 0.09, p.width / 2
      )
    }
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePoints, 3))
    this.siteGroup.add(new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9 })
    ))

    const centerPoints = []
    const dash = 3
    if (alongLength) {
      for (let x = -p.length / 2 + 2; x < p.length / 2 - 2; x += dash * 2) {
        centerPoints.push(x, 0.1, 0, Math.min(x + dash, p.length / 2 - 2), 0.1, 0)
      }
    } else {
      for (let z = -p.width / 2 + 2; z < p.width / 2 - 2; z += dash * 2) {
        centerPoints.push(0, 0.1, z, 0, 0.1, Math.min(z + dash, p.width / 2 - 2))
      }
    }
    const centerGeo = new THREE.BufferGeometry()
    centerGeo.setAttribute('position', new THREE.Float32BufferAttribute(centerPoints, 3))
    const centerLine = new THREE.LineSegments(
      centerGeo,
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1.4, gapSize: 1.1, transparent: true, opacity: 0.95 })
    )
    centerLine.computeLineDistances()
    this.siteGroup.add(centerLine)

    const label = this.makeTextSprite(`主通道 · 宽 ${p.passageWidth.toFixed(1)} m`, {
      worldHeight: 1.55,
      background: 'rgba(15, 23, 42, 0.78)',
      color: '#ffffff'
    })
    label.position.set(0, 1.1, 0)
    this.siteGroup.add(label)
  }

  updateShadowCamera(p) {
    const radius = Math.max(p.length, p.width) * 0.72
    this.sun.position.set(-p.length * 0.55, Math.max(55, p.length * 1.1), p.width * 0.8)
    this.sun.shadow.camera.left = -radius
    this.sun.shadow.camera.right = radius
    this.sun.shadow.camera.top = radius
    this.sun.shadow.camera.bottom = -radius
    this.sun.shadow.camera.far = radius * 4
    this.sun.shadow.camera.updateProjectionMatrix()
  }

  fitCamera(p = this.params) {
    if (!p) return
    const radius = Math.hypot(p.length, p.width) / 2
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    let distance = radius / Math.sin(fov / 2)
    if (this.camera.aspect < 1.2) distance /= Math.max(0.55, this.camera.aspect)
    distance *= 1.18
    const direction = new THREE.Vector3(0.48, 0.82, 0.68).normalize()
    this.camera.position.copy(direction.multiplyScalar(distance))
    this.controls.target.set(0, 0, 0)
    this.controls.maxDistance = distance * 3
    this.controls.update()
  }

  // ---------- 物件模型 ----------

  syncMeshes() {
    const alive = new Set()
    for (const obj of this.objects) {
      alive.add(obj.id)
      let group = this.meshes.get(obj.id)
      if (!group) {
        group = this.createObjectMesh(obj)
        this.meshes.set(obj.id, group)
        this.objectGroup.add(group)
      }
      group.position.set(obj.x, 0, obj.z)
      group.rotation.y = THREE.MathUtils.degToRad(obj.rotation || 0)
      group.scale.setScalar(obj.scale || 1)
      const marker = group.userData.marker
      if (marker) marker.visible = isManual(obj)
      const highlight = group.userData.highlight
      if (highlight) {
        highlight.visible = obj.id === this.selectedId
        ;(highlight.material).color.setHex(HIGHLIGHT_COLOR)
      }
    }
    for (const [id, group] of this.meshes) {
      if (!alive.has(id)) {
        this.objectGroup.remove(group)
        this.disposeGroup(group)
        this.meshes.delete(id)
      }
    }
  }

  createObjectMesh(obj) {
    const group = new THREE.Group()
    group.userData.objectId = obj.id
    const cfg = TYPE_CONFIG[obj.type]

    if (obj.type === 'tent') this.buildTent(group)
    if (obj.type === 'assembly') this.buildAssembly(group)
    if (obj.type === 'supply') this.buildSupply(group)
    if (obj.type === 'stake') this.buildStake(group)

    const highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(cfg.size.w + 0.35, 0.16, cfg.size.d + 0.35)),
      new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR, transparent: true, opacity: 0.95 })
    )
    highlight.position.y = 0.12
    highlight.visible = false
    group.userData.highlight = highlight
    group.add(highlight)

    const marker = this.makeMarkerSprite()
    marker.position.set(cfg.size.w * 0.55 + 0.45, 2.65, -cfg.size.d * 0.45)
    marker.visible = false
    group.userData.marker = marker
    group.add(marker)

    group.traverse((child) => {
      child.userData.objectId = obj.id
      if (child.isMesh && !child.userData.noShadow) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return group
  }

  addHitMesh(group, w, h, d, y) {
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    hit.position.y = y
    hit.userData.noShadow = true
    hit.userData.isHit = true
    group.add(hit)
  }

  buildTent(group) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(3.7, 0.12, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.85 })
    )
    base.position.y = 0.08
    group.add(base)

    const roof = new THREE.Mesh(
      this.createPrismGeometry(3.55, 2.35, 1.65),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.72, side: THREE.DoubleSide })
    )
    roof.position.y = 0.12
    group.add(roof)

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.9, 0.75),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 })
    )
    door.position.set(1.81, 0.58, 0)
    group.add(door)
    this.addHitMesh(group, 4.2, 2.2, 3.0, 1.1)
  }

  createPrismGeometry(length, width, height) {
    const l = length / 2
    const w = width / 2
    const vertices = new Float32Array([
      -l, 0, -w,  l, 0, -w,  l, height, 0,  -l, height, 0,
      -l, 0,  w,  l, 0,  w
    ])
    const indices = [
      0, 1, 2, 0, 2, 3,
      4, 5, 2, 4, 2, 3,
      1, 5, 2,
      0, 3, 4,
      0, 4, 5, 0, 5, 1
    ]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }

  buildAssembly(group) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.35, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.82 })
    )
    pad.position.y = 0.07
    group.add(pad)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.06, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.18
    group.add(ring)

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    )
    pole.position.y = 1.35
    group.add(pole)

    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.62, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x16a34a })
    )
    flag.position.set(0.55, 2.25, 0)
    group.add(flag)
    this.addHitMesh(group, 5.0, 2.8, 5.0, 1.4)
  }

  buildSupply(group) {
    const pallet = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 0.2, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.9 })
    )
    pallet.position.y = 0.12
    group.add(pallet)

    const boxMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.86 })
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.78 })
    const positions = [
      [-1.15, 0.55, -0.65, 1.25, 0.75, 1.05, boxMat],
      [0.25, 0.52, -0.65, 1.25, 0.7, 1.05, boxMat],
      [1.25, 0.48, 0.62, 0.9, 0.62, 1.0, blueMat],
      [-0.65, 1.18, -0.65, 1.15, 0.55, 1.0, blueMat],
      [0.65, 1.12, -0.65, 1.05, 0.45, 0.95, boxMat],
      [-0.6, 0.5, 0.68, 1.5, 0.65, 0.9, blueMat]
    ]
    positions.forEach(([x, y, z, w, h, d, mat]) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      box.position.set(x, y, z)
      group.add(box)
    })

    const tarp = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 0.16, 2.35),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.92 })
    )
    tarp.position.y = 1.55
    group.add(tarp)
    this.addHitMesh(group, 4.4, 2.2, 3.3, 1.1)
  }

  buildStake(group) {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.4, 0.14, 20),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.75 })
    )
    base.position.y = 0.07
    group.add(base)

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 1.15, 14),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.55 })
    )
    post.position.y = 0.68
    group.add(post)

    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.073, 0.073, 0.18, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    )
    stripe.position.y = 0.78
    group.add(stripe)

    const top = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x7c2d12, emissiveIntensity: 0.25 })
    )
    top.position.y = 1.36
    group.add(top)

    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 1.9, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    hit.position.y = 0.95
    hit.userData.noShadow = true
    group.add(hit)
  }

  makeMarkerSprite() {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, 128, 128)
    ctx.beginPath()
    ctx.arc(64, 64, 52, 0, Math.PI * 2)
    ctx.fillStyle = '#f59e0b'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = '900 58px "Microsoft YaHei", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('调', 64, 68)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }))
    sprite.scale.set(1.18, 1.18, 1.18)
    sprite.renderOrder = 20
    return sprite
  }

  makeTextSprite(text, options = {}) {
    const fontSize = options.fontSize || 44
    const paddingX = 24
    const paddingY = 14
    const canvas = document.createElement('canvas')
    const measure = canvas.getContext('2d')
    measure.font = `700 ${fontSize}px "Microsoft YaHei", system-ui, sans-serif`
    const width = Math.ceil(measure.measureText(text).width + paddingX * 2)
    const height = fontSize + paddingY * 2
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.font = `700 ${fontSize}px "Microsoft YaHei", system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    if (options.background) {
      ctx.fillStyle = options.background
      this.roundRect(ctx, 0, 0, width, height, 18)
      ctx.fill()
    }
    ctx.fillStyle = options.color || '#0f172a'
    ctx.textAlign = 'center'
    ctx.fillText(text, width / 2, height / 2 + 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
    const worldHeight = options.worldHeight || 1.2
    sprite.scale.set(worldHeight * (width / height), worldHeight, 1)
    return sprite
  }

  roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, r)
      return
    }
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  // ---------- 分区 ----------

  updateZones() {
    this.disposeGroup(this.zoneGroup)
    if (!this.params) return
    for (const type of ['tent', 'supply', 'assembly', 'stake']) {
      const zone = typeZone(this.objects, type, 1.5)
      if (!zone) continue
      const cfg = TYPE_CONFIG[type]
      const w = zone.maxX - zone.minX
      const d = zone.maxZ - zone.minZ
      const cx = (zone.minX + zone.maxX) / 2
      const cz = (zone.minZ + zone.maxZ) / 2

      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.color), transparent: true, opacity: 0.075, depthWrite: false })
      )
      fill.rotation.x = -Math.PI / 2
      fill.position.set(cx, 0.022, cz)
      this.zoneGroup.add(fill)

      const pts = [
        new THREE.Vector3(zone.minX, 0.07, zone.minZ),
        new THREE.Vector3(zone.maxX, 0.07, zone.minZ),
        new THREE.Vector3(zone.maxX, 0.07, zone.maxZ),
        new THREE.Vector3(zone.minX, 0.07, zone.maxZ)
      ]
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color(cfg.color), transparent: true, opacity: 0.55 })
      )
      this.zoneGroup.add(line)

      const label = this.makeTextSprite(cfg.zone || `${cfg.label}区`, {
        worldHeight: 1.05,
        fontSize: 40,
        background: 'rgba(255,255,255,.82)',
        color: cfg.color
      })
      label.position.set(cx, 0.75, zone.minZ + 0.2)
      this.zoneGroup.add(label)
    }
  }

  // ---------- 选择与拖拽 ----------

  setSelected(id, silent = false) {
    this.selectedId = id
    for (const [objectId, group] of this.meshes) {
      const h = group.userData.highlight
      if (h) {
        h.visible = objectId === id
        h.material.color.setHex(HIGHLIGHT_COLOR)
        h.material.opacity = 0.95
      }
    }
    if (!silent && id) {
      const obj = this.objects.find((o) => o.id === id)
      if (obj) {
        // 列表点击时给一个短暂放大反馈；不改变用户尺寸。
        const group = this.meshes.get(id)
        if (group) this.pulseGroup(group)
      }
    }
  }

  pulseGroup(group) {
    group.userData.pulse = 0.45
  }

  updateRay(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  pickObjectId(event) {
    this.updateRay(event)
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], true)
    for (const hit of hits) {
      let node = hit.object
      while (node && !node.userData.objectId) node = node.parent
      if (node?.userData?.objectId) return node.userData.objectId
    }
    return null
  }

  handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    const id = this.pickObjectId(event)
    if (!id) return
    event.preventDefault()
    event.stopPropagation()
    this.spring = null
    this.callbacks.onSelect?.(id)

    const obj = this.objects.find((o) => o.id === id)
    if (!obj) return
    const point = new THREE.Vector3()
    this.raycaster.ray.intersectPlane(this.groundPlane, point)
    this.controls.enabled = false
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId)
    } catch {}
    this.renderer.domElement.style.cursor = 'grabbing'
    this.drag = {
      id,
      pointerId: event.pointerId,
      offsetX: obj.x - point.x,
      offsetZ: obj.z - point.z,
      startX: obj.x,
      startZ: obj.z,
      moved: false,
      valid: true
    }
  }

  handlePointerMove(event) {
    if (this.drag) {
      if (event.pointerId !== this.drag.pointerId) return
      event.preventDefault()
      this.updateRay(event)
      const point = new THREE.Vector3()
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return
      const x = point.x + this.drag.offsetX
      const z = point.z + this.drag.offsetZ
      const mesh = this.meshes.get(this.drag.id)
      if (mesh) mesh.position.set(x, 0, z)
      if (Math.hypot(x - this.drag.startX, z - this.drag.startZ) > 0.35) this.drag.moved = true

      const obj = this.objects.find((o) => o.id === this.drag.id)
      if (obj) {
        const candidate = { ...obj, x, z }
        const result = validatePlacement(candidate, this.objects, this.params)
        this.drag.valid = result.valid
        this.setFeedback(this.drag.id, result.valid)
        this.callbacks.onDragHint?.({ x, z, ...result })
      }
      return
    }

    if (event.pointerType === 'mouse') {
      const id = this.pickObjectId(event)
      this.renderer.domElement.style.cursor = id ? 'grab' : 'default'
    }
  }

  setFeedback(id, valid) {
    const group = this.meshes.get(id)
    const h = group?.userData.highlight
    if (!h) return
    h.visible = true
    h.material.color.setHex(valid ? VALID_COLOR : INVALID_COLOR)
    h.material.opacity = 1
  }

  handlePointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    event.preventDefault()
    const drag = this.drag
    const obj = this.objects.find((o) => o.id === drag.id)
    const mesh = this.meshes.get(drag.id)
    this.controls.enabled = true
    this.renderer.domElement.style.cursor = 'grab'
    try {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
    } catch {}

    if (!drag.moved || !obj || !mesh) {
      this.drag = null
      this.setSelected(this.selectedId)
      this.callbacks.onDragHint?.(null)
      return
    }

    const x = mesh.position.x
    const z = mesh.position.z
    const result = validatePlacement({ ...obj, x, z }, this.objects, this.params)
    this.drag = null
    this.callbacks.onDragHint?.(null)

    if (result.valid) {
      this.setSelected(drag.id)
      this.callbacks.onCommit?.(drag.id, { x, z })
      return
    }

    const nearest = findNearestValidPosition({ ...obj, x, z }, this.objects, this.params)
    const target = nearest || { x: drag.startX, z: drag.startZ }
    this.startSpring(drag.id, target, () => {
      this.setSelected(drag.id)
      this.callbacks.onCommit?.(drag.id, { x: target.x, z: target.z, bounced: !nearest })
    })
  }

  handlePointerCancel(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const drag = this.drag
    const obj = this.objects.find((o) => o.id === drag.id)
    this.controls.enabled = true
    try {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
    } catch {}
    this.drag = null
    this.callbacks.onDragHint?.(null)
    if (obj) {
      this.startSpring(drag.id, { x: drag.startX, z: drag.startZ }, null)
    }
  }

  startSpring(id, target, onDone) {
    const mesh = this.meshes.get(id)
    if (!mesh) {
      onDone?.()
      return
    }
    this.spring = {
      id,
      fromX: mesh.position.x,
      fromZ: mesh.position.z,
      toX: target.x,
      toZ: target.z,
      elapsed: 0,
      duration: 0.48,
      onDone
    }
  }

  // ---------- 渲染循环 ----------

  animate() {
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05)
      const elapsed = this.clock.elapsedTime
      this.controls.update()
      this.updateSpring(dt)
      this.updateAnimations(elapsed, dt)
      this.renderer.render(this.scene, this.camera)
    })
  }

  updateSpring(dt) {
    if (!this.spring) return
    const s = this.spring
    s.elapsed += dt
    const t = Math.min(1, s.elapsed / s.duration)
    // easeOutBack：末端有轻微回弹，符合“弹回空位”的反馈。
    const c1 = 1.55
    const c3 = c1 + 1
    const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    const mesh = this.meshes.get(s.id)
    if (mesh) {
      mesh.position.x = THREE.MathUtils.lerp(s.fromX, s.toX, eased)
      mesh.position.z = THREE.MathUtils.lerp(s.fromZ, s.toZ, eased)
    }
    if (t >= 1) {
      this.spring = null
      if (mesh) mesh.position.set(s.toX, 0, s.toZ)
      s.onDone?.()
    }
  }

  updateAnimations(elapsed, dt) {
    for (const [id, group] of this.meshes) {
      const marker = group.userData.marker
      if (marker?.visible) {
        marker.position.y = 2.7 + Math.sin(elapsed * 3 + id.length) * 0.12
        marker.material.rotation = Math.sin(elapsed * 1.4) * 0.08
      }
      const h = group.userData.highlight
      if (h?.visible && id === this.selectedId && !this.drag) {
        h.material.opacity = 0.55 + (Math.sin(elapsed * 5.2) + 1) * 0.22
      }
      if (group.userData.pulse !== undefined) {
        group.userData.pulse -= dt
        const t = Math.max(0, group.userData.pulse / 0.45)
        const base = this.objects.find((o) => o.id === id)?.scale || 1
        group.scale.setScalar(base * (1 + Math.sin(t * Math.PI) * 0.12))
        if (group.userData.pulse <= 0) {
          delete group.userData.pulse
          group.scale.setScalar(base)
        }
      }
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver?.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointercancel', this.onPointerCancel)
    this.controls.dispose()
    this.disposeGroup(this.scene)
    this.renderer.dispose()
    el.remove()
  }
}
