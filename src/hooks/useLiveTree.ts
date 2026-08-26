import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabasePublic } from '../lib/supabase'
import { DEMO_MODE, GOAL_FALLBACK, IS_SUPABASE_CONFIGURED, milestonesFor } from '../lib/config'
import { EMPTY_STATS, fetchGoal, fetchIdeasSince, fetchStats, fetchTreeIdeas } from '../lib/api'
import { demoCategoryCounts, makeDemoHistory, makeDemoIdea } from '../lib/demo'
import type { Idea, Stats } from '../lib/types'

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'demo'

/** Duracion nominal del viaje de la particula + brote de la hoja. */
const ANIM_BASE_MS = 3600
const ANIM_FAST_MS = 2200
/** Si se acumulan mas que esto, se plantan de golpe para no quedar atras. */
const QUEUE_BURST_THRESHOLD = 6
const STATS_REFRESH_MS = 30_000
const BACKUP_POLL_MS = 8_000

export interface LiveTree {
  status: ConnectionStatus
  stats: Stats
  /** Meta vigente, editable desde el panel sin redesplegar. */
  goal: number
  /** Hojas ya integradas al arbol. */
  ideas: Idea[]
  /** Idea que esta viajando por el arbol en este momento. */
  activeIdea: Idea | null
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
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    timersRef.current.push(t)
    return t
  }

  /** Integra una hoja al arbol sin animacion (carga inicial o rafaga). */
  const plantSilently = useCallback((batch: Idea[]) => {
    if (batch.length === 0) return
    setIdeas((prev) => [...prev, ...batch])
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
    setActiveIdea(next)

    const duration = queue.length > 2 ? ANIM_FAST_MS : ANIM_BASE_MS

    later(() => {
      // La hoja queda integrada de forma permanente.
      setIdeas((prev) => [...prev, next])
      setActiveIdea(null)
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

  // -------------------------------------------------------------------
  // Deteccion de hitos
  // -------------------------------------------------------------------
  useEffect(() => {
    for (const milestone of milestonesFor(goal)) {
      if (stats.ideas >= milestone && !milestoneReachedRef.current.has(milestone)) {
        milestoneReachedRef.current.add(milestone)
        // Solo celebramos si ya habia carga previa: al montar no festejamos
        // hitos que ya estaban alcanzados desde antes.
        if (seenIdsRef.current.size > 0 && ideas.length > 0) {
          setCelebration(milestone)
        }
      }
    }
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

        history.forEach((i) => {
          seenIdsRef.current.add(i.id)
          if (i.created_at > lastSeenAtRef.current) lastSeenAtRef.current = i.created_at
        })
        setIdeas(history)
        setStats(freshStats)
        milestonesFor(metaActual ?? GOAL_FALLBACK)
          .filter((m) => freshStats.ideas >= m)
          .forEach((m) => milestoneReachedRef.current.add(m))
        setLastError(null)
      } catch (err) {
        if (!cancelled) {
          setLastError(err instanceof Error ? err.message : 'Error de carga inicial')
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
          enqueue([payload.new as Idea])
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'moderation_events' },
        (payload) => {
          const evt = payload.new as { idea_id: string; action: string }
          if (evt.action === 'hidden') {
            // Retiro inmediato de la hoja moderada.
            setIdeas((prev) => prev.filter((i) => i.id !== evt.idea_id))
            queueRef.current = queueRef.current.filter((i) => i.id !== evt.idea_id)
            setActiveIdea((curr) => (curr?.id === evt.idea_id ? null : curr))
            setStats((prev) => ({ ...prev, ideas: Math.max(0, prev.ideas - 1) }))
          } else if (evt.action === 'archived_all') {
            seenIdsRef.current.clear()
            queueRef.current = []
            milestoneReachedRef.current.clear()
            setIdeas([])
            setActiveIdea(null)
            setStats(EMPTY_STATS)
          }
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
  }, [enqueue])

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

    const interval = setInterval(() => {
      fetchIdeasSince(lastSeenAtRef.current)
        .then((rows) => {
          if (rows.length > 0) enqueue(rows)
        })
        .catch(() => undefined)
    }, BACKUP_POLL_MS)

    return () => clearInterval(interval)
  }, [status, enqueue])

  // Limpieza de timers al desmontar.
  useEffect(() => clearTimers, [])

  const toggleSilencio = useCallback(() => setTextoSilenciado((v) => !v), [])
  const dismissCelebration = useCallback(() => setCelebration(null), [])

  return useMemo(
    () => ({
      status,
      stats,
      goal,
      ideas,
      activeIdea,
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
      activeIdea,
      textoSilenciado,
      queueLength,
      celebration,
      lastError,
      toggleSilencio,
      dismissCelebration,
    ],
  )
}
