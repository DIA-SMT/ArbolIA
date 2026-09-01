import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'
import type { GrowthProfile } from '../../lib/types'

const MAX_MOTES = 700
const FIELD_RADIUS = 5.4
const FIELD_HEIGHT = 6.2

interface Props {
  growth: GrowthProfile
  /** Escala DIBUJADA del árbol. El suelo la sigue para no despegarse de
   *  las raíces cuando la copa crece. La escribe GrowthRig. */
  escalaRef?: React.MutableRefObject<number>
}

/**
 * Aire de la instalación: polvo luminoso en suspensión y el halo del suelo.
 * Es lo que da profundidad y hace que el árbol no flote en un vacío negro.
 */
export default function Atmosphere({ growth, escalaRef }: Props) {
  const motesRef = useRef<THREE.Points>(null)
  const glow = useMemo(() => getGlowTexture(), [])

  // Estado por partícula: posición base y velocidad de ascenso.
  const motes = useMemo(() => {
    const positions = new Float32Array(MAX_MOTES * 3)
    const speeds = new Float32Array(MAX_MOTES)
    const phases = new Float32Array(MAX_MOTES)

    for (let i = 0; i < MAX_MOTES; i++) {
      const angle = Math.random() * Math.PI * 2
      // Raíz cuadrada para que la distribución sea pareja en el disco.
      const radius = Math.sqrt(Math.random()) * FIELD_RADIUS
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = Math.random() * FIELD_HEIGHT - 1
      positions[i * 3 + 2] = Math.sin(angle) * radius
      speeds[i] = 0.05 + Math.random() * 0.16
      phases[i] = Math.random() * Math.PI * 2
    }

    return { positions, speeds, phases }
  }, [])

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(motes.positions.slice(), 3))
    return geo
  }, [motes])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glow,
        size: 0.045,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        color: new THREE.Color('#7dd3fc'),
        opacity: 0.55,
        fog: false,
      }),
    [glow],
  )

  // Telón de fondo: luz difusa que viene de fuera de cuadro.
  const backdropMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeBackdropTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.55,
        // El telon esta detras del plano de niebla: si la recibe, se apaga.
        fog: false,
      }),
    [],
  )

  const sueloRef = useRef<THREE.Group>(null)

  // Halo del suelo: ancla el árbol y sugiere la luz que sube de las raíces.
  const groundTexture = useMemo(() => makeGroundTexture(), [])
  const groundMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: groundTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.7,
        fog: false,
      }),
    [groundTexture],
  )

  /*
   * Halo de contacto: la misma textura radial, más chica y más concentrada.
   *
   * Reusa groundTexture a propósito: dos degradados distintos se leerían como
   * dos manchas superpuestas. Con la misma, el resultado es una sola pileta
   * de luz que se intensifica hacia el centro.
   */
  const contactoMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: groundTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.45,
        color: new THREE.Color('#7cf0b4'),
        fog: false,
      }),
    [groundTexture],
  )

  useEffect(() => {
    const mesh = motesRef.current
    if (mesh) mesh.geometry.setDrawRange(0, growth.particleCount)
  }, [growth.particleCount])

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  const timeRef = useRef(0)

  useFrame((_, delta) => {
    timeRef.current += delta
    const t = timeRef.current
    const pos = geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const active = Math.min(MAX_MOTES, growth.particleCount)

    for (let i = 0; i < active; i++) {
      const yi = i * 3 + 1
      arr[yi] += motes.speeds[i] * delta

      // Al pasarse de la copa vuelve abajo: campo infinito sin recrear buffers.
      if (arr[yi] > FIELD_HEIGHT) arr[yi] = -1

      // Deriva lateral suave, distinta por partícula.
      const phase = motes.phases[i]
      arr[i * 3] = motes.positions[i * 3] + Math.sin(t * 0.28 + phase) * 0.24
      arr[i * 3 + 2] = motes.positions[i * 3 + 2] + Math.cos(t * 0.22 + phase) * 0.24
    }

    pos.needsUpdate = true
    material.opacity = 0.4 + growth.glowIntensity * 0.16
    groundMaterial.opacity = 0.45 + growth.glowIntensity * 0.22
    contactoMaterial.opacity = 0.3 + growth.glowIntensity * 0.3

    /*
     * El suelo sigue al árbol.
     *
     * Se escala el grupo entero, así el disco crece y baja a la vez: en Brote
     * queda ajustado al pie del árbol y en Pleno acompaña la apertura de las
     * raíces sin dejarlas colgando ni atravesarlo.
     */
    const suelo = sueloRef.current
    if (suelo && escalaRef) {
      const e = escalaRef.current || 1
      suelo.scale.set(e, e, e)
    }
  })

  return (
    <group>
      {/*
        Telón de fondo. Un negro plano detrás del árbol lo deja flotando en
        la nada y delata que es una escena vacía; un halo tenue y descentrado
        da la sensación de aire y de una fuente de luz fuera de cuadro.
      */}
      <mesh position={[0.9, 2.4, -7]} material={backdropMaterial}>
        <planeGeometry args={[26, 18]} />
      </mesh>

      <points ref={motesRef} geometry={geometry} material={material} frustumCulled={false} />

      {/*
        El suelo, apoyado en las puntas de las raíces.

        Antes era un disco a una altura fija de -0.92. El árbol escala con la
        participación: en Brote las raíces llegan a -0.55 y el halo quedaba
        flotando medio metro por debajo, sin tocar nada; en Pleno bajan a
        -1.16 y las raíces atravesaban el suelo por abajo. En los dos casos
        se perdía lo único que este disco tiene que hacer, que es dar la
        sensación de que el árbol está apoyado en algo.

        Ahora la altura y el tamaño siguen la escala dibujada, así que el
        contacto se mantiene en cualquier etapa.
      */}
      <group ref={sueloRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.08, 0]} material={groundMaterial}>
          <circleGeometry args={[5.6, 64]} />
        </mesh>

        {/*
          Segundo halo, chico y apretado, justo donde las raíces se hunden.
          El disco grande da ambiente; este da CONTACTO. Sin él el árbol se
          lee sobre una mancha de luz, no dentro de ella.
        */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -1.02, 0]}
          material={contactoMaterial}
        >
          <circleGeometry args={[2.5, 48]} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Telón de fondo: una mancha de luz elíptica, descentrada y en diagonal.
 * Descentrada a propósito — un halo perfectamente centrado detrás del sujeto
 * se lee como viñeta de plantilla, no como iluminación de sala.
 */
function makeBackdropTexture(): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) return new THREE.Texture()

  const grad = ctx.createRadialGradient(
    size * 0.42,
    size * 0.38,
    0,
    size * 0.5,
    size * 0.5,
    size * 0.52,
  )
  grad.addColorStop(0, 'rgba(18, 111, 245, 0.34)')
  grad.addColorStop(0.3, 'rgba(40, 70, 159, 0.22)')
  grad.addColorStop(0.62, 'rgba(13, 63, 176, 0.08)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Halo radial del suelo, generado en canvas. */
function makeGroundTexture(): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) return new THREE.Texture()

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(37, 211, 102, 0.5)')
  grad.addColorStop(0.16, 'rgba(18, 111, 245, 0.26)')
  grad.addColorStop(0.42, 'rgba(40, 70, 159, 0.12)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
