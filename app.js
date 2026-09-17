import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/+esm';

const THREE_VERSION = '0.186.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`;
const LIB = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/libs/`;

const MODEL_FORMATS = new Set([
  'glb','gltf','fbx','obj','stl','ply','3mf','dae','3ds','usd','usda','usdc','usdz',
  'wrl','vrml','vtk','vtp','pcd','vox','gcode','bvh','drc','xyz','splat','spz','amf'
]);
const TEXTURE_FORMATS = new Set(['png','jpg','jpeg','webp','gif','bmp','tga','dds','ktx','ktx2','exr','hdr','avif','tif','tiff']);
const AUX_FORMATS = new Set(['mtl','bin']);
const ARCHIVE_FORMATS = new Set(['zip','rar']);
const PRIORITY = ['glb','gltf','fbx','obj','usdz','usd','usdc','usda','dae','3mf','stl','ply','3ds','wrl','vrml','vtk','vtp','pcd','vox','drc','splat','spz','gcode','bvh','xyz','amf'];

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('viewport'), shell: $('viewerShell'), welcome: $('welcome'), drop: $('dropOverlay'),
  loading: $('loading'), loadingTitle: $('loadingTitle'), loadingDetail: $('loadingDetail'), toast: $('toast'),
  fileInput: $('fileInput'), folderInput: $('folderInput'), assetList: $('assetList'), assetCount: $('assetCount'),
  modelName: $('modelName'), modelExt: $('modelExt'), renderInfo: $('renderInfo'), animationPanel: $('animationPanel'),
  animationSelect: $('animationSelect'), playBtn: $('playBtn'), animSpeed: $('animSpeed'), animTime: $('animTime'),
  statObjects: $('statObjects'), statTriangles: $('statTriangles'), statVertices: $('statVertices'),
  statMaterials: $('statMaterials'), statTextures: $('statTextures'), statAnimations: $('statAnimations')
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b0f);

const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100000);
camera.position.set(4, 2.8, 5.5);

const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, el.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.screenSpacePanning = true;
controls.minDistance = 0.001;
controls.maxDistance = 100000;
controls.autoRotateSpeed = 1.3;

const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x17120f, 2.4);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(5, 9, 7);
key.castShadow = true;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9dffd0, 1.35);
rim.position.set(-6, 3, -5);
scene.add(rim);

const grid = new THREE.GridHelper(20, 20, 0x355047, 0x1b2523);
grid.material.opacity = 0.48;
grid.material.transparent = true;
scene.add(grid);

let currentRoot = null;
let currentAsset = null;
let currentAnimations = [];
let mixer = null;
let activeAction = null;
let isPlaying = true;
let isWireframe = false;
let assets = [];
let assetUrls = new Map();
let toastTimer = null;
let dragDepth = 0;
const clock = new THREE.Clock();

function extOf(name = '') {
  const clean = name.split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('.');
  return i >= 0 ? clean.slice(i + 1).toLowerCase() : '';
}

function normalizePath(path = '') {
  return decodeURIComponent(String(path))
    .replace(/^blob:[^/]+\/+/i, '')
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^[./\\]+/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function baseName(path = '') { return normalizePath(path).split('/').pop() || ''; }
function niceSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function mimeFor(name) {
  const ext = extOf(name);
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif',
    bmp:'image/bmp', avif:'image/avif', gltf:'model/gltf+json', glb:'model/gltf-binary', obj:'text/plain',
    mtl:'text/plain', dae:'model/vnd.collada+xml', stl:'model/stl'
  };
  return map[ext] || 'application/octet-stream';
}

function asAsset(blob, path) {
  const safePath = String(path || blob.name || 'archivo').replace(/\\/g, '/');
  return { blob, path: safePath, name: safePath.split('/').pop(), ext: extOf(safePath), size: blob.size || 0 };
}

function setLoading(show, title = 'Procesando…', detail = '') {
  el.loading.hidden = !show;
  el.loadingTitle.textContent = title;
  el.loadingDetail.textContent = detail;
}

function notify(message, type = 'info', timeout = 4300) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  toastTimer = setTimeout(() => { el.toast.className = 'toast'; }, timeout);
}

function resetStats() {
  ['statObjects','statTriangles','statVertices','statMaterials','statTextures','statAnimations'].forEach(id => $(id).textContent = '0');
  el.modelExt.textContent = '—';
  el.modelName.textContent = 'Sin modelo';
  el.animationPanel.hidden = true;
}

function clearAssetUrls() {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
}

function disposeMaterial(mat) {
  if (!mat) return;
  for (const value of Object.values(mat)) {
    if (value?.isTexture) value.dispose();
  }
  mat.dispose?.();
}

function clearModel() {
  if (mixer) mixer.stopAllAction();
  mixer = null; activeAction = null; currentAnimations = [];
  if (currentRoot) {
    scene.remove(currentRoot);
    currentRoot.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
      else disposeMaterial(o.material);
    });
  }
  currentRoot = null;
  currentAsset = null;
}

function fullReset() {
  clearModel();
  clearAssetUrls();
  assets = [];
  renderAssetList();
  resetStats();
  el.welcome.classList.remove('hidden');
}

function buildAssetUrls() {
  clearAssetUrls();
  for (const asset of assets) assetUrls.set(normalizePath(asset.path), URL.createObjectURL(asset.blob));
}

function findAssetForUrl(url) {
  const clean = normalizePath(url);
  if (assetUrls.has(clean)) return assetUrls.get(clean);
  const byName = baseName(clean);
  if (!byName) return null;
  let candidate = null;
  for (const [path, blobUrl] of assetUrls) {
    if (baseName(path) === byName || path.endsWith(`/${clean}`) || clean.endsWith(`/${path}`)) {
      candidate = blobUrl;
      if (path === clean) break;
    }
  }
  return candidate;
}

function createManager() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => findAssetForUrl(url) || url);
  manager.onError = (url) => console.warn('[View to 3D] Recurso no resuelto:', url);
  return manager;
}

async function extractZip(file) {
  setLoading(true, 'Abriendo ZIP…', file.name);
  const zip = await JSZip.loadAsync(file);
  const out = [];
  const entries = Object.values(zip.files).filter(e => !e.dir && !e.name.startsWith('__MACOSX/'));
  let i = 0;
  for (const entry of entries) {
    i++;
    el.loadingDetail.textContent = `${i}/${entries.length} · ${entry.name}`;
    const blob = await entry.async('blob');
    out.push(asAsset(new Blob([blob], { type: mimeFor(entry.name) }), entry.name));
  }
  return out;
}

async function extractRar(file) {
  setLoading(true, 'Abriendo RAR…', 'Cargando UnRAR WebAssembly');
  const [{ createExtractorFromData }, wasmBinary] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/index.esm.js'),
    fetch('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/unrar.wasm').then(r => {
      if (!r.ok) throw new Error(`No se pudo cargar unrar.wasm (${r.status})`);
      return r.arrayBuffer();
    })
  ]);
  const data = await file.arrayBuffer();
  const extractor = await createExtractorFromData({ data, wasmBinary });
  const listed = extractor.getFileList();
  const headers = [...listed.fileHeaders];
  const encrypted = headers.filter(h => h.flags?.encrypted);
  const extracted = extractor.extract({ files: (header) => !header.flags?.encrypted });
  const out = [];
  let i = 0;
  for (const item of extracted.files) {
    const header = item.fileHeader || item.header || {};
    const name = header.name || item.name;
    if (!name || header.flags?.directory || !item.extraction) continue;
    i++;
    el.loadingDetail.textContent = `${i} · ${name}`;
    const bytes = item.extraction instanceof Uint8Array ? item.extraction : new Uint8Array(item.extraction);
    out.push(asAsset(new Blob([bytes], { type: mimeFor(name) }), name));
  }
  if (!out.length && encrypted.length) throw new Error('El RAR está cifrado. Esta versión no solicita contraseña todavía.');
  if (!out.length) throw new Error('El RAR no devolvió archivos extraíbles o usa un esquema no compatible.');
  return out;
}

async function prepareFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  setLoading(true, 'Leyendo archivos…', `${incoming.length} elemento(s)`);
  const next = [];
  try {
    for (const file of incoming) {
      const ext = extOf(file.name);
      if (ext === 'zip') next.push(...await extractZip(file));
      else if (ext === 'rar') next.push(...await extractRar(file));
      else next.push(asAsset(file, file.webkitRelativePath || file.name));
    }
    assets = next.filter(a => a.size > 0 || AUX_FORMATS.has(a.ext));
    buildAssetUrls();
    renderAssetList();
    const candidates = getModels();
    const abc = assets.find(a => a.ext === 'abc');
    if (!candidates.length) {
      if (abc) {
        throw new Error('Alembic (.abc) fue detectado, pero Three.js no tiene un cargador ABC estable en navegador. Exporta a GLB/GLTF o USD/USDZ para conservar materiales y una vista fiable.');
      }
      throw new Error('No encontré un modelo compatible dentro de los archivos seleccionados.');
    }
    const preferred = [...candidates].sort((a, b) => PRIORITY.indexOf(a.ext) - PRIORITY.indexOf(b.ext))[0];
    await loadAsset(preferred);
  } catch (err) {
    console.error(err);
    notify(err?.message || String(err), 'error', 7000);
    if (!currentRoot) el.welcome.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
}

function getModels() { return assets.filter(a => MODEL_FORMATS.has(a.ext)); }
function assetKind(a) {
  if (MODEL_FORMATS.has(a.ext)) return 'model';
  if (TEXTURE_FORMATS.has(a.ext)) return 'texture';
  if (AUX_FORMATS.has(a.ext)) return 'aux';
  if (ARCHIVE_FORMATS.has(a.ext)) return 'archive';
  return 'other';
}

function renderAssetList() {
  el.assetCount.textContent = String(assets.length);
  if (!assets.length) {
    el.assetList.className = 'asset-list empty-list';
    el.assetList.innerHTML = '<div class="empty-copy">Arrastra un modelo, sus texturas o un ZIP/RAR.</div>';
    return;
  }
  el.assetList.className = 'asset-list';
  el.assetList.replaceChildren();
  const ordered = [...assets].sort((a,b) => {
    const score = (x) => MODEL_FORMATS.has(x.ext) ? 0 : TEXTURE_FORMATS.has(x.ext) ? 1 : 2;
    return score(a) - score(b) || a.path.localeCompare(b.path);
  });
  for (const asset of ordered) {
    const row = document.createElement('div');
    const kind = assetKind(asset);
    row.className = `asset-row ${kind === 'model' ? 'model' : ''} ${asset === currentAsset ? 'current' : ''}`;
    row.title = asset.path;
    row.innerHTML = `<div class="file-icon">${(asset.ext || 'FILE').toUpperCase().slice(0,5)}</div><div class="asset-meta"><span class="asset-name"></span><span class="asset-path"></span></div><span class="asset-size">${niceSize(asset.size)}</span>`;
    row.querySelector('.asset-name').textContent = asset.name;
    row.querySelector('.asset-path').textContent = asset.path === asset.name ? kind : asset.path;
    if (kind === 'model') row.addEventListener('click', () => loadAsset(asset));
    el.assetList.appendChild(row);
  }
}

function assetText(asset) { return asset.blob.text(); }
function assetBuffer(asset) { return asset.blob.arrayBuffer(); }

async function importLoader(file, exportName) {
  const mod = await import(`${CDN}loaders/${file}.js`);
  if (!mod[exportName]) throw new Error(`El loader ${exportName} no está disponible en Three.js ${THREE_VERSION}.`);
  return mod[exportName];
}

function geometryMesh(geometry, opts = {}) {
  geometry.computeVertexNormals?.();
  geometry.computeBoundingBox?.();
  const material = new THREE.MeshStandardMaterial({
    color: opts.color || 0xb8c4c1,
    roughness: .62,
    metalness: .05,
    vertexColors: !!geometry.getAttribute?.('color'),
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pointsObject(geometry) {
  const hasColor = !!geometry.getAttribute?.('color');
  const mat = new THREE.PointsMaterial({ size: .01, sizeAttenuation: true, color: 0xdde7e3, vertexColors: hasColor });
  return new THREE.Points(geometry, mat);
}

async function loadAsset(asset) {
  if (!asset || !MODEL_FORMATS.has(asset.ext)) return;
  setLoading(true, 'Cargando modelo…', asset.name);
  try {
    clearModel();
    currentAsset = asset;
    renderAssetList();
    const manager = createManager();
    const ext = asset.ext;
    let root, animations = [];

    if (ext === 'glb' || ext === 'gltf') {
      const GLTFLoader = await importLoader('GLTFLoader', 'GLTFLoader');
      const loader = new GLTFLoader(manager);
      try {
        const DRACOLoader = await importLoader('DRACOLoader', 'DRACOLoader');
        const draco = new DRACOLoader(manager);
        draco.setDecoderPath(`${LIB}draco/gltf/`);
        loader.setDRACOLoader(draco);
      } catch (e) { console.warn('Draco no disponible:', e); }
      try {
        const { MeshoptDecoder } = await import(`${LIB}meshopt_decoder.module.js`);
        loader.setMeshoptDecoder(MeshoptDecoder);
      } catch (e) { console.warn('Meshopt no disponible:', e); }
      try {
        const KTX2Loader = await importLoader('KTX2Loader', 'KTX2Loader');
        const ktx2 = new KTX2Loader(manager).setTranscoderPath(`${LIB}basis/`).detectSupport(renderer);
        loader.setKTX2Loader(ktx2);
      } catch (e) { console.warn('KTX2 no disponible:', e); }
      const data = ext === 'gltf' ? await assetText(asset) : await assetBuffer(asset);
      const result = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
      root = result.scene || result.scenes?.[0];
      animations = result.animations || [];
    }
    else if (ext === 'fbx') {
      const FBXLoader = await importLoader('FBXLoader', 'FBXLoader');
      root = new FBXLoader(manager).parse(await assetBuffer(asset), '');
      animations = root.animations || [];
    }
    else if (ext === 'obj') {
      const OBJLoader = await importLoader('OBJLoader', 'OBJLoader');
      const loader = new OBJLoader(manager);
      const mtlAsset = findCompanion(asset, 'mtl');
      if (mtlAsset) {
        try {
          const MTLLoader = await importLoader('MTLLoader', 'MTLLoader');
          const creator = new MTLLoader(manager).parse(await assetText(mtlAsset), '');
          creator.preload();
          loader.setMaterials(creator);
        } catch (e) { console.warn('MTL no pudo cargarse:', e); }
      }
      root = loader.parse(await assetText(asset));
    }
    else if (ext === 'stl') {
      const STLLoader = await importLoader('STLLoader', 'STLLoader');
      root = geometryMesh(new STLLoader(manager).parse(await assetBuffer(asset)));
    }
    else if (ext === 'ply') {
      const PLYLoader = await importLoader('PLYLoader', 'PLYLoader');
      root = geometryMesh(new PLYLoader(manager).parse(await assetBuffer(asset)));
    }
    else if (ext === '3mf') {
      const ThreeMFLoader = await importLoader('3MFLoader', 'ThreeMFLoader');
      root = new ThreeMFLoader(manager).parse(await assetBuffer(asset));
    }
    else if (ext === 'dae') {
      const ColladaLoader = await importLoader('ColladaLoader', 'ColladaLoader');
      const result = new ColladaLoader(manager).parse(await assetText(asset), '');
      root = result.scene;
      animations = result.animations || [];
    }
    else if (ext === '3ds') {
      const TDSLoader = await importLoader('TDSLoader', 'TDSLoader');
      root = new TDSLoader(manager).parse(await assetBuffer(asset), '');
    }
    else if (['usd','usda','usdc','usdz'].includes(ext)) {
      const USDLoader = await importLoader('USDLoader', 'USDLoader');
      const loader = new USDLoader(manager);
      const data = await assetBuffer(asset);
      root = await new Promise((resolve, reject) => {
        try { loader.parse(data, '', resolve, reject); } catch (e) { reject(e); }
      });
    }
    else if (ext === 'wrl' || ext === 'vrml') {
      const VRMLLoader = await importLoader('VRMLLoader', 'VRMLLoader');
      root = new VRMLLoader(manager).parse(await assetText(asset), '');
    }
    else if (ext === 'vtk' || ext === 'vtp') {
      const VTKLoader = await importLoader('VTKLoader', 'VTKLoader');
      root = geometryMesh(new VTKLoader(manager).parse(await assetBuffer(asset)));
    }
    else if (ext === 'pcd') {
      const PCDLoader = await importLoader('PCDLoader', 'PCDLoader');
      root = new PCDLoader(manager).parse(await assetBuffer(asset), asset.name);
    }
    else if (ext === 'xyz') {
      const XYZLoader = await importLoader('XYZLoader', 'XYZLoader');
      root = pointsObject(new XYZLoader(manager).parse(await assetText(asset)));
    }
    else if (ext === 'vox') {
      const mod = await import(`${CDN}loaders/VOXLoader.js`);
      const chunks = new mod.VOXLoader(manager).parse(await assetBuffer(asset));
      root = new THREE.Group();
      for (const chunk of chunks) root.add(new mod.VOXMesh(chunk));
    }
    else if (ext === 'gcode') {
      const GCodeLoader = await importLoader('GCodeLoader', 'GCodeLoader');
      root = new GCodeLoader(manager).parse(await assetText(asset));
    }
    else if (ext === 'bvh') {
      const BVHLoader = await importLoader('BVHLoader', 'BVHLoader');
      const result = new BVHLoader(manager).parse(await assetText(asset));
      root = new THREE.Group();
      const boneRoot = result.skeleton.bones[0];
      root.add(boneRoot);
      root.add(new THREE.SkeletonHelper(boneRoot));
      animations = [result.clip];
    }
    else if (ext === 'drc') {
      const DRACOLoader = await importLoader('DRACOLoader', 'DRACOLoader');
      const loader = new DRACOLoader(manager);
      loader.setDecoderPath(`${LIB}draco/`);
      const buffer = await assetBuffer(asset);
      const geometry = await new Promise((resolve, reject) => loader.parse(buffer, resolve, reject));
      root = geometryMesh(geometry);
    }
    else if (ext === 'splat') {
      const SPLATLoader = await importLoader('SPLATLoader', 'SPLATLoader');
      root = await new SPLATLoader(manager).loadAsync(assetUrls.get(normalizePath(asset.path)));
    }
    else if (ext === 'spz') {
      const SPZLoader = await importLoader('SPZLoader', 'SPZLoader');
      root = await new SPZLoader(manager).loadAsync(assetUrls.get(normalizePath(asset.path)));
    }
    else if (ext === 'amf') {
      const AMFLoader = await importLoader('AMFLoader', 'AMFLoader');
      root = new AMFLoader(manager).parse(await assetBuffer(asset));
    }
    else {
      throw new Error(`Formato .${ext} todavía no tiene loader configurado.`);
    }

    if (!root) throw new Error('El loader terminó sin devolver una escena visible.');
    currentRoot = root;
    currentAnimations = animations.filter(Boolean);
    normalizeModelMaterials(root);
    scene.add(root);
    setupAnimations();
    fitToView();
    updateStats();
    el.welcome.classList.add('hidden');
    el.modelName.textContent = asset.name;
    el.modelExt.textContent = ext.toUpperCase();
    notify(`${asset.name} cargado correctamente.`);
  } catch (err) {
    console.error(err);
    clearModel();
    notify(`No pude abrir ${asset.name}: ${cleanError(err)}`, 'error', 8000);
  } finally {
    setLoading(false);
    renderAssetList();
  }
}

function findCompanion(asset, wantedExt) {
  const stem = asset.name.replace(/\.[^.]+$/, '').toLowerCase();
  const folder = normalizePath(asset.path).split('/').slice(0,-1).join('/');
  return assets.find(a => a.ext === wantedExt && a.name.replace(/\.[^.]+$/, '').toLowerCase() === stem)
    || assets.find(a => a.ext === wantedExt && normalizePath(a.path).startsWith(folder));
}

function cleanError(err) {
  const msg = err?.message || String(err);
  if (/Unexpected token|JSON/.test(msg)) return 'el archivo parece dañado o no corresponde realmente a ese formato.';
  if (/memory/i.test(msg)) return 'el archivo agotó la memoria disponible del navegador.';
  return msg.replace(/^Error:\s*/i, '').slice(0, 380);
}

function normalizeModelMaterials(root) {
  root.traverse?.((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (!mat) continue;
        if ('side' in mat && mat.side == null) mat.side = THREE.DoubleSide;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        if ('wireframe' in mat) mat.wireframe = isWireframe;
        mat.needsUpdate = true;
      }
    }
  });
}

function fitToView() {
  if (!currentRoot) return;
  currentRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(currentRoot);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (radius / Math.sin(fov / 2)) * 1.05;
  const direction = new THREE.Vector3(1, .58, 1).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(radius / 10000, 0.0001);
  camera.far = Math.max(radius * 10000, 1000);
  camera.updateProjectionMatrix();
  controls.minDistance = radius * .01;
  controls.maxDistance = radius * 150;
  controls.update();
  grid.position.y = box.min.y;
  grid.scale.setScalar(Math.max(radius / 10, .1));
}

function updateStats() {
  if (!currentRoot) return resetStats();
  let objects = 0, triangles = 0, vertices = 0;
  const materials = new Set(), textures = new Set();
  currentRoot.traverse?.((o) => {
    objects++;
    const g = o.geometry;
    if (g?.attributes?.position) {
      vertices += g.attributes.position.count;
      triangles += g.index ? Math.floor(g.index.count / 3) : Math.floor(g.attributes.position.count / 3);
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      materials.add(mat.uuid || mat);
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value.uuid || value);
    }
  });
  el.statObjects.textContent = objects.toLocaleString('es-CO');
  el.statTriangles.textContent = triangles.toLocaleString('es-CO');
  el.statVertices.textContent = vertices.toLocaleString('es-CO');
  el.statMaterials.textContent = materials.size.toLocaleString('es-CO');
  el.statTextures.textContent = textures.size.toLocaleString('es-CO');
  el.statAnimations.textContent = currentAnimations.length.toLocaleString('es-CO');
}

function setupAnimations() {
  mixer = null; activeAction = null;
  el.animationSelect.replaceChildren();
  el.animationPanel.hidden = !currentAnimations.length;
  if (!currentAnimations.length || !currentRoot) return;
  mixer = new THREE.AnimationMixer(currentRoot);
  currentAnimations.forEach((clip, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = clip.name || `Animación ${i + 1}`;
    el.animationSelect.appendChild(option);
  });
  playAnimation(0);
}

function playAnimation(index) {
  if (!mixer || !currentAnimations[index]) return;
  activeAction?.fadeOut(.18);
  activeAction = mixer.clipAction(currentAnimations[index]);
  activeAction.reset().fadeIn(.18).play();
  isPlaying = true;
  el.playBtn.textContent = 'Pausa';
}

function setWireframe(enabled) {
  isWireframe = enabled;
  currentRoot?.traverse?.((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) if ('wireframe' in mat) { mat.wireframe = enabled; mat.needsUpdate = true; }
  });
  $('wireBtn').classList.toggle('active', enabled);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (mixer && isPlaying) mixer.update(dt * Number(el.animSpeed.value || 1));
  if (mixer && activeAction) el.animTime.textContent = `${mixer.time.toFixed(2)}s`;
  controls.update();
  renderer.render(scene, camera);
  el.renderInfo.textContent = `${renderer.info.render.calls} draw · ${renderer.info.render.triangles.toLocaleString('es-CO')} tris`;
}

async function takeScreenshot() {
  if (!currentRoot) return notify('Carga un modelo antes de hacer una captura.', 'error');
  renderer.render(scene, camera);
  const a = document.createElement('a');
  const base = currentAsset?.name?.replace(/\.[^.]+$/, '') || 'view-to-3d';
  a.download = `${base}-preview.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
}

function bindEvents() {
  $('openFilesBtn').onclick = $('welcomeOpenBtn').onclick = () => el.fileInput.click();
  $('openFolderBtn').onclick = $('welcomeFolderBtn').onclick = () => el.folderInput.click();
  el.fileInput.onchange = () => { prepareFiles(el.fileInput.files); el.fileInput.value = ''; };
  el.folderInput.onchange = () => { prepareFiles(el.folderInput.files); el.folderInput.value = ''; };
  $('clearBtn').onclick = fullReset;
  $('fitBtn').onclick = fitToView;
  $('wireBtn').onclick = () => setWireframe(!isWireframe);
  $('gridBtn').onclick = () => { grid.visible = !grid.visible; $('gridBtn').classList.toggle('active', grid.visible); };
  $('rotateBtn').onclick = () => { controls.autoRotate = !controls.autoRotate; $('rotateBtn').classList.toggle('active', controls.autoRotate); };
  $('shotBtn').onclick = takeScreenshot;
  $('fullBtn').onclick = () => document.fullscreenElement ? document.exitFullscreen() : el.shell.requestFullscreen?.();
  el.animationSelect.onchange = () => playAnimation(Number(el.animationSelect.value));
  el.playBtn.onclick = () => {
    if (!mixer) return;
    isPlaying = !isPlaying;
    el.playBtn.textContent = isPlaying ? 'Pausa' : 'Reproducir';
    mixer.timeScale = isPlaying ? 1 : 0;
  };

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', clearAssetUrls);
  ['dragenter','dragover'].forEach(type => window.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragenter') dragDepth++;
    el.drop.classList.add('show');
  }));
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.drop.classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.drop.classList.remove('show');
    if (e.dataTransfer?.files?.length) prepareFiles(e.dataTransfer.files);
  });
}

resize();
bindEvents();
animate();
