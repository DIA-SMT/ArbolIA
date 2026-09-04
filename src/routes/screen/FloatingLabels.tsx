import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { placeLeaf } from './leafPlacement'
import { getCategory } from '../../lib/categories'
import { siguienteTurno } from './labelRotation'
import { acomodar, type Zona } from './labelLayout'
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

/**
 * Los bloques del overlay que una etiqueta no puede tapar.
 *
 * Se piden al DOM en vez de tenerlos escritos: sus posiciones dependen del
 * tamaño de la pantalla y del contenido, así que cualquier número fijo
 * quedaría viejo en cuanto el LED del stand tuviera otra resolución que el
 * monitor donde se probó.
 *
 * Se listan los bloques PINTADOS y no sus contenedores: overlay__left y
 * overlay__right ocupan toda la altura de la pantalla pero están vacíos en
 * el medio, y prohibir esa franja entera dejaría a las etiquetas sin los
 * costados, que es justo donde el árbol las manda.
 *
 * OJO AL AGREGAR O QUITAR BLOQUES. Cuando el QR reemplazó al ranking por
 * área, esta lista quedó nombrando .areas —que ya no existe— y sin nombrar
 * .qr: el único elemento de la pantalla que el vecino NECESITA pasó a ser el
 * único que una etiqueta podía tapar. Nada avisa cuando falta uno; el
 * síntoma es una tarjeta encima.
 */
const SELECTOR_PANELES = '.overlay__top, .ask, .panel, .qr, .recent'

function zonasProhibidas(): Zona[] {
  const zonas: Zona[] = []
  for (const el of document.querySelectorAll(SELECTOR_PANELES)) {
    const r = el.getBoundingClientRect()
    if (r.width < 20 || r.height < 20) continue
    zonas.push({ izq: r.left, der: r.right, arriba: r.top, abajo: r.bottom })
  }
  return zonas
}

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

/**
 * Lo que cada etiqueta publica para que el padre resuelva las colisiones.
 *
 * Se guardan las REFERENCIAS, no su contenido. Parece un detalle y no lo
 * es: el div vive dentro del <Html> de drei, que portalea su contenido en
 * su propio efecto. Cuando esta etiqueta se registraba, el nodo todavía no
 * existía, así que se guardaba null y el resolvedor la descartaba para
 * siempre — las etiquetas se pisaban en pantalla mientras el resolvedor,
 * que está bien y tiene sus propias pruebas, no recibía ninguna caja.
 */
interface Registro {
  divRef: React.RefObject<HTMLDivElement | null>
  lineaRef: React.RefObject<THREE.Object3D | null>
  /**
   * Un objeto vacío puesto en el punto de anclaje, DENTRO de la escena.
   *
   * No alcanza con guardar el vector: las etiquetas cuelgan del grupo que
   * escala con el crecimiento del árbol, así que la posición local no es la
   * posición real. Proyectando el vector suelto, el resolvedor calculaba
   * coordenadas de pantalla que no eran donde la etiqueta estaba y no veía
   * ninguna superposición. Pidiéndole la posición de mundo a un objeto de
   * la escena, cualquier transformación de los padres queda incluida.
   */
  anclaRef: React.RefObject<THREE.Object3D | null>
  /** Dirección de la hoja en el plano del suelo, para atenuar las de atrás. */
  plano: THREE.Vector3
  destacada: boolean
  /** Desplazamiento vertical aplicado, interpolado entre cuadros. */
  offset: number
  /** Desplazamiento horizontal: hace falta para esquivar los paneles fijos,
   *  contra los que bajar no sirve de nada. */
  offsetX: number
  /** No hay lugar donde ponerla sin tapar algo: se apaga. */
  sinLugar: boolean
  /** Ya pasó por el resolvedor al menos una vez. La primera ubicación se
   *  aplica sin interpolar, para que no se dibuje fuera de lugar. */
  ubicada: boolean
  /** Punto de la hoja, origen de la línea guía. */
  hojaRef: React.RefObject<THREE.Vector3 | null>
  /** Punta de la línea guía: sigue a la tarjeta cuando ésta se corre. */
  puntaRef: React.RefObject<THREE.Vector3 | null>
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
  /** Las que ya tuvieron su turno en la ronda actual. */
  const mostradasRef = useRef<Set<string>>(new Set())
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

  /*
   * Espejo del estado para poder decidir FUERA del actualizador.
   *
   * El descanso entre rondas necesita leer si todas las etiquetas están
   * vacías y tocar refs. Hacer eso dentro de setSlots sería un efecto
   * secundario en una función que React puede volver a ejecutar.
   */
  const slotsRef = useRef(slots)
  slotsRef.current = slots

  // ---- Colocación y colisiones, en un solo lugar ---------------------
  useLayoutResolver(registro)

  // ---- Rotación y ciclo de vida de los slots -------------------------
  const assign = useCallback((slotIndex: number, idea: Idea, fresh: boolean) => {
    mostradasRef.current.add(idea.id)
    revisionRef.current += 1
    const revision = revisionRef.current
    setSlots((prev) =>
      prev.map((slot, i) => (i === slotIndex ? { idea, fresh, revision } : slot)),
    )
  }, [])

  useEffect(() => {
    setSlots((prev) => {
      if (prev.some((s) => s.idea)) return prev
      /*
       * Sólo en el arranque de verdad.
       *
       * "Todos los slots vacíos" no significa siempre "recién cargó":
       * también queda así cuando la moderación retira todo lo que estaba
       * en pantalla. Sin esta condición, la idea siguiente rellenaría las
       * tres etiquetas con las últimas del histórico, repitiendo las que
       * ya tuvieron su turno en la ronda en curso.
       */
      if (mostradasRef.current.size > 0) return prev

      const recent = ideasRef.current.slice(-SLOT_COUNT)
      if (recent.length === 0) return prev

      revisionRef.current += recent.length
      cursorRef.current = recent.length

      recent.forEach((i) => mostradasRef.current.add(i.id))

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

    /*
     * La rotación sigue desde el slot SIGUIENTE al que acaba de recibirla.
     *
     * Sin esto, una idea recién llegada podía caer justo en el slot que
     * estaba por rotar y durarle un solo tic: aparecía y a los siete
     * segundos ya no estaba. Es el peor momento posible para que eso pase,
     * porque quien acaba de enviarla está mirando la pantalla buscándola.
     * Corriendo el turno, se lleva la vuelta entera.
     */
    rotateSlotRef.current = slotIndex + 1

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

        // Mismo criterio que la rotación: si la ronda se agotó, empieza
        // otra en vez de dejar el hueco. El slot sólo se apaga cuando de
        // verdad no queda ninguna propuesta para poner ahí.
        const reemplazo = siguienteTurno(
          ideas,
          visibles,
          cursorRef.current,
          mostradasRef.current,
          slot.idea,
        )
        revisionRef.current += 1

        if (!reemplazo) return { idea: null, fresh: false, revision: revisionRef.current }

        cursorRef.current = reemplazo.cursor
        mostradasRef.current = reemplazo.mostradas
        visibles.add(reemplazo.idea.id)
        return { idea: reemplazo.idea, fresh: false, revision: revisionRef.current }
      })
    })
  }, [ideas])

  /*
   * Rotación por rondas.
   *
   * Cada propuesta hace UN turno por ronda: cuando le toca a un slot, se
   * busca una que todavía no haya salido. Antes se elegía del histórico
   * completo, así que con tres ideas cargadas las mismas tres cards giraban
   * entre ellas para siempre y la pantalla parecía trabada.
   *
   * Agotada la ronda, la siguiente empieza en el acto. Esto es lo que
   * cambió: antes el slot se vaciaba y la copa se quedaba limpia tres
   * minutos. Con el árbol recién arrancado el resultado era que las
   * etiquetas se apagaban de a una hasta quedar UNA sola —la más vieja— y
   * después nada, justo cuando el vecino que acababa de mandar su idea
   * estaba mirando.
   *
   * La decisión se toma FUERA del actualizador. Elegir el turno mueve el
   * cursor y la memoria de la ronda, y React puede volver a ejecutar la
   * función que se le pasa a setSlots: hacerlo adentro era adelantar el
   * cursor dos veces y saltearse una propuesta.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const actuales = slotsRef.current
      const slotIndex = rotateSlotRef.current % SLOT_COUNT
      rotateSlotRef.current = slotIndex + 1

      const visibles = new Set(
        actuales.map((s) => s.idea?.id).filter((id): id is string => Boolean(id)),
      )
      const saliente = actuales[slotIndex].idea
      if (saliente) visibles.delete(saliente.id)

      const turno = siguienteTurno(
        ideasRef.current,
        visibles,
        cursorRef.current,
        mostradasRef.current,
        saliente,
      )

      /*
       * No hay ninguna otra propuesta para este slot: el que está se queda.
       *
       * Pasa cuando hay tres ideas cargadas o menos, o sea al principio de
       * la jornada. Quietas dicen lo que hay; vacías dicen que el árbol
       * dejó de escuchar. Las retiradas por moderación no salen por acá:
       * de eso se ocupa la purga, que sí vacía el slot.
       */
      if (!turno) return

      cursorRef.current = turno.cursor
      mostradasRef.current = turno.mostradas
      revisionRef.current += 1
      const revision = revisionRef.current
      const entrante = turno.idea

      setSlots((prev) =>
        prev.map((slot, i) =>
          i === slotIndex ? { idea: entrante, fresh: false, revision } : slot,
        ),
      )
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
  const destino = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const publicadas = (registro.current ?? []).filter((e): e is Registro => e !== null)
    const entradas = publicadas.filter(
      (e) => e.divRef.current !== null && e.anclaRef.current !== null,
    )

    if (entradas.length === 0) {
      // Si hay etiquetas registradas pero ninguna con nodo, el cableado se
      // rompió: el resolvedor no recibe cajas y los textos se pisan en la
      // pantalla del stand sin que nada falle.
      if (import.meta.env.DEV && publicadas.length > 0) {
        console.warn(
          '[arbolia] Hay etiquetas registradas pero sin nodo en el DOM: ' +
            'el resolvedor de colisiones no puede ubicarlas.',
        )
      }
      return
    }

    // --- 1. Proyección a coordenadas de pantalla --------------------
    plano.set(camera.position.x, 0, camera.position.z)
    if (plano.lengthSq() > 0.0001) plano.normalize()

    const cajas = entradas.map((e) => {
      // Posición de mundo: incluye la escala del grupo del árbol.
      e.anclaRef.current!.getWorldPosition(proyectado)
      proyectado.project(camera)

      const y = (-proyectado.y * 0.5 + 0.5) * size.height
      const x = (proyectado.x * 0.5 + 0.5) * size.width
      const nodo = e.divRef.current!
      const alto = nodo.offsetHeight || 44
      const ancho = nodo.offsetWidth || 150

      // Atenuación de las que quedaron del lado de atrás del árbol. Sin
      // esto una idea de la cara oculta flota por delante del tronco.
      const encara = plano.dot(e.plano)
      const opacidad = THREE.MathUtils.smoothstep(encara, -0.25, 0.4)

      return { entrada: e, x, ancho, y, alto, opacidad }
    })

    // --- 2. Acomodo: etiquetas, paneles fijos y bordes --------------
    const objetivos = acomodar(
      cajas.map((c) => ({
        x: c.x,
        ancho: c.ancho,
        y: c.y,
        alto: c.alto,
        visible: c.opacidad >= 0.08,
      })),
      zonasProhibidas(),
      { ancho: size.width, alto: size.height },
      MARGEN,
    )

    // Interpolado: la cámara orbita y el orden vertical de las etiquetas
    // cambia, así que sin suavizado los textos saltarían al cruzarse.
    cajas.forEach((caja, i) => {
      const e = caja.entrada
      /*
       * La PRIMERA ubicación no se interpola: se aplica.
       *
       * El suavizado existe porque la cámara orbita y el orden vertical de
       * las etiquetas cambia; sin él los textos saltarían al cruzarse. Pero
       * una etiqueta recién aparecida arranca con desplazamiento cero, o sea
       * dibujada exactamente donde el resolvedor decidió que NO va, y tarda
       * unos cuadros en llegar a su lugar. En esos cuadros puede estar
       * encima de la vecina, y una foto de la pantalla la agarra ahí.
       *
       * Apareciendo ya ubicada no hay nada que suavizar: la etiqueta entra
       * con su animación de opacidad en el lugar correcto.
       */
      if (!e.ubicada) {
        e.offset = objetivos[i].dy
        e.offsetX = objetivos[i].dx
        e.ubicada = true
      } else {
        e.offset = THREE.MathUtils.lerp(e.offset, objetivos[i].dy, 0.3)
        e.offsetX = THREE.MathUtils.lerp(e.offsetX, objetivos[i].dx, 0.3)
      }
      e.sinLugar = objetivos[i].oculta
    })

    // --- 3. Aplicación al DOM y a la línea -------------------------
    for (const caja of cajas) {
      const { entrada } = caja
      const div = entrada.divRef.current!

      /*
       * Una etiqueta sin lugar se apaga.
       *
       * Es la última opción y por eso se decide acá y no en el acomodo: si
       * no hay dónde ponerla sin tapar el ranking o el título, es preferible
       * una idea menos en pantalla que una idea ilegible encima de otra cosa.
       */
      const opacidad = entrada.sinLugar ? 0 : caja.opacidad

      div.style.opacity = String(opacidad)
      /*
       * `translate` y no `transform`: la animación de entrada de la
       * etiqueta usa transform, y una animación CSS le gana en prioridad a
       * un estilo en línea mientras corre. Con propiedades separadas las
       * dos cosas conviven sin pisarse.
       */
      const movida = Math.abs(entrada.offset) > 0.5 || Math.abs(entrada.offsetX) > 0.5
      div.style.translate = movida
        ? `${entrada.offsetX.toFixed(1)}px ${entrada.offset.toFixed(1)}px`
        : ''

      const linea = entrada.lineaRef.current as THREE.Line | null
      if (linea) {
        const material = linea.material as THREE.Material
        material.opacity = opacidad * (entrada.destacada ? 0.85 : 0.4)

        /*
         * La línea tiene que terminar DONDE QUEDÓ la tarjeta, no donde está
         * el ancla.
         *
         * Antes el desplazamiento era sólo vertical y de pocos píxeles, así
         * que el desfase no se notaba. Ahora una etiqueta puede correrse
         * doscientos píxeles para esquivar un panel, y una línea apuntando
         * al vacío es peor que la superposición que vino a arreglar.
         *
         * Se toma la posición final en pantalla y se la devuelve al mundo a
         * la misma profundidad del ancla, así el extremo cae exactamente
         * detrás de la tarjeta.
         */
        const ancla = entrada.anclaRef.current
        const punta = entrada.puntaRef.current
        const hoja = entrada.hojaRef.current

        if (ancla && punta && hoja) {
          ancla.getWorldPosition(destino)

          if (movida) {
            // Al espacio de pantalla, se aplica el corrimiento de la
            // tarjeta, y de vuelta al mundo a la misma profundidad.
            destino.project(camera)
            destino.x += (entrada.offsetX / size.width) * 2
            destino.y -= (entrada.offset / size.height) * 2
            destino.unproject(camera)
          }

          /*
           * DE MUNDO A LOCAL. Este paso faltaba y era el bug.
           *
           * La geometría de la línea vive dentro del grupo que escala con el
           * crecimiento del árbol, así que sus coordenadas son LOCALES.
           * Escribir ahí una posición de mundo la divide de hecho por la
           * escala del grupo: con el árbol en 0.526, el extremo terminaba a
           * casi la mitad de altura del ancla. Medido, las líneas salían de
           * la hoja a y≈4.2 y morían en y≈2.4, apuntando hacia abajo y hacia
           * el tronco en vez de a la tarjeta. En pantalla parecía que no
           * había líneas.
           */
          linea.parent?.worldToLocal(destino)
          punta.copy(destino)

          const geo = (linea as unknown as {
            geometry?: { setPositions?: (p: number[]) => void }
          }).geometry

          if (geo?.setPositions) {
            geo.setPositions([hoja.x, hoja.y, hoja.z, punta.x, punta.y, punta.z])
          }
        }
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
  const anclaRef = useRef<THREE.Object3D>(null)
  const lineRef = useRef<THREE.Object3D>(null)
  const hojaRef = useRef<THREE.Vector3 | null>(null)
  const puntaRef = useRef<THREE.Vector3 | null>(null)
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
      // La línea se reescribe cuadro a cuadro para seguir a la tarjeta, así
      // que estos dos vectores son su estado, no una copia decorativa.
      hoja: leaf.clone(),
      punta: anchor.clone(),
      plano: new THREE.Vector3(leaf.x, 0, leaf.z).normalize(),
    }
  }, [idea, ideas, slotIndex])

  // Se registra para que el resolvedor central la ubique.
  useEffect(() => {
    if (!geometry) {
      publicar(slotIndex, null)
      return
    }

    hojaRef.current = geometry.hoja
    puntaRef.current = geometry.punta

    publicar(slotIndex, {
      divRef: holderRef,
      lineaRef: lineRef,
      anclaRef: anclaRef,
      plano: geometry.plano,
      destacada: fresh,
      offset: 0,
      offsetX: 0,
      sinLugar: false,
      ubicada: false,
      hojaRef,
      puntaRef,
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

      {/* Marca el punto de anclaje dentro de la escena, para que el
          resolvedor pueda pedir su posición de mundo. */}
      <object3D ref={anclaRef} position={geometry.anchor} />

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
