import { requirePublic, requireSupabase, supabase } from './supabase'
import { DEFAULT_CATEGORY } from './categories'
import type { AgeRange, AgeStat, CategorySlug, Idea, IdeaStatus, Stats } from './types'

/** Cuantas ideas carga la pantalla al arrancar para reconstruir el arbol. */
export const TREE_HISTORY_LIMIT = 900

interface RawStats {
  ideas: number
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
  const { data, error } = await db
    .from('ideas')
    .select('id, text, category, device_id, status, archived_at, created_at')
    .eq('status', 'visible')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return ((data ?? []) as Idea[]).reverse()
}

/** Ideas creadas despues de un instante dado: usado al reconectar. */
export async function fetchIdeasSince(isoTimestamp: string): Promise<Idea[]> {
  const db = requirePublic()
  const { data, error } = await db
    .from('ideas')
    .select('id, text, category, device_id, status, archived_at, created_at')
    .eq('status', 'visible')
    .is('archived_at', null)
    .gt('created_at', isoTimestamp)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) throw error
  return (data ?? []) as Idea[]
}

export interface SubmitIdeaInput {
  text: string
  category: CategorySlug
  deviceId: string
  /** Opcional. Si el rango es 'menor18' el servidor lo descarta igual. */
  authorName?: string | null
  ageRange?: AgeRange | null
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

  const { data, error } = await db.rpc('arbolia_submit_idea', {
    p_text: input.text.trim(),
    p_category: input.category ?? DEFAULT_CATEGORY,
    p_device_id: input.deviceId,
    p_author_name: input.authorName?.trim() || null,
    p_age_range: input.ageRange ?? null,
  })

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
  }

  return {
    ...fila,
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
}

export async function fetchAdminIdeas(filters: AdminFilters = {}): Promise<Idea[]> {
  const db = requireSupabase()
  let query = db
    .from('ideas')
    .select('id, text, category, device_id, status, archived_at, created_at')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 300)

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
