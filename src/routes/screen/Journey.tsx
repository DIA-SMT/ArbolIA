import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildJourneyPath, getBranchFor, getLeafSlot, getTreeModel } from './treeGeometry'
import { getGlowTexture, getLeafGeometry, getLeafTexture } from './leafAssets'
import { leafQuaternion } from './leafPlacement'
import { NUCLEO_TEMA, aplicarTemaColor, blendingDe, type Tema } from './temaEscena'
import type { Idea } from '../../lib/types'

/** Viaje de la partícula: raíces → tronco → rama → posición de la hoja. */
export const JOURNEY_MS = 2300
const TRAIL_POINTS = 28
const BURST_POINTS = 46
const BURST_MS = 900
const SPROUT_MS = 900

interface Props {
  idea: Idea | null
  /** Cuántas hojas de esta categoría ya están plantadas. */
  indexInCategory: number
  /** Fondo sobre el que viaja la partícula. */
  tema?: Tema
}

export default function Journey({ idea, indexInCategory, tema = 'oscuro' }: Props) {
  const model = useMemo(() => getTreeModel(), [])
  const glow = useMemo(() => getGlowTexture(), [])
  const leafGeo = useMemo(() => getLeafGeometry(), [])

  const headRef = useRef<THREE.Sprite>(null)
  const trailRef = useRef<THREE.Points>(null)
  const burstRef = useRef<THREE.Points>(null)
  const leafRef = useRef<THREE.Mesh>(null)

  const elapsedRef = useRef(0)
  const burstDirsRef = useRef<Float32Array>(new Float32Array(BURST_POINTS * 3))

  // Destino y recorrido, recalculados sólo cuando cambia la idea activa.
  const journey = useMemo(() => {
    if (!idea) return null
    const branch = getBranchFor(model, idea.category)
    const slot = getLeafSlot(branch, indexInCategory)
    const path = buildJourneyPath(model, branch, slot, `${idea.id}-journey`)
    return {
      path,
      slot,
      color: new THREE.Color(branch.color),
      quaternion: leafQuaternion(slot, idea.id),
    }
  }, [idea, indexInCategory, model])

  const trailGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3),
    )
    geo.setAttribute(
      'size',
      new THREE.Float32BufferAttribute(new Float32Array(TRAIL_POINTS), 1),
    )
    return geo
  }, [])

  const burstGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(BURST_POINTS * 3), 3),
    )
    return geo
  }, [])

  /*
   * ESTE es el momento por el que existe la instalación: la idea de una
   * vecina subiendo desde las raíces hasta brotar en hoja, mientras ella
   * está parada mirando la pantalla.
   *
   * En tema claro no se veía. No es una manera de decir que se veía poco:
   * los cuatro materiales eran aditivos, y sumar luz sobre un fondo de
   * luminancia 0.978 no dibuja nada. La estela, la cabeza y el estallido de
   * llegada no existían, y lo único que quedaba era la hoja apareciendo de
   * la nada, sin el viaje que le da sentido.
   *
   * Con mezcla normal y el color de área en versión tinta, el mismo gesto
   * se lee sobre papel: una chispa oscura que sube por el tronco.
   */
  const trailMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glow,
        size: 0.075,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
        opacity: 0.9,
      }),
    [glow, tema],
  )

  const burstMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glow,
        size: 0.055,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
      }),
    [glow, tema],
  )

  const headMaterial = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
      }),
    [glow, tema],
  )

  const leafMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getLeafTexture(),
        transparent: true,
        alphaTest: 0.14,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  )

  /*
   * Reinicio al llegar una idea nueva. SÓLO cuando cambia el viaje.
   *
   * Esto estaba junto con el recoloreado de abajo, en un solo efecto que
   * también dependía del tema y de los cuatro materiales —que se rehacen
   * cuando el tema cambia—. O sea: si el operador tocaba Ctrl+L mientras la
   * idea de alguien estaba subiendo por el tronco, elapsedRef volvía a cero
   * y la partícula ARRANCABA DE NUEVO desde las raíces.
   *
   * Es el peor momento posible para un reinicio: esa persona está parada
   * delante de la pantalla mirando subir su idea. Separado, el cambio de
   * fondo no toca el viaje.
   */
  useEffect(() => {
    elapsedRef.current = 0
    if (!journey) return

    // Direcciones fijas del estallido de llegada.
    const dirs = burstDirsRef.current
    for (let i = 0; i < BURST_POINTS; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = 0.35 + Math.random() * 0.75
      dirs[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      dirs[i * 3 + 1] = Math.cos(phi) * speed * 0.8 + 0.25
      dirs[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed
    }
  }, [journey])

  /*
   * El vestuario, que sí sigue al tema. Repinta sin tocar el reloj: si el
   * fondo cambia a mitad de un viaje, la chispa cambia de color donde está
   * y sigue subiendo.
   */
  useEffect(() => {
    if (!journey) return

    aplicarTemaColor(trailMaterial.color, journey.color, tema)
    aplicarTemaColor(burstMaterial.color, journey.color, tema)
    /*
     * La cabeza va incandescente: el color del área tirado hacia el
     * extremo del rango. Sobre negro ese extremo es el blanco; sobre
     * papel, el blanco ES el fondo, así que ahí el extremo del gesto es
     * la tinta institucional y la cabeza se vuelve la parte más OSCURA
     * de la chispa. Mismo gesto, signo invertido.
     */
    aplicarTemaColor(headMaterial.color, journey.color, tema).lerp(NUCLEO_TEMA[tema], 0.45)
    aplicarTemaColor(leafMaterial.color, journey.color, tema)
  }, [journey, tema, trailMaterial, burstMaterial, headMaterial, leafMaterial])

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  useFrame((_, delta) => {
    const head = headRef.current
    const trail = trailRef.current
    const burst = burstRef.current
    const leaf = leafRef.current

    if (!journey) {
      if (head) head.visible = false
      if (trail) trail.visible = false
      if (burst) burst.visible = false
      if (leaf) leaf.visible = false
      return
    }

    elapsedRef.current += delta * 1000
    const ms = elapsedRef.current
    const travel = Math.min(1, ms / JOURNEY_MS)
    const eased = journeyEase(travel)

    // ---- Cabeza de la partícula ----
    if (head) {
      head.visible = travel < 1
      if (head.visible) {
        head.position.copy(journey.path.getPointAt(eased))
        // Late al subir y se agranda justo antes de llegar.
        const swell = 1 + Math.sin(ms * 0.012) * 0.12 + Math.pow(travel, 6) * 0.9
        head.scale.setScalar(0.2 * swell)
      }
    }

    // ---- Estela ----
    if (trail) {
      trail.visible = travel < 1
      if (trail.visible) {
        const pos = trailGeometry.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < TRAIL_POINTS; i++) {
          const lag = (i / TRAIL_POINTS) * 0.09
          const t = Math.max(0, eased - lag)
          const p = journey.path.getPointAt(t)
          pos.setXYZ(i, p.x, p.y, p.z)
        }
        pos.needsUpdate = true
        trailMaterial.opacity = 0.9 * (1 - Math.pow(travel, 8))
      }
    }

    // ---- Llegada: estallido + brote de la hoja ----
    const afterArrival = ms - JOURNEY_MS

    if (burst) {
      const active = afterArrival >= 0 && afterArrival < BURST_MS
      burst.visible = active
      if (active) {
        const t = afterArrival / BURST_MS
        const spread = easeOutCubic(t) * 0.42
        const pos = burstGeometry.attributes.position as THREE.BufferAttribute
        const dirs = burstDirsRef.current
        const origin = journey.slot.position

        for (let i = 0; i < BURST_POINTS; i++) {
          pos.setXYZ(
            i,
            origin.x + dirs[i * 3] * spread,
            origin.y + dirs[i * 3 + 1] * spread - t * t * 0.12,
            origin.z + dirs[i * 3 + 2] * spread,
          )
        }
        pos.needsUpdate = true
        burstMaterial.opacity = 1 - t
        burstMaterial.size = 0.055 * (1 - t * 0.55)
      }
    }

    if (leaf) {
      const active = afterArrival >= 0
      leaf.visible = active
      if (active) {
        const t = Math.min(1, afterArrival / SPROUT_MS)
        leaf.position.copy(journey.slot.position)
        leaf.quaternion.copy(journey.quaternion)
        leaf.scale.setScalar(journey.slot.scale * sproutEase(t))
        // Nace incandescente y se asienta en el color de su categoría.
        // El extremo incandescente depende del fondo: ver el reinicio.
        aplicarTemaColor(leafMaterial.color, journey.color, tema).lerp(NUCLEO_TEMA[tema], 0.75 * (1 - t))
      }
    }
  })

  if (!journey) return null

  return (
    <group>
      <sprite ref={headRef} material={headMaterial} />
      <points ref={trailRef} geometry={trailGeometry} material={trailMaterial} frustumCulled={false} />
      <points ref={burstRef} geometry={burstGeometry} material={burstMaterial} frustumCulled={false} />
      <mesh ref={leafRef} geometry={leafGeo} material={leafMaterial} frustumCulled={false} />
    </group>
  )
}

/** Sale despacio de la raíz, acelera en el tronco, llega con calma. */
function journeyEase(t: number): number {
  if (t < 0.22) return (t / 0.22) * 0.14
  if (t < 0.78) {
    const k = (t - 0.22) / 0.56
    return 0.14 + k * k * (3 - 2 * k) * 0.68
  }
  const k = (t - 0.78) / 0.22
  return 0.82 + (1 - Math.pow(1 - k, 2.4)) * 0.18
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function sproutEase(t: number): number {
  const c = 1.70158 * 1.28
  const p = t - 1
  return 1 + (c + 1) * p * p * p + c * p * p
}
