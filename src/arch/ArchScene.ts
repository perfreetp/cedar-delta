import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clampControlPoint, createArchCurve, curvatureAtArcU, nearestArcU } from './curve'
import { createSkeletonGeometries } from './skeletonParts'
import { getFlowerGeometry } from './flowerGeometry'
import type { DragMetrics, FlowerPlan, FlowerTypeId, Vec3Tuple } from '../types'

export interface ArchSceneCallbacks {
  onPointBegin?: (index: number) => void
  onPointChange?: (index: number, point: Vec3Tuple) => void
  onPointEnd?: () => void
  onSelectionChange?: (index: number | null) => void
  onMetrics?: (metrics: DragMetrics | null) => void
}

const HANDLE_COUNT = 6

function disposeObjectGeometries(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
  })
}

function createIndexSprite(index: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, 96, 96)
    context.beginPath()
    context.arc(48, 48, 34, 0, Math.PI * 2)
    context.fillStyle = 'rgba(84, 54, 32, 0.88)'
    context.fill()
    context.fillStyle = '#fff8ec'
    context.font = '700 42px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(index + 1), 48, 51)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.24, 0.24, 1)
  sprite.position.set(0, 0.22, 0)
  sprite.renderOrder = 20
  return sprite
}

export class ArchScene {
  private container: HTMLElement
  private callbacks: ArchSceneCallbacks
  private points: Vec3Tuple[]

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private resizeObserver: ResizeObserver

  private raycaster = new THREE.Raycaster()
  private pointerNdc = new THREE.Vector2()
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private intersection = new THREE.Vector3()

  private skeletonMaterial: THREE.MeshStandardMaterial
  private realtimeGroup = new THREE.Group()
  private mergedMesh: THREE.Mesh
  private flowerGroup = new THREE.Group()
  private flowerMaterial: THREE.MeshStandardMaterial
  private flowerMesh: THREE.InstancedMesh | null = null
  private lastFlowerPlan: FlowerPlan | null = null
  private lastFlowerType: FlowerTypeId | null = null

  private handleGroup = new THREE.Group()
  private hitMeshes: THREE.Mesh[] = []
  private coreHandles: THREE.Mesh[] = []
  private haloHandles: THREE.Mesh[] = []

  private draggingIndex: number | null = null
  private selectedIndex: number | null = null
  private hoverIndex: number | null = null
  private disposed = false

  constructor(container: HTMLElement, points: Vec3Tuple[], callbacks: ArchSceneCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.points = points.map((point) => [...point] as Vec3Tuple)

    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.domElement.className = 'arch-canvas'
    this.renderer.domElement.style.cursor = 'grab'
    this.renderer.domElement.setAttribute('aria-label', '婚礼花门三维编辑视口')
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100)
    this.camera.position.set(4.8, 3.35, 8.7)
    this.camera.lookAt(0, 2.25, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 2.25, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.minDistance = 4.2
    this.controls.maxDistance = 14
    this.controls.maxPolarAngle = Math.PI / 2 - 0.035
    this.controls.update()

    this.skeletonMaterial = new THREE.MeshStandardMaterial({
      color: '#bd8a48',
      metalness: 0.68,
      roughness: 0.27
    })
    this.flowerMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide
    })
    this.mergedMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.skeletonMaterial)
    this.mergedMesh.visible = false
    this.mergedMesh.castShadow = true
    this.mergedMesh.receiveShadow = true
    this.mergedMesh.frustumCulled = false

    this.setupLights()
    this.setupGround()
    this.setupHandles()

    this.scene.add(this.realtimeGroup, this.mergedMesh, this.flowerGroup, this.handleGroup)
    this.rebuildRealtimeSkeleton()
    this.updateHandlePositions()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    window.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('pointermove', this.onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)

    this.renderer.setAnimationLoop(() => {
      if (this.disposed) return
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    })
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xfff8ed, 0x9caf8f, 2.1)
    this.scene.add(hemisphere)

    const key = new THREE.DirectionalLight(0xffefd4, 3.4)
    key.position.set(4.5, 8.5, 5.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -6
    key.shadow.camera.right = 6
    key.shadow.camera.top = 7
    key.shadow.camera.bottom = -2
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 22
    key.shadow.bias = -0.00018
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xf6c7d4, 1.15)
    fill.position.set(-5, 4, 4)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0xdde8ff, 1.2)
    rim.position.set(0, 5, -6)
    this.scene.add(rim)
  }

  private setupGround(): void {
    const platform = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 72),
      new THREE.MeshStandardMaterial({ color: '#f0e4d2', roughness: 0.92, metalness: 0 })
    )
    platform.rotation.x = -Math.PI / 2
    platform.position.y = -0.018
    platform.receiveShadow = true
    this.scene.add(platform)

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.ShadowMaterial({ color: '#5b4636', opacity: 0.2 })
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.y = 0.002
    shadowPlane.receiveShadow = true
    this.scene.add(shadowPlane)

    const grid = new THREE.GridHelper(14, 28, '#c98772', '#ddcbb5')
    grid.position.y = 0.006
    const gridMaterial = grid.material as THREE.Material | THREE.Material[]
    if (Array.isArray(gridMaterial)) {
      gridMaterial.forEach((material) => {
        material.transparent = true
        material.opacity = 0.42
        material.depthWrite = false
      })
    } else {
      gridMaterial.transparent = true
      gridMaterial.opacity = 0.42
      gridMaterial.depthWrite = false
    }
    this.scene.add(grid)
  }

  private setupHandles(): void {
    const coreGeometry = new THREE.SphereGeometry(0.087, 24, 16)
    const haloGeometry = new THREE.SphereGeometry(0.145, 24, 16)
    const hitGeometry = new THREE.SphereGeometry(0.235, 12, 8)

    for (let i = 0; i < HANDLE_COUNT; i += 1) {
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: '#fff8e8',
        emissive: '#d99a3d',
        emissiveIntensity: 0.38,
        metalness: 0.35,
        roughness: 0.24,
        depthTest: false
      })
      const core = new THREE.Mesh(coreGeometry, coreMaterial)
      core.castShadow = true
      core.renderOrder = 12

      const halo = new THREE.Mesh(
        haloGeometry,
        new THREE.MeshBasicMaterial({
          color: '#e35d83',
          transparent: true,
          opacity: 0.2,
          depthTest: false,
          depthWrite: false
        })
      )
      halo.visible = false
      halo.renderOrder = 11

      const hit = new THREE.Mesh(
        hitGeometry,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      )
      hit.userData.index = i

      const label = createIndexSprite(i)
      const group = new THREE.Group()
      group.add(halo, core, hit, label)
      this.handleGroup.add(group)

      this.coreHandles.push(core)
      this.haloHandles.push(halo)
      this.hitMeshes.push(hit)
    }
  }

  setPoints(points: Vec3Tuple[]): void {
    this.points = points.map((point) => [...point] as Vec3Tuple)
    this.updateHandlePositions()
    this.rebuildRealtimeSkeleton()
  }

  setSelected(index: number | null): void {
    this.selectedIndex = index
    this.updateHandleVisuals()
  }

  projectControlPoint(index: number): { x: number; y: number } | null {
    const point = this.points[index]
    if (!point) return null
    const projected = new THREE.Vector3(...point).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height
    }
  }

  private updateHandlePositions(): void {
    this.handleGroup.children.forEach((group, index) => {
      const point = this.points[index]
      if (point) group.position.set(point[0], point[1], point[2])
    })
    this.updateHandleVisuals()
  }

  private updateHandleVisuals(): void {
    for (let i = 0; i < HANDLE_COUNT; i += 1) {
      const active = i === this.selectedIndex || i === this.hoverIndex || i === this.draggingIndex
      const core = this.coreHandles[i]
      const halo = this.haloHandles[i]
      halo.visible = active
      const scale =
        i === this.draggingIndex ? 1.34 : i === this.selectedIndex ? 1.22 : i === this.hoverIndex ? 1.12 : 1
      core.scale.setScalar(scale)
      halo.scale.setScalar(i === this.draggingIndex ? 1.55 : i === this.selectedIndex ? 1.38 : 1.16)
      const material = core.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = i === this.draggingIndex ? 0.9 : active ? 0.62 : 0.34
    }
  }

  private rebuildRealtimeSkeleton(): void {
    for (const child of [...this.realtimeGroup.children]) {
      this.realtimeGroup.remove(child)
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
    }

    for (const geometry of createSkeletonGeometries(this.points)) {
      const mesh = new THREE.Mesh(geometry, this.skeletonMaterial)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.realtimeGroup.add(mesh)
    }

    this.realtimeGroup.visible = true
    this.mergedMesh.visible = false
  }

  applyMergedGeometry(geometry: THREE.BufferGeometry): void {
    const oldGeometry = this.mergedMesh.geometry
    this.mergedMesh.geometry = geometry
    if (oldGeometry !== geometry) oldGeometry.dispose()
    this.mergedMesh.visible = true
    this.realtimeGroup.visible = false
  }

  showRealtimeSkeleton(): void {
    this.mergedMesh.visible = false
    this.realtimeGroup.visible = true
  }

  updateFlowers(plan: FlowerPlan, type: FlowerTypeId, scale: number): void {
    this.lastFlowerPlan = plan
    this.lastFlowerType = type
    if (this.flowerMesh) {
      this.flowerGroup.remove(this.flowerMesh)
      this.flowerMesh.dispose()
      this.flowerMesh = null
    }

    const geometry = getFlowerGeometry(type)
    const mesh = new THREE.InstancedMesh(geometry, this.flowerMaterial, plan.instances.length)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const instanceScale = new THREE.Vector3()
    const color = new THREE.Color()

    plan.instances.forEach((instance, index) => {
      position.fromArray(instance.position)
      quaternion.fromArray(instance.quaternion)
      instanceScale.setScalar(instance.scale * scale)
      matrix.compose(position, quaternion, instanceScale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(instance.tint))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    this.flowerMesh = mesh
    this.flowerGroup.scale.setScalar(1)
    this.flowerGroup.add(mesh)
  }

  setFlowerScale(scale: number): void {
    // Rebake per-instance scales so scaling happens around each flower rather
    // than the world origin (a group scale would move flowers off the arc).
    if (this.lastFlowerPlan && this.lastFlowerType) {
      this.updateFlowers(this.lastFlowerPlan, this.lastFlowerType, scale)
    }
  }

  private setPointerFromEvent(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private hitTestHandle(): number | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false)
    if (!hits.length) return null
    return typeof hits[0].object.userData.index === 'number'
      ? (hits[0].object.userData.index as number)
      : null
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target !== this.renderer.domElement) return
    this.setPointerFromEvent(event)
    const index = this.hitTestHandle()

    if (index === null) {
      if (this.selectedIndex !== null) {
        this.selectedIndex = null
        this.updateHandleVisuals()
        this.callbacks.onSelectionChange?.(null)
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.draggingIndex = index
    this.selectedIndex = index
    this.hoverIndex = index
    this.controls.enabled = false
    this.updateHandleVisuals()
    this.callbacks.onSelectionChange?.(index)
    this.callbacks.onPointBegin?.(index)
    document.body.style.cursor = 'grabbing'
    this.updateDraggedPoint(event)
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.setPointerFromEvent(event)

    if (this.draggingIndex !== null) {
      event.preventDefault()
      this.updateDraggedPoint(event)
      return
    }

    if (event.target !== this.renderer.domElement) return
    const index = this.hitTestHandle()
    if (index !== this.hoverIndex) {
      this.hoverIndex = index
      this.updateHandleVisuals()
      this.renderer.domElement.style.cursor = index === null ? 'grab' : 'grab'
      if (index !== null) this.renderer.domElement.style.cursor = 'pointer'
    }
  }

  private updateDraggedPoint(event: PointerEvent): void {
    const index = this.draggingIndex
    if (index === null) return
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.intersection)) return

    const next = clampControlPoint([this.intersection.x, this.intersection.y, 0])
    this.points[index] = next
    this.updateHandlePositions()
    this.rebuildRealtimeSkeleton()
    this.callbacks.onPointChange?.(index, next)

    const curve = createArchCurve(this.points)
    const u = nearestArcU(curve, next)
    const totalLength = curve.getLength()
    const curvature = curvatureAtArcU(curve, u)
    this.callbacks.onMetrics?.({
      index,
      x: event.clientX,
      y: event.clientY,
      arcLength: totalLength,
      positionOnArc: u * totalLength,
      curvature,
      radius: curvature > 1e-5 ? 1 / curvature : Number.POSITIVE_INFINITY
    })
  }

  private onPointerUp = (): void => {
    if (this.draggingIndex === null) return
    this.draggingIndex = null
    this.controls.enabled = true
    document.body.style.cursor = ''
    this.renderer.domElement.style.cursor = 'grab'
    this.updateHandleVisuals()
    this.callbacks.onMetrics?.(null)
    this.callbacks.onPointEnd?.()
  }

  resize(): void {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  dispose(): void {
    this.disposed = true
    this.resizeObserver.disconnect()
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.controls.dispose()
    this.renderer.setAnimationLoop(null)

    disposeObjectGeometries(this.realtimeGroup)
    disposeObjectGeometries(this.handleGroup)
    this.mergedMesh.geometry.dispose()
    if (this.flowerMesh) this.flowerMesh.dispose()
    this.coreHandles.forEach((mesh) => (mesh.material as THREE.Material).dispose())
    this.haloHandles.forEach((mesh) => (mesh.material as THREE.Material).dispose())
    this.hitMeshes.forEach((mesh) => (mesh.material as THREE.Material).dispose())
    this.skeletonMaterial.dispose()
    this.flowerMaterial.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
