# View to 3D

Visor 3D estático para navegador y GitHub Pages. Los archivos se procesan localmente en el navegador: no existe backend de subida.

## Formatos

Carga directa: GLB/GLTF, FBX, OBJ + MTL, STL, PLY, 3MF, DAE, 3DS, USD/USDA/USDC/USDZ, VRML, VTK/VTP, PCD, XYZ, VOX, GCODE, BVH, Draco (`.drc`), SPLAT/SPZ y AMF.

Paquetes: `.zip` con JSZip y `.rar` con `node-unrar-js`/WebAssembly. Las referencias de texturas y archivos auxiliares se resuelven contra los otros archivos seleccionados o extraídos.

> Alembic `.abc`: se detecta y se informa al usuario, pero no se anuncia como compatible porque Three.js no ofrece un loader Alembic estable para navegador. Conviene exportarlo a GLB/GLTF o USD/USDZ.

## GitHub Pages

El sitio se publica desde `main` y la raíz `/` del repositorio. El repositorio ya usa el despliegue de GitHub Pages por branch, así que cada cambio en `main` vuelve a publicar la página automáticamente.

## Dependencias CDN

- Three.js 0.186.0
- JSZip 3.10.2
- node-unrar-js 2.0.2 + `unrar.wasm`
