import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { BlendFunction, type BloomEffect } from 'postprocessing'
import * as THREE from 'three'
import TreeStructure from './TreeStructure'
import Leaves from './Leaves'
import Journey from './Journey'
import FallingFruit from './FallingFruit'
import Atmosphere from './Atmosphere'
import CelebrationBurst from './CelebrationBurst'
import FloatingLabels from './FloatingLabels'
import Diagnostics, { type DiagInfo } from './Diagnostics'
import type { GrowthProfile, Idea } from '../../lib/types'

interface Props {
  /** Todas las publicadas: alimentan etiquetas y contadores. */
  ideas: Idea[]
  /** Sólo las que ocupan hoja. Único conteo válido para los slots. */
  propuestas: Idea[]
  activeIdea: Idea | null
  /** Crítica cayendo hacia las raíces, o null. */
  criticaCayendo: Idea | null
  /** Sube de a uno cuando una crítica toca la tierra. */
  pulsoRaices: number
  growth: GrowthProfile
  celebration: number | null
  quality: 'alta' | 'media'
  /** Ctrl+H del operador: oculta el texto sin frenar la instalacion. */
  labelsVisible: boolean
  /** Permite apagar el postprocesado (?fx=off) para aislar problemas. */
  postprocessing: boolean
  onDiagnostics?: (d: DiagInfo) => void
}

export default function TreeScene({
  ideas,
  propuestas,
  activeIdea,
  criticaCayendo,
  pulsoRaices,
  growth,
  celebration,
  quality,
  labelsVisible,
  postprocessing,
  onDiagnostics,
}: Props) {
  // Cuántas hojas de la categoría entrante ya están plantadas: define el slot
  // exacto al que va a viajar la partícula.
  // Se cuenta sobre `propuestas`, NUNCA sobre `ideas`: una crítica no
  // ocupa slot, y contarla acá correría todas las hojas de esa rama.
  const indexInCategory = useMemo(() => {
    if (!activeIdea) return 0
    return propuestas.reduce((n, i) => (i.category === activeIdea.category ? n + 1 : n), 0)
  }, [propuestas, activeIdea])

  const bloomRef = useRef<BloomEffect | null>(null)

  return (
    <>
      <color attach="background" args={['#050a12']} />
      {/* Niebla lejana y suave: da profundidad sin apagar la copa. */}
      <fog attach="fog" args={['#071220', 9.5, 21]} />

      <CameraRig celebration={celebration} />

      <Atmosphere growth={growth} />

      {/*
        Todo el árbol vive dentro del mismo grupo escalado: estructura,
        follaje, partícula y etiquetas crecen juntos. Si escalara sólo la
        estructura, las hojas quedarían flotando fuera de sus ramas.
      */}
      <GrowthRig scale={growth.canopyScale}>
        <TreeStructure
          growth={growth}
          highlightSlug={activeIdea?.category ?? null}
          pulsoRaices={pulsoRaices}
        />
        <Leaves ideas={propuestas} growth={growth} />
        <Journey idea={activeIdea} indexInCategory={indexInCategory} />

        {/* La crítica hace el camino inverso: cae y alimenta las raíces. */}
        <FallingFruit idea={criticaCayendo} />
        <FloatingLabels ideas={ideas} visible={labelsVisible} />
        <CelebrationBurst trigger={celebration} />
      </GrowthRig>

      {onDiagnostics && <Diagnostics onSample={onDiagnostics} />}

      {postprocessing && (
        <>
          {/*
            El driver del bloom va FUERA del composer. EffectComposer arma su
            pasada a partir de los objetos hijos, así que sus hijos directos
            deben ser efectos y nada más; un componente propio en el medio es
            un buen modo de quedarse sin imagen.
          */}
          <BloomDriver target={bloomRef} celebration={celebration} growth={growth} />

          <EffectComposer multisampling={quality === 'alta' ? 2 : 0}>
            <Bloom
              ref={bloomRef}
              intensity={0.85}
              luminanceThreshold={0.16}
              luminanceSmoothing={0.36}
              mipmapBlur
              radius={quality === 'alta' ? 0.72 : 0.55}
            />
            <Vignette eskil={false} offset={0.28} darkness={0.62} blendFunction={BlendFunction.NORMAL} />
          </EffectComposer>
        </>
      )}
    </>
  )
}

/**
 * Escala del árbol según la etapa de crecimiento.
 *
 * El origen está en la base del tronco, así que escalar desde ahí mantiene
 * el pie apoyado y hace crecer la copa hacia arriba y las raíces hacia
 * abajo, que es como crece un árbol.
 *
 * La interpolación es muy lenta a propósito: entre una idea y la siguiente
 * el cambio de escala es imperceptible, y a lo largo de una jornada de expo
 * el árbol se agranda de verdad. Un salto de tamaño al cruzar el umbral de
 * una etapa se leería como un error de render.
 */
function GrowthRig({ scale, children }: { scale: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const readyRef = useRef(false)

  useFrame(() => {
    const group = ref.current
    if (!group) return

    // El primer cuadro toma el valor exacto: al cargar no se ve "crecer"
    // desde cero un árbol que ya tiene doscientas ideas.
    if (!readyRef.current) {
      group.scale.setScalar(scale)
      readyRef.current = true
      return
    }

    group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, scale, 0.01))
  })

  return <group ref={ref}>{children}</group>
}

/**
 * Órbita lenta y continua alrededor del árbol.
 *
 * Un plano fijo se lee como una imagen; el movimiento sostenido es lo que
 * hace que alguien que pasa de reojo gire la cabeza. La vuelta completa
 * demora ~100 s: se nota que está vivo, pero no marea a quien mira un rato.
 */
function CameraRig({ celebration }: { celebration: number | null }) {
  const { camera } = useThree()
  const timeRef = useRef(0)
  const celebrationRef = useRef(0)
  const lastCelebration = useRef<number | null>(null)
  // Sin la banda inferior del QR, el árbol se centra un poco más abajo y se
  // ven las raíces completas. Si el QR vuelve, subir esto a 2.15.
  const target = useMemo(() => new THREE.Vector3(0, 2.05, 0), [])

  if (celebration !== lastCelebration.current) {
    lastCelebration.current = celebration
    if (celebration !== null) celebrationRef.current = 1
  }

  useFrame((_, delta) => {
    timeRef.current += delta
    const t = timeRef.current

    celebrationRef.current = Math.max(0, celebrationRef.current - delta / 5)
    const celebrating = celebrationRef.current

    /*
     * La órbita no es uniforme a propósito.
     *
     * Una vuelta a velocidad constante en un círculo perfecto se lee como
     * un objeto en un visor de modelos 3D. Sumarle una oscilación lenta a la
     * velocidad angular, y desfasar la altura respecto del radio, hace que
     * el movimiento parezca intención y no un motor girando.
     */
    const angle = t * 0.055 + Math.sin(t * 0.083) * 0.34
    const radius = 7.0 + Math.sin(t * 0.117 + 1.4) * 0.55 + celebrating * 1.5
    const height = 2.5 + Math.sin(t * 0.071) * 0.42 + celebrating * 0.5

    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)

    // El punto de mira también deriva: la copa no queda clavada en el centro.
    camera.lookAt(
      target.x + Math.sin(t * 0.047) * 0.16,
      target.y + Math.sin(t * 0.061) * 0.12,
      target.z + Math.cos(t * 0.053) * 0.16,
    )
  })

  return null
}

/**
 * Sube el bloom durante los hitos y lo acompaña con la etapa de crecimiento.
 *
 * Es un componente sin geometría que sólo muta el efecto por referencia. Vive
 * fuera del EffectComposer a propósito: el composer arma su pasada con los
 * objetos que cuelgan de él y espera efectos, no componentes cualquiera.
 */
function BloomDriver({
  target,
  celebration,
  growth,
}: {
  target: React.RefObject<BloomEffect | null>
  celebration: number | null
  growth: GrowthProfile
}) {
  const boostRef = useRef(0)
  const lastCelebration = useRef<number | null>(null)

  if (celebration !== lastCelebration.current) {
    lastCelebration.current = celebration
    if (celebration !== null) boostRef.current = 1
  }

  useFrame((_, delta) => {
    boostRef.current = Math.max(0, boostRef.current - delta / 4.2)
    const effect = target.current
    if (!effect) return

    const base = 0.62 + growth.glowIntensity * 0.28
    effect.intensity = base + boostRef.current * 1.5
  })

  return null
}
