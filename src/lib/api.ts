import { requirePublic, requireSupabase, supabase } from './supabase'
import { DEFAULT_CATEGORY } from './categories'
import type { AgeRange, AgeStat, CategorySlug, Idea, IdeaStatus, Stats, TipoIdea } from './types'

/**
 * Columnas que la pantalla puede leer.
 *
 * No incluye author_name, age_range ni device_id: en el stand sólo se
 * publica la propuesta. El resto son datos internos para el informe del
 * municipio, y desde la migración 006 el rol anónimo directamente no tiene
 * permiso de leerlos — pedirlos acá haría fallar la consulta.
 */
const COLUMNAS_BASE = 'id, text, category, status, archived_at, created_at'

/**
 * Igual, más el tipo — hoja o raíz — que introduce la migración 009.
 *
 * Se degrada sola. PostgREST rechaza la consulta ENTERA con 42703 si le
 * pedís una columna que no existe, así que pedir 'tipo' contra una base sin
 * migrar no deja la pantalla sin una columna: la deja sin árbol. La primera
 * vez que eso pasa se baja a las columnas de siempre y se sigue, tratando
 * todo como propuesta, que es como se comportaba antes.
 */
let columnasPublicas = `${COLUMNAS_BASE}, tipo`

function faltaColumnaTipo(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || /column .*tipo.* does not exist/i.test(error.message ?? '')
}

/** Ejecuta una consulta pública y reintenta sin 'tipo' si la base no lo tiene. */
async function conColumnasPublicas<T>(
  ejecutar: (columnas: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<T> {
  let { data, error } = await ejecutar(columnasPublicas)

  if (faltaColumnaTipo(error) && columnasPublicas !== COLUMNAS_BASE) {
    console.warn(
      '[arbolia] Falta ejecutar supabase/migrations/009-criticas.sql. ' +
        'Hasta entonces toda idea se trata como propuesta.',
    )
    columnasPublicas = COLUMNAS_BASE
    ;({ data, error } = await ejecutar(columnasPublicas))
  }

  if (error) throw error
  return data as T
}

/** Cuantas ideas carga la pantalla al arrancar para reconstruir el arbol. */
export const TREE_HISTORY_LIMIT = 900

interface RawStats {
  ideas: number
  /** Desde la migración 009. Antes de ella, ausentes. */
  propuestas?: number
  criticas?: number
  participants: number
  areas: number
  by_category: Array<{
    slug: CategorySlug
    label: string
    emoji: string
    color: string
    total: number
  }> | null
}

export const EMPTY_STATS: Stats = {
  ideas: 0,
  propuestas: 0,
  criticas: 0,
  participants: 0,
  areas: 8,
  byCategory: [],
}

export async function fetchStats(): Promise<Stats> {
  const db = requirePublic()
  const { data, error } = await db.rpc('arbolia_stats')
  if (error) throw error

  const raw = data as RawStats
  return {
    ideas: raw.ideas ?? 0,
    // Si la migración 009 todavía no corrió, el RPC no devuelve estos dos.
    // Se cae a "todo es propuesta", que es como se comportaba antes.
    propuestas: raw.propuestas ?? raw.ideas ?? 0,
    criticas: raw.criticas ?? 0,
    participants: raw.participants ?? 0,
    areas: raw.areas ?? 8,
    byCategory: (raw.by_category ?? []).map((c) => ({
      slug: c.slug,
      label: c.label,
      emoji: c.emoji,
      color: c.color,
      total: c.total,
    })),
  }
}

/**
 * Ideas publicadas, de la mas vieja a la mas nueva (orden de plantado).
 *
 * El filtro por estado va explícito, además de RLS. No es redundancia
 * decorativa: confiar sólo en RLS fue lo que puso ideas moderadas en la
 * pantalla cuando había una sesión de administrador abierta en el mismo
 * navegador. Lo que no debe verse se filtra en los dos lados.
 */
export async function fetchTreeIdeas(limit = TREE_HISTORY_LIMIT): Promise<Idea[]> {
  const db = requirePublic()
  const filas = await conColumnasPublicas<Idea[] | null>((columnas) =>
    db
      .from('ideas')
      .select(columnas)
      .eq('status', 'visible')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  return (filas ?? []).reverse()
}

/** Ideas creadas despues de un instante dado: usado al reconectar. */
export async function fetchIdeasSince(isoTimestamp: string): Promise<Idea[]> {
  const db = requirePublic()
  const filas = await conColumnasPublicas<Idea[] | null>((columnas) =>
    db
      .from('ideas')
      .select(columnas)
      .eq('status', 'visible')
      .is('archived_at', null)
      .gt('created_at', isoTimestamp)
      .order('created_at', { ascending: true })
      .limit(200),
  )
  return filas ?? []
}

export interface SubmitIdeaInput {
  text: string
  category: CategorySlug
  deviceId: string
  /** Opcional. Si el rango es 'menor18' el servidor lo descarta igual. */
  authorName?: string | null
  ageRange?: AgeRange | null
  /** La revisión semántica pidió que un humano la mire antes de proyectarla. */
  revisar?: boolean
  /** Por qué. Queda en el panel, nunca se proyecta. */
  motivo?: string | null
  /** 'critica' cae y alimenta las raíces; 'propuesta' brota como hoja. */
  tipo?: TipoIdea
}

export type SubmitErrorCode = 'cooldown' | 'hourly_limit' | 'offline' | 'unknown'

export class SubmitError extends Error {
  code: SubmitErrorCode
  constructor(code: SubmitErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'SubmitError'
  }
}

/**
 * Envía una idea y devuelve en qué estado quedó.
 *
 * Pasa por una función de Postgres, no por un INSERT directo. La razón es
 * concreta: si el filtro marca la idea para revisión, la política de lectura
 * del público ya no la deja ver, así que un INSERT ... RETURNING falla con
 * error de RLS aunque la idea se haya guardado bien. La persona veía "no
 * pudimos enviar tu idea" cuando en realidad sí se había enviado.
 *
 * La función corre con permisos elevados pero sólo devuelve el envío propio;
 * las ideas marcadas siguen sin poder leerse desde el cliente.
 */
export async function submitIdea(input: SubmitIdeaInput): Promise<Idea> {
  const db = requirePublic()

  const base = {
    p_text: input.text.trim(),
    p_category: input.category ?? DEFAULT_CATEGORY,
    p_device_id: input.deviceId,
    p_author_name: input.authorName?.trim() || null,
    p_age_range: input.ageRange ?? null,
  }

  /*
   * Ventana de despliegue.
   *
   * PostgREST resuelve la función por los NOMBRES de los parámetros que
   * recibe: si mandamos uno que la función no tiene, ninguna versión
   * coincide y responde PGRST202 en vez de ejecutar.
   *
   * Por eso se intenta de la firma más nueva a la más vieja. El orden en
   * que alguien haga dos tareas —migrar y desplegar— no puede dejar a un
   * vecino del stand sin poder participar: en el peor caso la idea entra
   * como entraba antes, y la modera el filtro de palabras de la base.
   */
  const intentos: Array<{ falta: string; args: Record<string, unknown> }> = [
    {
      falta: '009-criticas.sql',
      args: {
        ...base,
        p_revisar: input.revisar === true,
        p_motivo: input.motivo ?? null,
        p_tipo: input.tipo ?? 'propuesta',
      },
    },
    {
      falta: '008-revision-ia.sql',
      args: { ...base, p_revisar: input.revisar === true, p_motivo: input.motivo ?? null },
    },
    { falta: '', args: base },
  ]

  let data: unknown = null
  let error: { code?: string; message: string; hint?: string } | null = null

  for (const intento of intentos) {
    ;({ data, error } = await db.rpc('arbolia_submit_idea', intento.args))

    const firmaInexistente =
      error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message))

    if (!firmaInexistente) break

    if (intento.falta) {
      console.warn(
        `[arbolia] Falta ejecutar supabase/migrations/${intento.falta}. ` +
          'Se reintenta sin los parámetros que introduce.',
      )
    }
  }

  if (error) {
    const msg = `${error.message} ${error.hint ?? ''}`
    if (msg.includes('RATE_LIMIT_COOLDOWN')) {
      throw new SubmitError('cooldown', 'Esperá unos segundos antes de enviar otra idea.')
    }
    if (msg.includes('RATE_LIMIT_HOURLY')) {
      throw new SubmitError('hourly_limit', 'Ya enviaste varias ideas. Dejale lugar a otros vecinos.')
    }
    if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
      throw new SubmitError('offline', 'No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.')
    }
    if (msg.includes('TEXT_LENGTH')) {
      throw new SubmitError('unknown', 'El texto tiene que tener entre 3 y 180 caracteres.')
    }
    throw new SubmitError('unknown', 'No pudimos enviar tu idea. Probá otra vez en un momento.')
  }

  const fila = data as {
    id: string
    text: string
    category: CategorySlug
    status: IdeaStatus
    created_at: string
    /** Ausente si la base todavía no tiene la migración 009. */
    tipo?: TipoIdea
  }

  return {
    ...fila,
    // Lo que diga la base manda. Si todavía no conoce el tipo, es una
    // propuesta: brota como hoja, que es como se comportaba antes.
    tipo: fila.tipo ?? 'propuesta',
    device_id: input.deviceId,
    archived_at: null,
  }
}

// ---------------------------------------------------------------------------
// Administracion (requiere sesion autenticada de Supabase Auth)
// ---------------------------------------------------------------------------

export interface AdminFilters {
  category?: CategorySlug | 'all'
  status?: IdeaStatus | 'all'
  search?: string
  limit?: number
  /**
   * Ver las archivadas en vez de las de la corrida actual.
   *
   * Reiniciar estadísticas archiva, no borra: los datos quedan para el
   * informe. Pero el panel las seguía listando junto a las vivas, así que
   * después de un reinicio el equipo se encontraba moderando una cola
   * llena de ideas de ayer mientras los contadores decían cero.
   */
  archivadas?: boolean
}

export async function fetchAdminIdeas(filters: AdminFilters = {}): Promise<Idea[]> {
  const db = requireSupabase()
  let query = db
    .from('ideas')
    // El panel sí ve los datos internos: los necesita para moderar y para
    // el informe posterior.
    .select(
      'id, text, category, device_id, status, archived_at, created_at, author_name, age_range, revision_motivo',
    )
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 300)

  query = filters.archivadas
    ? query.not('archived_at', 'is', null)
    : query.is('archived_at', null)

  if (filters.category && filters.category !== 'all') {
    query = query.eq('category', filters.category)
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters.search && filters.search.trim()) {
    query = query.ilike('text', `%${filters.search.trim()}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Idea[]
}

export async function setIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('ideas').update({ status }).eq('id', id)
  if (error) throw error
}

export async function resetStats(): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('arbolia_reset_stats')
  if (error) throw error
  return (data as number) ?? 0
}

export function isSupabaseReady(): boolean {
  return supabase !== null
}

// ---------------------------------------------------------------------------
// Ajustes y estadisticas del panel
// ---------------------------------------------------------------------------

export interface TimelinePoint {
  /** Inicio de la hora, en hora de Tucumán. */
  hora: string
  publicadas: number
  marcadas: number
  dispositivos: number
}

/**
 * Meta de ideas vigente.
 *
 * Vive en la base, no en el build: durante la expo el equipo puede subirla
 * o bajarla desde el panel si la participación va mucho más rápido o mucho
 * más lento de lo previsto, sin volver a desplegar.
 */
export async function fetchGoal(): Promise<number | null> {
  const db = requirePublic()
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', 'goal')
    .maybeSingle()

  if (error || !data) return null

  const valor = Number(data.value)
  return Number.isFinite(valor) && valor > 0 ? valor : null
}

export async function setGoal(goal: number): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('arbolia_set_goal', { p_goal: goal })
  if (error) {
    if (error.message.includes('GOAL_RANGE')) {
      throw new Error('La meta tiene que estar entre 10 y 100.000 ideas.')
    }
    throw new Error('No pudimos guardar la meta.')
  }
  return (data as number) ?? goal
}

/** Ideas por hora, con las horas vacías incluidas. */
export async function fetchTimeline(hours = 24): Promise<TimelinePoint[]> {
  const db = requirePublic()
  const { data, error } = await db.rpc('arbolia_timeline', { p_hours: hours })
  if (error) throw error
  return (data as TimelinePoint[]) ?? []
}

/** Participación por rango etario: qué pide cada generación. */
export async function fetchPorEdad(): Promise<AgeStat[]> {
  const db = requirePublic()
  const { data, error } = await db.rpc('arbolia_por_edad')
  if (error) throw error
  return (data as AgeStat[]) ?? []
}

/**
 * Una idea puntual, si es visible para el público.
 *
 * La usa la pantalla cuando el equipo aprueba algo de la cola de revisión:
 * el evento de moderación sólo trae el id, y hace falta el texto para poder
 * plantarla. Si RLS la sigue escondiendo devuelve null, así que una idea
 * moderada no puede colarse por este camino.
 */
export async function fetchIdeaById(id: string): Promise<Idea | null> {
  const db = requirePublic()
  try {
    return await conColumnasPublicas<Idea | null>((columnas) =>
      db.from('ideas').select(columnas).eq('id', id).maybeSingle(),
    )
  } catch {
    return null
  }
}

/**
 * Ideas que dejaron de estar visibles desde un instante dado.
 *
 * Es el respaldo del canal de moderación: si el WebSocket se cae, retirar
 * una idea desde el panel no llegaría nunca a la pantalla y el texto se
 * quedaría proyectado. Con esto el ciclo de respaldo también se entera.
 */
export async function fetchModeracionSince(desdeId: number): Promise<
  Array<{ id: number; idea_id: string; action: string }>
> {
  const db = requirePublic()
  const { data, error } = await db
    .from('moderation_events')
    .select('id, idea_id, action')
    .gt('id', desdeId)
    .order('id', { ascending: true })
    .limit(100)

  if (error) throw error
  return (data ?? []) as Array<{ id: number; idea_id: string; action: string }>
}

/** Id del último evento de moderación: marca de agua para el respaldo. */
export async function fetchUltimoEvento(): Promise<number> {
  const db = requirePublic()
  const { data, error } = await db
    .from('moderation_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return 0
  return (data as { id: number }).id
}
