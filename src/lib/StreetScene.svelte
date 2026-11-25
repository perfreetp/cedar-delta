<script>
  import { onMount } from 'svelte'
  import * as B from '@babylonjs/core'
  import { sceneData, selectedId, setLampOverride } from './store.js'
  import { makeRng } from './rng.js'
  import { ROAD_HALF, WALK_Z } from './generate.js'

  let canvas

  let engine, bScene, camera, hl
  let worldRoot = null
  let mats = {}
  let winLitSrc, winDarkSrc
  let buildingMeshes = new Map()
  let lampNodes = new Map()
  let cars = []
  let clouds = []
  let currentLength = 120
  let selId = null
  let rebuildTimer = null

  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)
    const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]
    return new B.Color3(m[0], m[1], m[2])
  }

  function stdMat(name, diffuse, opts = {}) {
    const m = new B.StandardMaterial(name, bScene)
    m.diffuseColor = diffuse
    m.specularColor = new B.Color3(0.04, 0.04, 0.04)
    if (opts.emissive) m.emissiveColor = opts.emissive
    if (opts.alpha !== undefined) m.alpha = opts.alpha
    return m
  }

  function makeMaterials() {
    mats.road = stdMat('road', B.Color3.FromHexString('#3a3f44'))
    mats.sidewalk = stdMat('sidewalk', B.Color3.FromHexString('#9aa0a6'))
    mats.ground = stdMat('ground', B.Color3.FromHexString('#7d9b6a'))
    mats.dash = stdMat('dash', B.Color3.FromHexString('#e8e8e8'), { emissive: B.Color3.FromHexString('#555555') })
    mats.pole = stdMat('pole', B.Color3.FromHexString('#4a4f55'))
    mats.lampHead = stdMat('lampHead', B.Color3.Black(), { emissive: B.Color3.FromHexString('#ffd98a') })
    mats.trunk = stdMat('trunk', B.Color3.FromHexString('#6b4a2f'))
    mats.leaf = stdMat('leaf', B.Color3.FromHexString('#3f7d3a'))
    mats.roof = stdMat('roof', B.Color3.FromHexString('#8a4b3c'))
    mats.roofGrey = stdMat('roofGrey', B.Color3.FromHexString('#5d646b'))
    mats.winLit = stdMat('winLit', B.Color3.Black(), { emissive: B.Color3.FromHexString('#ffd27a') })
    mats.winDark = stdMat('winDark', B.Color3.FromHexString('#22303c'))
    mats.cloud = stdMat('cloud', B.Color3.White(), { emissive: new B.Color3(0.75, 0.78, 0.82), alpha: 0.92 })
  }

  // ---------- 地面 / 道路 ----------
  function buildGround(length) {
    const g = B.MeshBuilder.CreateGround('ground', { width: length + 220, height: 140 }, bScene)
    g.material = mats.ground
    g.parent = worldRoot

    const road = B.MeshBuilder.CreateBox('road', { width: length + 60, height: 0.12, depth: ROAD_HALF * 2 }, bScene)
    road.position.y = 0.06
    road.material = mats.road
    road.parent = worldRoot

    for (const side of [-1, 1]) {
      const walk = B.MeshBuilder.CreateBox('walk', { width: length + 60, height: 0.14, depth: 3 }, bScene)
      walk.position.set(0, 0.07, side * WALK_Z)
      walk.material = mats.sidewalk
      walk.parent = worldRoot
    }

    for (let x = -length / 2; x < length / 2; x += 4) {
      const dash = B.MeshBuilder.CreateBox('dash', { width: 1.6, height: 0.02, depth: 0.18 }, bScene)
      dash.position.set(x + 0.8, 0.13, 0)
      dash.material = mats.dash
      dash.parent = worldRoot
    }
  }

  // ---------- 屋顶 ----------
  function addRoof(node, b) {
    const mk = (mesh, y) => {
      mesh.parent = node
      mesh.material = mats.roof
      mesh.metadata = { buildingId: b.id }
      if (y !== undefined) mesh.position.y = y
      return mesh
    }
    if (b.roof === 'flat') {
      mk(B.MeshBuilder.CreateBox('r', { width: b.width + 0.3, height: 0.5, depth: b.depth + 0.3 }, bScene), b.height + 0.25)
    } else if (b.roof === 'terrace') {
      mk(B.MeshBuilder.CreateBox('r', { width: b.width + 0.3, height: 0.4, depth: b.depth + 0.3 }, bScene), b.height + 0.2)
      const t = mk(B.MeshBuilder.CreateBox('r2', { width: b.width * 0.55, height: 1.8, depth: b.depth * 0.55 }, bScene), b.height + 1.1)
      t.material = mats.roofGrey
    } else if (b.roof === 'pyramid') {
      const h = b.width * 0.4
      const c = mk(B.MeshBuilder.CreateCylinder('r', {
        height: h, diameterTop: 0,
        diameterBottom: Math.hypot(b.width, b.depth) * 1.02, tessellation: 4
      }, bScene), b.height + h / 2)
      c.rotation.y = Math.PI / 4
    } else if (b.roof === 'spire') {
      mk(B.MeshBuilder.CreateBox('r0', { width: b.width * 0.5, height: 0.6, depth: b.depth * 0.5 }, bScene), b.height + 0.3)
      const h = b.width * 1.0
      mk(B.MeshBuilder.CreateCylinder('r', {
        height: h, diameterTop: 0, diameterBottom: b.width * 0.42, tessellation: 12
      }, bScene), b.height + 0.6 + h / 2)
    } else if (b.roof === 'gable') {
      // 三角棱柱:手写顶点,屋脊沿进深方向
      const w = b.width / 2, d = b.depth / 2, h = b.width * 0.38
      const positions = [
        -w, 0, -d,  w, 0, -d,  0, h, -d,   // 前三角 0 1 2
        -w, 0, d,   w, 0, d,   0, h, d     // 后三角 3 4 5
      ]
      const indices = [
        0, 1, 2,  5, 4, 3,          // 前后三角
        0, 3, 4,  0, 4, 1,          // 底面
        0, 2, 5,  0, 5, 3,          // 左坡
        1, 4, 5,  1, 5, 2           // 右坡
      ]
      const normals = []
      B.VertexData.ComputeNormals(positions, indices, normals)
      const vd = new B.VertexData()
      vd.positions = positions
      vd.indices = indices
      vd.normals = normals
      const g = new B.Mesh('r', bScene)
      vd.applyToMesh(g)
      mk(g, b.height)
    }
  }

  // ---------- 楼栋 ----------
  function buildBuilding(b, seed) {
    const node = new B.TransformNode('b_' + b.id, bScene)
    node.parent = worldRoot
    node.position = new B.Vector3(b.x, 0, b.z)
    node.rotation.y = b.side > 0 ? Math.PI : 0 // 临街面(-z)朝向道路

    const mat = stdMat('bm_' + b.id, hsv(b.hue, 0.3, 0.88))
    const body = B.MeshBuilder.CreateBox('body_' + b.id, { width: b.width, height: b.height, depth: b.depth }, bScene)
    body.parent = node
    body.position.y = b.height / 2
    body.material = mat
    body.metadata = { buildingId: b.id }
    buildingMeshes.set(b.id, body)

    addRoof(node, b)

    // 窗户:共享两个源平面做实例化,亮灯/暗窗由楼种子决定
    const rng = makeRng(`${seed}:win:${b.id}`)
    const usableW = b.width - 2
    const usableH = b.height - 2.4
    if (usableW > 0 && usableH > 0) {
      const sx = usableW / b.cols
      const sy = usableH / b.rows
      for (const face of [-1, 1]) {
        for (let r = 0; r < b.rows; r++) {
          for (let c = 0; c < b.cols; c++) {
            const src = rng() < 0.45 ? winLitSrc : winDarkSrc
            const inst = src.createInstance('w')
            inst.parent = node
            inst.position.set(-usableW / 2 + sx * (c + 0.5), 1.4 + sy * (r + 0.5), face * (b.depth / 2 + 0.03))
            if (face < 0) inst.rotation.y = Math.PI
          }
        }
      }
    }
  }

  // ---------- 路灯(可拖拽) ----------
  function buildLamp(l) {
    const node = new B.TransformNode('lamp_' + l.id, bScene)
    node.parent = worldRoot
    node.position.set(l.x, 0, l.z)
    lampNodes.set(l.id, node)

    const toRoad = -Math.sign(l.z)
    const pole = B.MeshBuilder.CreateCylinder('p', { height: 4.4, diameter: 0.14 }, bScene)
    pole.parent = node
    pole.position.y = 2.2
    pole.material = mats.pole

    const arm = B.MeshBuilder.CreateBox('a', { width: 0.09, height: 0.09, depth: 1.1 }, bScene)
    arm.parent = node
    arm.position.set(0, 4.3, toRoad * 0.5)
    arm.material = mats.pole

    const head = B.MeshBuilder.CreateSphere('h', { diameter: 0.5 }, bScene)
    head.parent = node
    head.position.set(0, 4.2, toRoad * 1.0)
    head.material = mats.lampHead

    for (const m of [pole, arm, head]) m.metadata = { lampId: l.id }
  }

  // ---------- 树 ----------
  function buildTree(t) {
    const node = new B.TransformNode('tree_' + t.id, bScene)
    node.parent = worldRoot
    node.position.set(t.x, 0, t.z)
    const trunk = B.MeshBuilder.CreateCylinder('tr', { height: 1.4 * t.s, diameter: 0.28 * t.s }, bScene)
    trunk.parent = node
    trunk.position.y = 0.7 * t.s
    trunk.material = mats.trunk
    const leaf = B.MeshBuilder.CreateSphere('lf', { diameter: 2.2 * t.s }, bScene)
    leaf.parent = node
    leaf.position.y = 1.9 * t.s
    leaf.scaling.y = 1.15
    leaf.material = mats.leaf
  }

  // ---------- 动画元素:汽车 & 云 ----------
  const CAR_COLORS = ['#c0392b', '#2980b9', '#f39c12', '#ecf0f1', '#8e44ad']
  function buildCars(length) {
    for (let i = 0; i < 5; i++) {
      const node = new B.TransformNode('car' + i, bScene)
      node.parent = worldRoot
      const lane = i % 2 === 0 ? 1.9 : -1.9
      const dir = lane > 0 ? 1 : -1
      node.position.set(-length / 2 + (i * length) / 5, 0, lane)
      node.rotation.y = dir > 0 ? 0 : Math.PI
      const mat = stdMat('car' + i, B.Color3.FromHexString(CAR_COLORS[i % CAR_COLORS.length]))
      const bodyM = B.MeshBuilder.CreateBox('cb', { width: 3.2, height: 0.9, depth: 1.6 }, bScene)
      bodyM.parent = node
      bodyM.position.y = 0.65
      bodyM.material = mat
      const cab = B.MeshBuilder.CreateBox('cc', { width: 1.7, height: 0.7, depth: 1.4 }, bScene)
      cab.parent = node
      cab.position.set(-0.2, 1.35, 0)
      cab.material = mats.winDark
      cars.push({ node, dir, speed: 9 + ((i * 2.7) % 5) })
    }
  }

  function buildClouds(length) {
    for (let i = 0; i < 4; i++) {
      const node = new B.TransformNode('cloud' + i, bScene)
      node.parent = worldRoot
      node.position.set(-length / 2 + (i * length) / 4, 42 + i * 5, -25 + i * 16)
      for (let k = 0; k < 3; k++) {
        const s = B.MeshBuilder.CreateSphere('cs', { diameter: 8 - k * 2 }, bScene)
        s.parent = node
        s.position.set(k * 4 - 4, k % 2, 0)
        s.scaling.y = 0.5
        s.material = mats.cloud
      }
      clouds.push({ node, speed: 1 + i * 0.4 })
    }
  }

  function animate() {
    const dt = engine.getDeltaTime() / 1000
    const half = currentLength / 2
    for (const c of cars) {
      c.node.position.x += c.dir * c.speed * dt
      if (c.node.position.x > half + 20) c.node.position.x = -half - 20
      if (c.node.position.x < -half - 20) c.node.position.x = half + 20
    }
    for (const cl of clouds) {
      cl.node.position.x += cl.speed * dt
      if (cl.node.position.x > half + 90) cl.node.position.x = -half - 90
    }
  }

  // ---------- 重建 ----------
  function rebuild(data) {
    if (!bScene) return
    if (worldRoot) worldRoot.dispose()
    buildingMeshes.clear()
    lampNodes.clear()
    cars = []
    clouds = []
    currentLength = data.length

    worldRoot = new B.TransformNode('world', bScene)
    buildGround(data.length)
    for (const b of data.buildings) buildBuilding(b, data.seed)
    for (const l of data.lamps) buildLamp(l)
    for (const t of data.trees) buildTree(t)
    buildCars(data.length)
    buildClouds(data.length)

    camera.radius = Math.min(Math.max(data.length * 1.05, 70), 420)
    updateHighlight(selId)
  }

  function scheduleRebuild(data) {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => rebuild(data), 60)
  }

  function updateHighlight(id) {
    if (!hl) return
    hl.removeAllMeshes()
    const mesh = id && buildingMeshes.get(id)
    if (mesh) hl.addMesh(mesh, B.Color3.FromHexString('#ffb300'))
  }

  // ---------- 交互:点选楼栋 / 拖拽路灯 ----------
  function setupPointer() {
    let drag = null
    bScene.onPointerObservable.add((pi) => {
      if (pi.type === B.PointerEventTypes.POINTERDOWN) {
        const pick = pi.pickInfo
        const md = pick?.hit ? pick.pickedMesh?.metadata : null
        if (md?.lampId) {
          drag = { id: md.lampId, node: lampNodes.get(md.lampId) }
          camera.detachControl()
          return
        }
        selectedId.set(md?.buildingId ?? null)
      } else if (pi.type === B.PointerEventTypes.POINTERMOVE && drag) {
        const ray = bScene.createPickingRay(bScene.pointerX, bScene.pointerY, B.Matrix.Identity(), camera)
        const t = -ray.origin.y / ray.direction.y
        if (t > 0) {
          const p = ray.origin.add(ray.direction.scale(t))
          const half = currentLength / 2
          drag.node.position.x = Math.max(-half, Math.min(half, p.x))
        }
      } else if (pi.type === B.PointerEventTypes.POINTERUP && drag) {
        const { id, node } = drag
        drag = null
        camera.attachControl(canvas, true)
        setLampOverride(id, node.position.x) // 记为手改项,重新生成时保留
      }
    })
  }

  onMount(() => {
    engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    bScene = new B.Scene(engine)
    bScene.clearColor = new B.Color4(0.62, 0.77, 0.91, 1)

    camera = new B.ArcRotateCamera('cam', -Math.PI / 2.3, Math.PI / 3.4, 160, new B.Vector3(0, 4, 0), bScene)
    camera.attachControl(canvas, true)
    camera.wheelDeltaPercentage = 0.01
    camera.lowerRadiusLimit = 25
    camera.upperRadiusLimit = 500
    camera.upperBetaLimit = Math.PI / 2.05

    const hemi = new B.HemisphericLight('hemi', new B.Vector3(0.3, 1, 0.2), bScene)
    hemi.intensity = 0.85
    const sun = new B.DirectionalLight('sun', new B.Vector3(-0.4, -1, -0.35), bScene)
    sun.intensity = 0.7

    hl = new B.HighlightLayer('hl', bScene)

    makeMaterials()
    winLitSrc = B.MeshBuilder.CreatePlane('winLitSrc', { width: 0.95, height: 1.25 }, bScene)
    winLitSrc.material = mats.winLit
    winLitSrc.position.y = -500
    winDarkSrc = B.MeshBuilder.CreatePlane('winDarkSrc', { width: 0.95, height: 1.25 }, bScene)
    winDarkSrc.material = mats.winDark
    winDarkSrc.position.y = -500

    setupPointer()
    bScene.onBeforeRenderObservable.add(animate)
    engine.runRenderLoop(() => bScene.render())

    const unsubScene = sceneData.subscribe((d) => scheduleRebuild(d))
    const unsubSel = selectedId.subscribe((id) => { selId = id; updateHighlight(id) })
    const onResize = () => engine.resize()
    window.addEventListener('resize', onResize)

    return () => {
      unsubScene()
      unsubSel()
      window.removeEventListener('resize', onResize)
      engine.dispose()
    }
  })
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    touch-action: none;
  }
</style>
