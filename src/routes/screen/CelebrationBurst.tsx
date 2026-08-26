import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'
import { getTreeModel } from './treeGeometry'

const PARTICLES = 900
const DURATION_MS = 4200

interface Props {
  /** Hito alcanzado; cambiar el valor dispara una nueva celebración. */
  trigger: number | null
}

/**
 * Estallido de los hitos. Las partículas nacen repartidas por toda la copa
 * —no de un punto— para que se lea como que florece el árbol entero y no
 * como un fuego artificial pegado encima.
 */
export default function CelebrationBurst({ trigger }: Props) {
  const pointsRef = useRef<THREE.Points>(null)
  const glow = useMemo(() => getGlowTexture(), [])
  const model = useMemo(() => getTreeModel(), [])

  const elapsedRef = useRef(Infinity)
  const originsRef = useRef(new Float32Array(PARTICLES * 3))
  const velocitiesRef = useRef(new Float32Array(PARTICLES * 3))

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 3), 3),
    )
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glow,
        size: 0.1,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexColors: true,
      }),
    [glow],
  )

  useEffect(() => {
    if (trigger === null) return

    const origins = originsRef.current
    const velocities = velocitiesRef.current
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute
    const color = new THREE.Color()

    for (let i = 0; i < PARTICLES; i++) {
      // Nacen en slots reales del follaje: la celebración sale del árbol.
      const branch = model.branches[i % model.branches.length]
      const slot = branch.leafSlots[Math.floor(Math.random() * branch.leafSlots.length)]

      origins[i * 3] = slot.position.x
      origins[i * 3 + 1] = slot.position.y
      origins[i * 3 + 2] = slot.position.z

      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = 0.5 + Math.random() * 1.5

      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 0.9 + 0.4
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed

      color.set(branch.color).lerp(new THREE.Color('#ffffff'), Math.random() * 0.5)
      colorAttr.setXYZ(i, color.r, color.g, color.b)
    }

    colorAttr.needsUpdate = true
    elapsedRef.current = 0
  }, [trigger, geometry, model])

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  useFrame((_, delta) => {
    const points = pointsRef.current
    if (!points) return

    if (elapsedRef.current > DURATION_MS) {
      points.visible = false
      return
    }

    elapsedRef.current += delta * 1000
    const t = Math.min(1, elapsedRef.current / DURATION_MS)
    points.visible = true

    const pos = geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const origins = originsRef.current
    const velocities = velocitiesRef.current

    // Expansión con desaceleración + caída suave: florecer, no explotar.
    const spread = (1 - Math.pow(1 - t, 2.6)) * 1.9
    const fall = t * t * 1.15

    for (let i = 0; i < PARTICLES; i++) {
      arr[i * 3] = origins[i * 3] + velocities[i * 3] * spread
      arr[i * 3 + 1] = origins[i * 3 + 1] + velocities[i * 3 + 1] * spread - fall
      arr[i * 3 + 2] = origins[i * 3 + 2] + velocities[i * 3 + 2] * spread
    }

    pos.needsUpdate = true
    material.opacity = 1 - Math.pow(t, 2.2)
    material.size = 0.1 * (1 - t * 0.4)
  })

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      visible={false}
    />
  )
}
