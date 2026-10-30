import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createState, selectObject, colorSelected, objects, palette } from './空间状态.mjs'

const state = createState(), host = document.querySelector('#空间画布'), status = document.querySelector('#场景状态')
const meshes = new Map(), picks = [], initialCamera = [4.8, 3.4, 7.5]
let frames = 0, loadedModel = false
try {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#132033')
  scene.fog = new THREE.Fog('#132033', 12, 24)
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 100)
  camera.position.set(...initialCamera)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  host.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.dampingFactor = .075
  controls.target.set(0, .9, 0)
  controls.minDistance = 4; controls.maxDistance = 15; controls.maxPolarAngle = Math.PI * .47
  controls.update()
  scene.add(new THREE.HemisphereLight('#e8f4ff', '#303b54', 2.2))
  const key = new THREE.DirectionalLight('#ffffff', 3.2); key.position.set(4, 6, 3); scene.add(key)
  const fill = new THREE.DirectionalLight('#83b8ff', 1.7); fill.position.set(-4, 3, -3); scene.add(fill)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 96), new THREE.MeshStandardMaterial({ color: '#1b2c43', roughness: .86 }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; scene.add(floor)
  const material = color => new THREE.MeshStandardMaterial({ color, metalness: .3, roughness: .28 })
  const addObject = (id, node, x) => {
    node.position.set(x, .16, 0); node.userData.objectId = id
    node.traverse(child => { if (child.isMesh) { child.userData.objectId = id; picks.push(child) } })
    meshes.set(id, node); scene.add(node)
  }
  for (const x of [-2.1, 0, 2.1]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1, .22, 48), new THREE.MeshStandardMaterial({ color: '#253c56', roughness: .6 }))
    base.position.set(x, .03, 0); scene.add(base)
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.72, .2, 24, 80), material(state.colors.orbit))
  ring.geometry.translate(0, .92, 0)
  addObject('orbit', ring, 0)
  const column = new THREE.Mesh(new THREE.CylinderGeometry(.45, .55, 1.7, 48), material(state.colors.column))
  column.geometry.translate(0, .85, 0)
  addObject('column', column, 2.1)
  const model = await new GLTFLoader().loadAsync('展品模型.gltf')
  model.scene.traverse(node => { if (node.isMesh) node.material = material(state.colors.crystal) })
  addObject('crystal', model.scene, -2.1)
  loadedModel = true
  const update = () => {
    for (const [id, object] of meshes) object.traverse(node => { if (node.isMesh) node.material.color.set(state.colors[id]) })
    document.querySelector('#展品名称').textContent = objects.find(item => item.id === state.selected).label
    for (const button of document.querySelectorAll('[data-object]')) button.setAttribute('aria-pressed', String(button.dataset.object === state.selected))
    for (const button of document.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === state.colors[state.selected]))
    status.textContent = '可拖拽观察 · 点击展品选物与换色'
  }
  const list = document.querySelector('#展品列表')
  for (const object of objects) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.object = object.id; button.textContent = object.label
    button.addEventListener('click', () => { selectObject(state, object.id); update() }); list.append(button)
  }
  const colors = document.querySelector('#颜色列表')
  for (const color of palette) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.color = color
    button.style.backgroundColor = color; button.setAttribute('aria-label', '配色 ' + color)
    button.addEventListener('click', () => { colorSelected(state, color); update() }); colors.append(button)
  }
  document.querySelector('#镜头复位').addEventListener('click', () => {
    const damping = controls.enableDamping
    controls.enableDamping = false; controls.update()
    camera.position.set(...initialCamera); controls.target.set(0, .9, 0); controls.update()
    controls.enableDamping = damping
  })
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
  let down
  renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY } })
  renderer.domElement.addEventListener('pointercancel', () => { down = null })
  renderer.domElement.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) { down = null; return }
    down = null
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(picks, false)[0]
    if (hit) { selectObject(state, hit.object.userData.objectId); update() }
  })
  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height)
  }
  new ResizeObserver(resize).observe(host); resize(); update()
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); frames++ })
  window.blueprint3D = Object.freeze({ getState: () => {
    const rect = renderer.domElement.getBoundingClientRect()
    const pickPoints = Object.fromEntries([...meshes].map(([id, node]) => {
      const position = new THREE.Vector3(node.position.x, node.position.y + .7, node.position.z).project(camera)
      return [id, { x: rect.left + (position.x + 1) / 2 * rect.width, y: rect.top + (1 - position.y) / 2 * rect.height }]
    }))
    return { ...structuredClone(state), camera: camera.position.toArray(), target: controls.target.toArray(), frames,
      loadedModel, engine: THREE.REVISION, triangles: renderer.info.render.triangles, pickPoints,
      materialColors: Object.fromEntries([...meshes].map(([id, node]) => { let color; node.traverse(child => { if (child.isMesh) color = "#" + child.material.color.getHexString() }); return [id, color] })) }
  } })
} catch (error) { status.textContent = '场景启动失败：' + error.message; console.error(error) }
