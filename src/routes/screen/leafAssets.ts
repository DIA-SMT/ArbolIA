import * as THREE from 'three'

/**
 * Assets del follaje generados en runtime.
 *
 * Nada de archivos externos: la instalación tiene que levantar aunque el
 * predio no tenga red al momento de abrir, y evita un round-trip de assets
 * en el arranque de la pantalla.
 */

let leafGeometry: THREE.BufferGeometry | null = null
let leafTexture: THREE.Texture | null = null
let glowTexture: THREE.Texture | null = null

/**
 * Hoja levemente curvada. Un plano plano desaparece cuando la cámara lo mira
 * de canto; la curvatura hace que siempre haya algo de superficie captando
 * luz, y de paso da el titileo orgánico cuando la cámara orbita.
 */
export function getLeafGeometry(): THREE.BufferGeometry {
  if (leafGeometry) return leafGeometry

  // Pocas subdivisiones: con miles de instancias, cada triangulo se multiplica.
  const geo = new THREE.PlaneGeometry(0.132, 0.196, 2, 3)
  const pos = geo.attributes.position as THREE.BufferAttribute

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    // Curvatura en cuenco + leve giro sobre el eje longitudinal.
    const bowl = -(x * x) * 3.4 - (y * y) * 0.9
    pos.setZ(i, bowl * 0.16)
  }

  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.translate(0, 0.06, 0)

  leafGeometry = geo
  return geo
}

/** Silueta de hoja con nervadura, en escala de grises para usar como alpha. */
export function getLeafTexture(): THREE.Texture {
  if (leafTexture) return leafTexture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    leafTexture = new THREE.Texture()
    return leafTexture
  }

  ctx.clearRect(0, 0, size, size)

  // Silueta: dos arcos que se encuentran en la punta y en el pecíolo.
  ctx.beginPath()
  ctx.moveTo(size * 0.5, size * 0.04)
  ctx.bezierCurveTo(size * 0.95, size * 0.3, size * 0.9, size * 0.72, size * 0.5, size * 0.98)
  ctx.bezierCurveTo(size * 0.1, size * 0.72, size * 0.05, size * 0.3, size * 0.5, size * 0.04)
  ctx.closePath()

  const grad = ctx.createRadialGradient(
    size * 0.5,
    size * 0.46,
    size * 0.04,
    size * 0.5,
    size * 0.5,
    size * 0.55,
  )
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.92)')
  grad.addColorStop(1, 'rgba(255,255,255,0.42)')

  ctx.fillStyle = grad
  ctx.fill()

  // Nervadura central, apenas insinuada.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = size * 0.016
  ctx.beginPath()
  ctx.moveTo(size * 0.5, size * 0.1)
  ctx.lineTo(size * 0.5, size * 0.93)
  ctx.stroke()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  leafTexture = tex
  return tex
}

/** Punto de luz radial: partículas de ambiente y la partícula viajera. */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    glowTexture = new THREE.Texture()
    return glowTexture
  }

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  glowTexture = tex
  return tex
}

