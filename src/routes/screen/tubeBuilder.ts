import * as THREE from 'three'

/**
 * Construcción de tubos de radio variable a lo largo de una curva.
 *
 * THREE.TubeGeometry sólo acepta radio constante, y un tronco de radio
 * constante se lee como un caño. Acá la geometría se arma a mano con los
 * frames de Frenet de la curva y el radio interpolado por una función.
 *
 * Además todo se acumula en un único buffer: un árbol con ramificación real
 * tiene más de cien ramas, y una malla por rama serían cien llamadas de
 * dibujo. Fusionadas por categoría son ocho.
 *
 * uv.x avanza a lo largo del recorrido (lo usa el shader para mover los
 * pulsos de savia), uv.y da la vuelta al perímetro.
 */

export interface TubeAccumulator {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
  /** Grosor relativo de la rama, 1 = tronco, 0 = ramita terminal. */
  thickness: number[]
}

export function createAccumulator(): TubeAccumulator {
  return { positions: [], normals: [], uvs: [], indices: [], thickness: [] }
}

export interface TubeOptions {
  segments?: number
  radialSegments?: number
  /** Se expone al shader como atributo, para variar el brillo por jerarquía. */
  thickness?: number
  /** Desplaza el rango de uv.x, para que los pulsos fluyan de forma continua
   *  desde el tronco hacia la punta a través de varias ramas encadenadas. */
  uvStart?: number
  uvEnd?: number
}

export function addTube(
  acc: TubeAccumulator,
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  options: TubeOptions = {},
): void {
  const segments = options.segments ?? 20
  const radialSegments = options.radialSegments ?? 6
  const thickness = options.thickness ?? 1
  const uvStart = options.uvStart ?? 0
  const uvEnd = options.uvEnd ?? 1

  const frames = curve.computeFrenetFrames(segments, false)
  const vertexOffset = acc.positions.length / 3

  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const vertexNormal = new THREE.Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    normal.copy(frames.normals[i])
    binormal.copy(frames.binormals[i])

    const radius = Math.max(0.0012, radiusAt(t))
    const u = uvStart + (uvEnd - uvStart) * t

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2
      const sin = Math.sin(theta)
      const cos = -Math.cos(theta)

      vertexNormal.x = cos * normal.x + sin * binormal.x
      vertexNormal.y = cos * normal.y + sin * binormal.y
      vertexNormal.z = cos * normal.z + sin * binormal.z
      vertexNormal.normalize()

      acc.normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z)
      acc.positions.push(
        point.x + radius * vertexNormal.x,
        point.y + radius * vertexNormal.y,
        point.z + radius * vertexNormal.z,
      )
      acc.uvs.push(u, j / radialSegments)
      acc.thickness.push(thickness)
    }
  }

  for (let i = 1; i <= segments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = vertexOffset + (radialSegments + 1) * (i - 1) + (j - 1)
      const b = vertexOffset + (radialSegments + 1) * i + (j - 1)
      const c = vertexOffset + (radialSegments + 1) * i + j
      const d = vertexOffset + (radialSegments + 1) * (i - 1) + j
      acc.indices.push(a, b, d, b, c, d)
    }
  }
}

export function finalize(acc: TubeAccumulator): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(acc.indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uvs, 2))
  geometry.setAttribute('aThickness', new THREE.Float32BufferAttribute(acc.thickness, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** Atajo: un solo tubo, su propia geometría. */
export function createTaperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  segments = 48,
  radialSegments = 8,
): THREE.BufferGeometry {
  const acc = createAccumulator()
  addTube(acc, curve, radiusAt, { segments, radialSegments })
  return finalize(acc)
}

/**
 * Perfil del tronco.
 *
 * Ensanche fuerte en la base —el pie donde se abre hacia las raíces— y
 * adelgazamiento con exponente bajo, que es lo que hace que se lea como
 * madera con masa y no como un poste.
 */
export function trunkRadius(t: number): number {
  const base = 0.25
  const tip = 0.072
  const flare = Math.pow(1 - t, 3.4) * 0.16
  return base + (tip - base) * Math.pow(t, 0.62) + flare
}

/**
 * Radio de una rama según su nivel en la jerarquía.
 *
 * El exponente bajo del adelgazamiento es lo que le da cuerpo: con un
 * afinado lineal las ramas se ven como alambres desde el segundo nivel.
 */
export function branchRadiusFor(level: number, baseRadius: number) {
  return (t: number) => {
    const tip = baseRadius * 0.3
    const flare = Math.pow(1 - t, 2.6) * baseRadius * 0.42
    return baseRadius + (tip - baseRadius) * Math.pow(t, 0.62) + flare + 0.003 * (4 - level)
  }
}

export function rootRadius(t: number): number {
  return 0.115 * Math.pow(1 - t, 0.55) + 0.006
}
