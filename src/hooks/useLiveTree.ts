import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabasePublic } from '../lib/supabase'
import { DEMO_MODE, GOAL_FALLBACK, hitosAlcanzados, IS_SUPABASE_CONFIGURED, milestonesFor } from '../lib/config'
import {
  EMPTY_STATS,
  fetchGoal,
  fetchIdeaById,
  fetchIdeasSince,
  fetchModeracionSince,
  fetchStats,
  fetchTreeIdeas,
  fetchUltimoEvento,
} from '../lib/api'
import { demoCategoryCounts, makeDemoHistory, makeDemoIdea } from '../lib/demo'
import type { Idea, Stats } from '../lib/types'

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'demo'

/** Duracion nominal del viaje de la particula + brote de la hoja. */
const ANIM_BASE_MS = 3600
const ANIM_FAST_MS = 2200
/**
 * Lo que tarda una crítica en caer de la copa a la tierra.
 *
 * Más larga que el viaje de una propuesta a propósito: la caída tiene que
 * leerse como un gesto completo —se desprende, cae, se hunde, las raíces
 * responden— y no como algo que se cayó del árbol por accidente.
 */
const CAIDA_MS = 4200

/** Si se acumulan mas que esto, se plantan de golpe para no quedar atras. */
const QUEUE_BURST_THRESHOLD = 6
const STATS_REFRESH_MS = 30_000
const BACKUP_POLL_MS = 8_000

export interface LiveTree {
  status: ConnectionStatus
  stats: Stats
  /** Meta vigente, editable desde el panel sin redesplegar. */
  goal: number
  /** Todas las ideas publicadas: propuestas y críticas. */
  ideas: Idea[]
  /**
   * Sólo las que ocupan una hoja.
   *
   * Existe para que no haya dos conteos. El slot de cada hoja se calcula
   * contando cuántas hay ya de esa categoría, y ese conteo ocurre en dos
   * lugares distintos —el destino del viaje y el dibujado—. Mientras toda
   * idea era una hoja, los dos daban lo mismo por accidente. Con las
   * críticas fuera de la copa, cualquiera de los dos que siguiera contando
   * sobre `ideas` desincronizaría al otro y la propuesta siguiente
   * aterrizaría sobre un slot ya ocupado.
   */
  propuestas: Idea[]
  /** Propuesta que esta viajando hacia su hoja en este momento. */
  activeIdea: Idea | null
  /** Crítica que está cayendo hacia las raíces en este momento. */
  criticaCayendo: Idea | null
  /**
   * Sube de a uno cada vez que una crítica toca la tierra.
   *
   * Es un contador y no un booleano para que la escena pueda distinguir
   * dos críticas seguidas: con una bandera, la segunda no dispararía nada
   * si la primera todavía no se apagó.
   */
  pulsoRaices: number
  /**
   * Silencio de emergencia del operador (Ctrl+H).
   *
   * Es un estado propio y persistente: antes reusaba la misma bandera que
   * la animación, y pump() la reactivaba con la idea siguiente — o sea que
   * el "botón de pánico" se deshacía solo en segundos.
   */
  textoSilenciado: boolean
  queueLength: number
  /** Hito alcanzado que dispara la celebracion, o null. */
  celebration: number | null
  lastError: string | null
  /** Alterna el silencio. Sólo lo cambia el operador, nada más. */
  toggleSilencio: () => void
  dismissCelebration: () => void
}

export function useLiveTree(): LiveTree {
  const [status, setStatus] = useState<ConnectionStatus>(
    IS_SUPABASE_CONFIGURED ? 'connecting' : DEMO_MODE ? 'demo' : 'reconnecting',
  )
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [activeIdea, setActiveIdea] = useState<Idea | null>(null)
  const [criticaCayendo, setCriticaCayendo] = useState<Idea | null>(null)
  const [pulsoRaices, setPulsoRaices] = useState(0)
  const [textoSilenciado, setTextoSilenciado] = useState(false)
  const [celebration, setCelebration] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [queueLength, setQueueLength] = useState(0)
  const [goal, setGoal] = useState(GOAL_FALLBACK)

  const queueRef = useRef<Idea[]>([])
  const animatingRef = useRef(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const lastSeenAtRef = useRef<string>(new Date(0).toISOString())
  const milestoneReachedRef = useRef<Set<number>>(new Set())
  /**
   * Ideas que el equipo retiró.
   *
   * Hace falta porque el temporizador que planta la hoja al terminar el
   * viaje ya capturó la idea en un closure y no se puede cancelar desde el
   * handler de moderación. Sin esta lista, una idea retirada mientras su
   * partícula subía por el tronco se plantaba igual al llegar.
   */
  const retiradasRef = useRef<Set<string>>(new Set())
  /** Último evento de moderación procesado, para el respaldo por intervalos. */
  const ultimoEventoRef = useRef(0)
  /**
   * La carga inicial ya terminó.
   *
   * El ciclo de respaldo no puede correr antes: la marca de agua todavía
   * está en 1970, así que traería la expo entera y la encolaría para
   * plantar — encima de lo que la carga inicial acaba de poner.
   */
  const cargaListaRef = useRef(false)
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  /*
   * Espejos del estado, para que el ensayo de desarrollo pueda mirarlo sin
   * suscribirse a React. Se actualizan en cada render.
   */
  const ideasRef = useRef<Idea[]>([])
  const activeIdeaRef = useRef<Idea | null>(null)
  const criticaCayendoRef = useRef<Idea | null>(null)
  const pulsoRef = useRef(0)
  ideasRef.current = ideas
  activeIdeaRef.current = activeIdea
  criticaCayendoRef.current = criticaCayendo
  pulsoRef.current = pulsoRaices

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    timersRef.current.push(t)
    return t
  }

  /**
   * Agrega sin repetir.
   *
   * El array de ideas NO puede contener dos veces el mismo id: React usa
   * el id como clave, y el slot de cada hoja se calcula contando cuántas
   * hay ya de esa categoría. Una idea duplicada planta dos hojas encima y
   * corre de lugar a todas las que vienen después.
   *
   * Es una red, no la solución: la causa se arregla más abajo, en el ciclo
   * de respaldo. Pero hay varios caminos que escriben en este array —carga
   * inicial, cola de animación, ráfaga, moderación, respaldo— y ninguno
   * puede permitirse romper esa invariante.
   */
  const agregarSinRepetir = (prev: Idea[], nuevas: Idea[]): Idea[] => {
    const presentes = new Set(prev.map((i) => i.id))
    const faltantes = nuevas.filter((i) => !presentes.has(i.id))
    return faltantes.length === 0 ? prev : [...prev, ...faltantes]
  }

  /** Integra una hoja al arbol sin animacion (carga inicial o rafaga). */
  const plantSilently = useCallback((batch: Idea[]) => {
    if (batch.length === 0) return
    setIdeas((prev) => agregarSinRepetir(prev, batch))
  }, [])

  // -------------------------------------------------------------------
  // Cola de animacion: una idea por vez, acelerando si hay cola.
  // -------------------------------------------------------------------
  const pump = useCallback(() => {
    if (animatingRef.current) return
    const queue = queueRef.current

    if (queue.length === 0) {
      setQueueLength(0)
      return
    }

    // Rafaga: plantamos el excedente de una y animamos solo las ultimas.
    if (queue.length > QUEUE_BURST_THRESHOLD) {
      const overflow = queue.splice(0, queue.length - 3)
      plantSilently(overflow)
    }

    const next = queue.shift()
    setQueueLength(queue.length)
    if (!next) return

    animatingRef.current = true

    /*
     * Acá se bifurca la instalación.
     *
     * Una PROPUESTA sube desde las raíces y brota como hoja en su rama.
     * Una CRÍTICA hace el camino inverso: cae desde la copa y se hunde en
     * la tierra, y las raíces —que en este árbol son la comunidad— se
     * extienden. El municipio no esconde el reclamo: se alimenta de él.
     */
    const esCritica = next.tipo === 'critica'
    if (esCritica) setCriticaCayendo(next)
    else setActiveIdea(next)

    // La caída no se acelera con la cola. Es el gesto que hay que entender
    // desde lejos, y apurarlo lo convierte en un parpadeo.
    const duration = esCritica
      ? CAIDA_MS
      : queue.length > 2
        ? ANIM_FAST_MS
        : ANIM_BASE_MS

    later(() => {
      /*
       * Última comprobación antes de plantar. El viaje de la partícula dura
       * más de tres segundos: en ese lapso el equipo puede haber retirado la
       * idea desde el panel. Sin esto la hoja se plantaba igual al llegar,
       * porque el temporizador ya la tenía capturada.
       */
      if (!retiradasRef.current.has(next.id)) {
        setIdeas((prev) => agregarSinRepetir(prev, [next]))
        // Tocó la tierra: las raíces se fortalecen.
        if (esCritica) setPulsoRaices((n) => n + 1)
      }
      setActiveIdea(null)
      setCriticaCayendo(null)
      animatingRef.current = false
      later(pump, 260)
    }, duration)
  }, [plantSilently])

  const enqueue = useCallback(
    (incoming: Idea[]) => {
      const fresh = incoming.filter((idea) => {
        if (seenIdsRef.current.has(idea.id)) return false
        if (idea.status !== 'visible' || idea.archived_at) return false
        seenIdsRef.current.add(idea.id)
        if (idea.created_at > lastSeenAtRef.current) lastSeenAtRef.current = idea.created_at
        return true
      })

      if (fresh.length === 0) return

      queueRef.current.push(...fresh)
      setQueueLength(queueRef.current.length)

      // Contador optimista: no esperamos el round-trip del RPC. El desglose
      // por categoría se ajusta acá también, si no la barra del área quedaría
      // hasta 30 s desfasada respecto del número grande de ideas.
      setStats((prev) => {
        const byCategory = prev.byCategory.map((cat) => {
          const hits = fresh.filter((i) => i.category === cat.slug).length
          return hits > 0 ? { ...cat, total: cat.total + hits } : cat
        })
        return { ...prev, ideas: prev.ideas + fresh.length, byCategory }
      })
      pump()
    },
    [pump],
  )

  /**
   * Aplica un evento de moderación a la pantalla.
   *
   * Vive acá y no dentro de la suscripción porque el ciclo de respaldo por
   * intervalos tiene que poder ejecutar exactamente lo mismo: si el
   * WebSocket se cae, retirar una idea desde el panel no llegaría nunca y
   * el texto se quedaría proyectado en el LED.
   */
  const aplicarModeracion = useCallback(
    (evt: { id?: number; idea_id: string; action: string }) => {
      if (evt.id && evt.id > ultimoEventoRef.current) ultimoEventoRef.current = evt.id

      if (evt.action === 'hidden') {
        retiradasRef.current.add(evt.idea_id)
        // Se saca de lo visto para que una republicación posterior no quede
        // descartada por duplicada.
        seenIdsRef.current.delete(evt.idea_id)

        setIdeas((prev) => {
          if (!prev.some((i) => i.id === evt.idea_id)) return prev
          setStats((s) => ({ ...s, ideas: Math.max(0, s.ideas - 1) }))
          return prev.filter((i) => i.id !== evt.idea_id)
        })
        queueRef.current = queueRef.current.filter((i) => i.id !== evt.idea_id)
        setActiveIdea((curr) => (curr?.id === evt.idea_id ? null : curr))
        return
      }

      if (evt.action === 'restored') {
        /*
         * El equipo aprobó algo de la cola de revisión.
         *
         * Antes esto no se atendía: la pantalla sólo escuchaba INSERT, y
         * aprobar es un UPDATE, así que la cola de revisión era un pozo sin
         * salida — lo que el filtro marcaba no llegaba nunca al árbol
         * aunque alguien lo aprobara.
         *
         * El evento sólo trae el id, así que hay que ir a buscar el texto.
         * Si RLS la sigue escondiendo, fetchIdeaById devuelve null y no se
         * planta nada.
         */
        retiradasRef.current.delete(evt.idea_id)

        void fetchIdeaById(evt.idea_id)
          .then((idea) => {
            if (idea) enqueue([idea])
          })
          .catch(() => undefined)
        return
      }

      if (evt.action === 'archived_all') {
        seenIdsRef.current.clear()
        retiradasRef.current.clear()
        queueRef.current = []
        milestoneReachedRef.current.clear()
        setIdeas([])
        setActiveIdea(null)
        setStats(EMPTY_STATS)
      }
    },
    [enqueue],
  )

  // -------------------------------------------------------------------
  // Deteccion de hitos
  // -------------------------------------------------------------------
  /*
   * La meta se puede cambiar en plena feria desde el panel, y al cambiarla
   * cambian los hitos: son 20 %, 50 % y 100 % de la meta vigente.
   *
   * Sin esto, subir la meta dispara una celebración falsa. Con 400 ideas y
   * meta 500 los hitos son 100, 250 y 500, todos registrados. Al pasar la
   * meta a 1500 los hitos pasan a 300, 750 y 1500: el 300 nunca se registró
   * y 400 ya lo supera, así que la pantalla festejaba a pantalla completa
   * sin que nadie hubiera cruzado nada. Bajar la meta es peor todavía:
   * dispara varios de una.
   *
   * Cuando la meta cambia, los hitos ya superados se dan por vistos EN
   * SILENCIO, igual que hace la carga inicial. Los que se crucen después sí
   * se celebran.
   */
  const metaAnteriorRef = useRef(goal)

  useEffect(() => {
    const cambioLaMeta = metaAnteriorRef.current !== goal
    metaAnteriorRef.current = goal

    const nuevos = hitosAlcanzados(goal, stats.ideas, milestoneReachedRef.current)
    for (const hito of nuevos) milestoneReachedRef.current.add(hito)

    // Solo celebramos si ya habia carga previa: al montar no festejamos
    // hitos que ya estaban alcanzados desde antes. Y tampoco al cambiar la
    // meta, que reescribe los hitos sin que nadie haya cruzado ninguno.
    if (cambioLaMeta || seenIdsRef.current.size === 0 || ideas.length === 0) return

    // El más alto: si entraran dos juntos, festejar el chico sería raro.
    const paraFestejar = nuevos[nuevos.length - 1]
    if (paraFestejar !== undefined) setCelebration(paraFestejar)
  }, [stats.ideas, ideas.length, goal])

  // -------------------------------------------------------------------
  // Modo demo
  // -------------------------------------------------------------------
  useEffect(() => {
    // Nunca simular en producción: ver la nota de DEMO_MODE en config.ts.
    if (!DEMO_MODE) return

    const history = makeDemoHistory(64)
    history.forEach((i) => seenIdsRef.current.add(i.id))
    setIdeas(history)
    setStats({
      ideas: history.length,
      propuestas: history.filter((i) => i.tipo !== 'critica').length,
      criticas: history.filter((i) => i.tipo === 'critica').length,
      participants: new Set(history.map((i) => i.device_id)).size,
      areas: 8,
      byCategory: demoCategoryCounts(history),
    })

    let n = 200
    const interval = setInterval(() => {
      const idea = makeDemoIdea(n++)
      enqueue([idea])
      setStats((prev) => ({
        ...prev,
        participants: prev.participants + (Math.random() > 0.55 ? 1 : 0),
      }))
    }, 6500)

    return () => clearInterval(interval)
  }, [enqueue])

  // -------------------------------------------------------------------
  // Carga inicial + realtime
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED || !supabasePublic) return
    let cancelled = false

    async function bootstrap() {
      try {
        const [history, freshStats, metaActual] = await Promise.all([
          fetchTreeIdeas(),
          fetchStats(),
          fetchGoal(),
        ])
        if (cancelled) return

        if (metaActual) setGoal(metaActual)

        // Marca de agua inicial: sin esto, el primer ciclo de respaldo
        // reprocesaría todos los eventos de moderación de la expo entera.
        void fetchUltimoEvento()
          .then((id) => {
            ultimoEventoRef.current = id
          })
          .catch(() => undefined)

        history.forEach((i) => {
          seenIdsRef.current.add(i.id)
          if (i.created_at > lastSeenAtRef.current) lastSeenAtRef.current = i.created_at
        })
        setIdeas(history)
        setStats(freshStats)
        cargaListaRef.current = true
        milestonesFor(metaActual ?? GOAL_FALLBACK)
          .filter((m) => freshStats.ideas >= m)
          .forEach((m) => milestoneReachedRef.current.add(m))
        setLastError(null)
      } catch (err) {
        if (!cancelled) {
          setLastError(err instanceof Error ? err.message : 'Error de carga inicial')
          // El respaldo sí tiene que arrancar: si la carga inicial falló,
          // es exactamente cuando hace falta. Trae desde 1970 una sola vez
          // y a partir de ahí la marca de agua ya queda puesta.
          cargaListaRef.current = true
        }
      }
    }

    void bootstrap()

    const channel = supabasePublic
      .channel('arbolia-pantalla')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ideas' },
        (payload) => {
          /*
           * Se descartan los campos internos aunque el permiso de columna
           * ya debería filtrarlos. El payload de replicación no pasa por
           * el mismo camino que una consulta REST, y no quiero que la
           * promesa de "en el stand sólo se publica la propuesta" dependa
           * de un detalle de implementación de Realtime.
           */
          const fila = payload.new as Record<string, unknown>
          enqueue([
            {
              id: fila.id as string,
              text: fila.text as string,
              category: fila.category as Idea['category'],
              status: fila.status as Idea['status'],
              archived_at: (fila.archived_at as string | null) ?? null,
              created_at: fila.created_at as string,
              // Sin esto la MISMA fila se comporta distinto según por dónde
              // llegue: por WebSocket vendría sin tipo y por el respaldo
              // (fetchIdeasSince) con él. Una crítica brotaría como hoja
              // salvo que justo se cayera la red — un bug que sólo aparece
              // en el peor momento posible.
              tipo: fila.tipo === 'critica' ? 'critica' : 'propuesta',
            },
          ])
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'moderation_events' },
        (payload) => {
          const evt = payload.new as { id: number; idea_id: string; action: string }
          aplicarModeracion(evt)
        },
      )
      .subscribe((state) => {
        if (cancelled) return
        if (state === 'SUBSCRIBED') {
          setStatus('live')
          setLastError(null)
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setStatus('reconnecting')
        }
      })

    return () => {
      cancelled = true
      void supabasePublic?.removeChannel(channel)
    }
  }, [enqueue, aplicarModeracion])

  // -------------------------------------------------------------------
  // Refresco periodico de estadisticas (corrige la deriva del optimista
  // y trae "participantes", que no se puede calcular localmente).
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) return
    const interval = setInterval(() => {
      fetchStats()
        .then((s) => setStats((prev) => ({ ...s, ideas: Math.max(s.ideas, prev.ideas) })))
        .catch(() => undefined)

      // La meta se edita desde el panel: la pantalla la toma sin recargar.
      fetchGoal()
        .then((m) => { if (m) setGoal(m) })
        .catch(() => undefined)
    }, STATS_REFRESH_MS)
    return () => clearInterval(interval)
  }, [])

  // -------------------------------------------------------------------
  // Polling de respaldo: si el socket murio, seguimos trayendo ideas.
  // El arbol nunca se congela porque se cayo el WebSocket del predio.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED || status === 'live' || status === 'demo') return

    /*
     * Con el socket caído hay que traer las dos cosas: las ideas nuevas y
     * los eventos de moderación. Traer sólo las nuevas dejaba una idea
     * retirada proyectada en el LED hasta que volviera la conexión.
     */
    const traer = () => {
      // Antes de que termine la carga inicial no hay nada que respaldar, y
      // sí mucho que romper.
      if (!cargaListaRef.current) return

      fetchIdeasSince(lastSeenAtRef.current)
        .then((rows) => {
          if (rows.length > 0) enqueue(rows)
        })
        .catch(() => undefined)

      fetchModeracionSince(ultimoEventoRef.current)
        .then((eventos) => eventos.forEach(aplicarModeracion))
        .catch(() => undefined)
    }

    // Sin espera inicial: los primeros ocho segundos tras una caída son
    // justo los que importan.
    traer()
    const interval = setInterval(traer, BACKUP_POLL_MS)

    return () => clearInterval(interval)
  }, [status, enqueue, aplicarModeracion])

  /*
   * Ensayo de la instalación, sólo en desarrollo.
   *
   * Se elimina del build de producción. Permite disparar una propuesta o
   * una crítica sin tocar la base, que es lo único que hace falta para
   * calibrar cómo se ven los dos gestos en el LED del stand el día del
   * armado, sin depender de que alguien mande ideas de verdad.
   *
   *   __arbolia_ensayo.critica('El municipio no limpia el barrio')
   *   __arbolia_ensayo.propuesta('Más colectivos por Mate de Luna', 'movilidad')
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return

    let n = 0
    const inventar = (texto: string, categoria: string, tipo: 'propuesta' | 'critica'): Idea => ({
      id: `ensayo-${tipo}-${Date.now()}-${n++}`,
      text: texto,
      category: categoria as Idea['category'],
      status: 'visible',
      archived_at: null,
      created_at: new Date().toISOString(),
      device_id: 'ensayo-local',
      tipo,
    })

    const api = {
      /** Qué está haciendo la instalación ahora mismo. */
      estado: () => ({
        ideas: ideasRef.current.length,
        propuestas: ideasRef.current.filter((i) => i.tipo !== 'critica').length,
        criticas: ideasRef.current.filter((i) => i.tipo === 'critica').length,
        tipos: [...new Set(ideasRef.current.map((i) => i.tipo ?? '(sin tipo)'))],
        viajando: activeIdeaRef.current?.text ?? null,
        cayendo: criticaCayendoRef.current?.text ?? null,
        pulsoRaices: pulsoRef.current,
        enCola: queueRef.current.length,
        colaTipos: queueRef.current.map((i) => i.tipo ?? '(sin tipo)'),
      }),
      propuesta: (texto = 'Más colectivos por la avenida Mate de Luna', cat = 'movilidad') =>
        enqueue([inventar(texto, cat, 'propuesta')]),
      critica: (texto = 'El municipio no limpia el barrio hace meses', cat = 'ambiente') =>
        enqueue([inventar(texto, cat, 'critica')]),
      /** Varias seguidas, para ver cómo se encolan. */
      lluvia: (cantidad = 5, tipo: 'propuesta' | 'critica' = 'critica') => {
        const cats = ['ambiente', 'movilidad', 'espacios', 'cultura', 'urbanismo']
        enqueue(
          Array.from({ length: cantidad }, (_, i) =>
            inventar(
              tipo === 'critica'
                ? `Reclamo de ensayo número ${i + 1}`
                : `Propuesta de ensayo número ${i + 1}`,
              cats[i % cats.length],
              tipo,
            ),
          ),
        )
      },
      /**
       * Siembra de golpe, sin cola ni animación.
       *
       * `lluvia` encola, y cada idea encolada se toma sus segundos de viaje:
       * mil ideas por ahí son horas. Esto es para la otra pregunta, la de
       * cuánto crece el árbol y hasta dónde llegan las raíces con la feria
       * andando, que no se puede contestar esperando.
       *
       * No toca la base: arma las ideas en memoria, igual que el resto del
       * ensayo. El contador de stats sí se mueve, porque de él sale la etapa
       * de crecimiento y por lo tanto el tamaño del árbol.
       *
       *   __arbolia_ensayo.sembrar(600)        // 600, 20% críticas
       *   __arbolia_ensayo.sembrar(1500, 0.35) // 1500, 35% críticas
       */
      sembrar: (cantidad = 300, proporcionCriticas = 0.2) => {
        const cats = ['ambiente', 'movilidad', 'espacios', 'tecnologia',
                      'transporte', 'cultura', 'urbanismo', 'comunidad']
        const lote = Array.from({ length: cantidad }, (_, i) => {
          const esCritica = i % Math.max(2, Math.round(1 / Math.max(0.01, proporcionCriticas))) === 0
          return inventar(
            esCritica ? `Reclamo de ensayo ${i + 1}` : `Propuesta de ensayo ${i + 1}`,
            cats[i % cats.length],
            esCritica ? 'critica' : 'propuesta',
          )
        })
        lote.forEach((i) => seenIdsRef.current.add(i.id))

        // Sólo las propuestas ocupan hoja; las críticas suman al total.
        plantSilently(lote.filter((i) => i.tipo !== 'critica'))
        setStats((prev) => {
          const byCategory = prev.byCategory.map((cat) => ({
            ...cat,
            total: cat.total + lote.filter((i) => i.category === cat.slug).length,
          }))
          return { ...prev, ideas: prev.ideas + lote.length, byCategory }
        })
        return { sembradas: cantidad, propuestas: lote.filter((i) => i.tipo !== 'critica').length }
      },
    }

    ;(window as unknown as { __arbolia_ensayo?: typeof api }).__arbolia_ensayo = api
    return () => {
      delete (window as unknown as { __arbolia_ensayo?: typeof api }).__arbolia_ensayo
    }
  }, [enqueue])

  // Limpieza de timers al desmontar.
  useEffect(() => clearTimers, [])

  const toggleSilencio = useCallback(() => setTextoSilenciado((v) => !v), [])
  const dismissCelebration = useCallback(() => setCelebration(null), [])

  /*
   * Una sola fuente para todo lo que ocupa una hoja.
   *
   * El slot de cada hoja se calcula contando cuántas hay ya de su categoría,
   * y ese conteo ocurre en dos lugares independientes: el destino del viaje
   * en TreeScene y el dibujado en Leaves. Mientras toda idea era una hoja,
   * los dos partían del mismo array y coincidían por accidente. Ahora que
   * las críticas no van a la copa, si uno solo de los dos siguiera contando
   * sobre `ideas` la propuesta siguiente aterrizaría sobre un slot ocupado.
   */
  const propuestas = useMemo(() => ideas.filter((i) => i.tipo !== 'critica'), [ideas])

  return useMemo(
    () => ({
      status,
      stats,
      goal,
      ideas,
      propuestas,
      activeIdea,
      criticaCayendo,
      pulsoRaices,
      textoSilenciado,
      queueLength,
      celebration,
      lastError,
      toggleSilencio,
      dismissCelebration,
    }),
    [
      status,
      stats,
      goal,
      ideas,
      propuestas,
      activeIdea,
      criticaCayendo,
      pulsoRaices,
      textoSilenciado,
      queueLength,
      celebration,
      lastError,
      toggleSilencio,
      dismissCelebration,
    ],
  )
}
