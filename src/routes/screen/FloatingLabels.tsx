import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { placeLeaf } from './leafPlacement'
import { getCategory } from '../../lib/categories'
import { pickNextIdea } from './labelRotation'
import { resolverColisiones } from './labelLayout'
import type { Idea } from '../../lib/types'

/** Cuántas ideas se muestran a la vez alrededor de la copa. */
const SLOT_COUNT = 3
/** Cada cuánto rota UNA etiqueta. Con 3 slots, cada una dura ~21 s. */
const ROTATE_MS = 7000
/** Cada cuánto se recalcula el "Hace N min". */
const CLOCK_MS = 30_000
/** Cuánto se separa cada etiqueta del follaje, por slot. */
const REACH = [1.75, 2.2, 2.65]
/** Aire mínimo entre dos etiquetas, en píxeles de pantalla. */
const MARGEN = 14

interface Props {
  ideas: Idea[]
  /** Ctrl+H del operador: oculta el texto sin frenar la instalación. */
  visible?: boolean
}

interface SlotState {
  idea: Idea | null
  fresh: boolean
  revision: number
}

/** Lo que cada etiqueta publica para que el padre resuelva las colisiones. */
interface Registro {
  div: HTMLDivElement | null
  linea: THREE.Object3D | null
  ancla: THREE.Vector3
  /** Dirección de la hoja en el plano del suelo, para atenuar las de atrás. */
  plano: THREE.Vector3
  destacada: boolean
  /** Desplazamiento vertical aplicado, interpolado entre cuadros. */
  offset: number
}

const EMPTY_SLOTS: SlotState[] = Array.from({ length: SLOT_COUNT }, () => ({
  idea: null,
  fresh: false,
  revision: 0,
}))

/**
 * Etiquetas de ideas ancladas a su hoja con una línea fina.
 *
 * Rotan sobre todo el histórico, no sobre las últimas tres: si nadie
 * participa un rato la pantalla no queda congelada, y una idea de la mañana
 * vuelve a verse a la tarde.
 *
 * Van deliberadamente chicas. El protagonista es el árbol; esto es el
 * subtitulado, no el titular.
 */
export default function FloatingLabels({ ideas, visible = true }: Props) {
  const [slots, setSlots] = useState<SlotState[]>(EMPTY_SLOTS)
  const [, setTick] = useState(0)

  const ideasRef = useRef(ideas)
  ideasRef.current = ideas

  const cursorRef = useRef(0)
  const nextSlotRef = useRef(0)
  const rotateSlotRef = useRef(0)
  const revisionRef = useRef(0)
  const newestIdRef = useRef<string | null>(null)

  /** Registro compartido: una entrada por slot. */
  const registro = useRef<Array<Registro | null>>(
    Array.from({ length: SLOT_COUNT }, () => null),
  )

  const publicar = useCallback((slot: number, entrada: Registro | null) => {
    registro.current[slot] = entrada
  }, [])

  // ---- Colocación y colisiones, en un solo lugar ---------------------
  useLayoutResolver(registro)

  // ---- Rotación y ciclo de vida de los slots -------------------------
  const assign = useCallback((slotIndex: number, idea: Idea, fresh: boolean) => {
    revisionRef.current += 1
    const revision = revisionRef.current
    setSlots((prev) =>
      prev.map((slot, i) => (i === slotIndex ? { idea, fresh, revision } : slot)),
    )
  }, [])

  useEffect(() => {
    setSlots((prev) => {
      if (prev.some((s) => s.idea)) return prev
      const recent = ideasRef.current.slice(-SLOT_COUNT)
      if (recent.length === 0) return prev

      revisionRef.current += recent.length
      cursorRef.current = recent.length

      return prev.map((slot, i) => {
        const idea = recent[recent.length - 1 - i]
        return idea ? { idea, fresh: false, revision: revisionRef.current + i } : slot
      })
    })
  }, [ideas.length])

  // Idea recién llegada: entra ya, sin esperar la rotación.
  useEffect(() => {
    const newest = ideas[ideas.length - 1]
    if (!newest) return

    if (newestIdRef.current === null) {
      newestIdRef.current = newest.id
      return
    }
    if (newest.id === newestIdRef.current) return
    newestIdRef.current = newest.id

    const slotIndex = nextSlotRef.current % SLOT_COUNT
    nextSlotRef.current = slotIndex + 1
    assign(slotIndex, newest, true)
  }, [ideas, assign])

  /*
   * Purga de ideas retiradas: lo que el equipo modera tiene que irse de la
   * pantalla completo, texto incluido, no quedar flotando apuntando a una
   * hoja que ya no existe.
   */
  useEffect(() => {
    const vigentes = new Set(ideas.map((i) => i.id))

    setSlots((prev) => {
      if (!prev.some((s) => s.idea && !vigentes.has(s.idea.id))) return prev

      const visibles = new Set(
        prev.filter((s) => s.idea && vigentes.has(s.idea.id)).map((s) => s.idea!.id),
      )

      return prev.map((slot) => {
        if (!slot.idea || vigentes.has(slot.idea.id)) return slot

        const reemplazo = pickNextIdea(ideas, visibles, cursorRef.current)
        revisionRef.current += 1

        if (!reemplazo) return { idea: null, fresh: false, revision: revisionRef.current }

        cursorRef.current = reemplazo.cursor
        visibles.add(reemplazo.idea.id)
        return { idea: reemplazo.idea, fresh: false, revision: revisionRef.current }
      })
    })
  }, [ideas])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlots((prev) => {
        const slotIndex = rotateSlotRef.current % SLOT_COUNT
        rotateSlotRef.current = slotIndex + 1

        const visibles = new Set(
          prev.map((s) => s.idea?.id).filter((id): id is string => Boolean(id)),
        )
        const saliente = prev[slotIndex].idea
        if (saliente) visibles.delete(saliente.id)

        const elegida = pickNextIdea(ideasRef.current, visibles, cursorRef.current)
        if (!elegida) return prev
        cursorRef.current = elegida.cursor

        revisionRef.current += 1
        const revision = revisionRef.current

        return prev.map((slot, i) =>
          i === slotIndex ? { idea: elegida.idea, fresh: false, revision } : slot,
        )
      })
    }, ROTATE_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])

  if (!visible) return null

  return (
    <group>
      {slots.map((slot, i) =>
        slot.idea ? (
          <LabelAnchor
            key={`${i}-${slot.revision}`}
            idea={slot.idea}
            ideas={ideas}
            slotIndex={i}
            fresh={slot.fresh}
            publicar={publicar}
          />
        ) : null,
      )}
    </group>
  )
}

/**
 * Resuelve posición y colisiones de todas las etiquetas, una vez por cuadro.
 *
 * Está centralizado a propósito. Cuando cada etiqueta se acomodaba sola no
 * había forma de que supiera dónde estaban las otras, y dos ideas que caían
 * en hojas cercanas terminaban con los textos encimados e ilegibles —
 * exactamente lo que pasaba arriba a la izquierda del árbol.
 *
 * El desplazamiento se interpola entre cuadros: la cámara orbita, así que el
 * orden vertical de las etiquetas cambia, y sin suavizado los textos
 * saltarían de lugar cada vez que se cruzan.
 */
function useLayoutResolver(registro: React.RefObject<Array<Registro | null>>) {
  const { camera, size } = useThree()
  const plano = useMemo(() => new THREE.Vector3(), [])
  const proyectado = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const entradas = (registro.current ?? []).filter(
      (e): e is Registro => e !== null && e.div !== null,
    )
    if (entradas.length === 0) return

    // --- 1. Proyección a coordenadas de pantalla --------------------
    plano.set(camera.position.x, 0, camera.position.z)
    if (plano.lengthSq() > 0.0001) plano.normalize()

    const cajas = entradas.map((e) => {
      proyectado.copy(e.ancla).project(camera)

      const y = (-proyectado.y * 0.5 + 0.5) * size.height
      const alto = e.div!.offsetHeight || 44

      // Atenuación de las que quedaron del lado de atrás del árbol. Sin
      // esto una idea de la cara oculta flota por delante del tronco.
      const encara = plano.dot(e.plano)
      const opacidad = THREE.MathUtils.smoothstep(encara, -0.25, 0.4)

      return { entrada: e, y, alto, opacidad }
    })

    // --- 2. Resolución de colisiones -------------------------------
    const objetivos = resolverColisiones(
      cajas.map((c) => ({ y: c.y, alto: c.alto, visible: c.opacidad >= 0.08 })),
      MARGEN,
    )

    // Interpolado: la cámara orbita y el orden vertical de las etiquetas
    // cambia, así que sin suavizado los textos saltarían al cruzarse.
    cajas.forEach((caja, i) => {
      caja.entrada.offset = THREE.MathUtils.lerp(caja.entrada.offset, objetivos[i], 0.12)
    })

    // --- 3. Aplicación al DOM y a la línea -------------------------
    for (const caja of cajas) {
      const { entrada, opacidad } = caja
      const div = entrada.div!

      div.style.opacity = String(opacidad)
      /*
       * `translate` y no `transform`: la animación de entrada de la
       * etiqueta usa transform, y una animación CSS le gana en prioridad a
       * un estilo en línea mientras corre. Con propiedades separadas las
       * dos cosas conviven sin pisarse.
       */
      div.style.translate =
        Math.abs(entrada.offset) > 0.5 ? `0 ${entrada.offset.toFixed(1)}px` : ''

      const linea = entrada.linea as THREE.Line | null
      if (linea) {
        const material = linea.material as THREE.Material
        material.opacity = opacidad * (entrada.destacada ? 0.85 : 0.4)
      }
    }
  })
}

// ---------------------------------------------------------------------

function LabelAnchor({
  idea,
  ideas,
  slotIndex,
  fresh,
  publicar,
}: {
  idea: Idea
  ideas: Idea[]
  slotIndex: number
  fresh: boolean
  publicar: (slot: number, entrada: Registro | null) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<THREE.Object3D>(null)
  const category = getCategory(idea.category)

  // Posición de la hoja: hace falta saber qué número de hoja es dentro de su
  // categoría, que es lo que determina en qué punto de la rama cayó.
  const geometry = useMemo(() => {
    let indexInCategory = 0
    let encontrada = false

    for (const other of ideas) {
      if (other.id === idea.id) {
        encontrada = true
        break
      }
      if (other.category === idea.category) indexInCategory++
    }

    // Si la idea ya no está en la lista, el conteo habría devuelto el total
    // de la categoría y la etiqueta apuntaría a una hoja que no es la suya.
    if (!encontrada) return null

    const leaf = placeLeaf(idea, indexInCategory).position

    const radial = new THREE.Vector3(leaf.x, 0, leaf.z)
    if (radial.lengthSq() < 0.01) radial.set(1, 0, 0)
    radial.normalize()

    const anchor = leaf
      .clone()
      .addScaledVector(radial, REACH[slotIndex] ?? REACH[0])
      .add(new THREE.Vector3(0, 0.34 + slotIndex * 0.2, 0))

    return {
      leaf,
      anchor,
      points: [leaf, anchor],
      plano: new THREE.Vector3(leaf.x, 0, leaf.z).normalize(),
    }
  }, [idea, ideas, slotIndex])

  // Se registra para que el resolvedor central la ubique.
  useEffect(() => {
    if (!geometry) {
      publicar(slotIndex, null)
      return
    }

    publicar(slotIndex, {
      div: holderRef.current,
      linea: lineRef.current,
      ancla: geometry.anchor,
      plano: geometry.plano,
      destacada: fresh,
      offset: 0,
    })

    return () => publicar(slotIndex, null)
  }, [geometry, slotIndex, fresh, publicar])

  if (!geometry) return null

  return (
    <group>
      <Line
        ref={lineRef as never}
        points={geometry.points}
        color={category.color}
        lineWidth={fresh ? 1.6 : 1}
        transparent
        opacity={0.4}
        toneMapped={false}
      />

      {/* Punto sobre la hoja de origen. */}
      <mesh position={geometry.leaf}>
        <sphereGeometry args={[fresh ? 0.032 : 0.02, 8, 8]} />
        <meshBasicMaterial color={category.color} toneMapped={false} />
      </mesh>

      <Html position={geometry.anchor} center zIndexRange={[8, 0]} pointerEvents="none">
        <div
          ref={holderRef}
          className={`tag ${fresh ? 'tag--new' : ''}`}
          style={{ ['--tag' as string]: category.color }}
        >
          <span className="tag__head">
            <span className="tag__emoji">{category.emoji}</span>
            <span className="tag__cat">{category.label}</span>
          </span>
          <span className="tag__text">{idea.text}</span>
          <span className="tag__time">{relativeTime(idea.created_at)}</span>
        </div>
      </Html>
    </group>
  )
}

/** "Recién", "Hace 3 min", "Hace 2 h". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)

  if (minutes < 1) return 'Recién'
  if (minutes === 1) return 'Hace 1 min'
  if (minutes < 60) return `Hace ${minutes} min`

  const hours = Math.floor(minutes / 60)
  return hours === 1 ? 'Hace 1 h' : `Hace ${hours} h`
}
