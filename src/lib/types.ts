export type CategorySlug =
  | 'ambiente'
  | 'movilidad'
  | 'espacios'
  | 'tecnologia'
  | 'transporte'
  | 'cultura'
  | 'urbanismo'
  | 'comunidad'

export type IdeaStatus = 'visible' | 'flagged' | 'hidden'

/**
 * Rango etario de quien propone.
 *
 * Rango y no edad exacta: en un stand público participan menores, y guardar
 * la edad precisa de un menor es un dato sensible. El rango da la misma
 * lectura estadística y en el celular se elige de un toque.
 */
export type AgeRange = 'menor18' | '18-29' | '30-44' | '45-59' | '60mas'

export interface AgeOption {
  slug: AgeRange
  label: string
}

export const AGE_RANGES: AgeOption[] = [
  { slug: 'menor18', label: 'Menos de 18' },
  { slug: '18-29', label: '18 a 29' },
  { slug: '30-44', label: '30 a 44' },
  { slug: '45-59', label: '45 a 59' },
  { slug: '60mas', label: '60 o más' },
]

export interface Idea {
  id: string
  text: string
  category: CategorySlug
  /** Sólo lo ve el panel: no viaja al navegador del público. */
  device_id?: string
  /** Opcional: quien no quiere firmar participa igual. */
  author_name?: string | null
  age_range?: AgeRange | null
  status: IdeaStatus
  archived_at: string | null
  created_at: string
}

export interface CategoryDef {
  slug: CategorySlug
  label: string
  emoji: string
  /** Color base de la rama y de las hojas de esta categoria. */
  color: string
  /** Posicion angular de la rama en el arbol (0..7). */
  branchSlot: number
}

export interface CategoryCount {
  slug: CategorySlug
  label: string
  emoji: string
  color: string
  total: number
}

export interface Stats {
  ideas: number
  participants: number
  areas: number
  byCategory: CategoryCount[]
}

/** Participación por rango etario, para el panel. */
export interface AgeStat {
  slug: string
  label: string
  total: number
  topArea: CategorySlug | null
}

export interface ModerationEvent {
  id: number
  idea_id: string
  action: 'hidden' | 'restored' | 'archived_all'
  created_at: string
}

/**
 * Etapas de crecimiento. El arbol no cambia de modelo: cambia densidad de
 * follaje, altura de copa, cantidad de particulas e intensidad de luz.
 */
export type GrowthStage = 'brote' | 'joven' | 'frondoso' | 'pleno'

export interface GrowthProfile {
  stage: GrowthStage
  label: string
  /** 0..1 — interpolacion continua dentro y entre etapas. */
  progress: number
  canopyScale: number
  foliageDensity: number
  /** Cuánto de su largo total tienen desplegadas las raíces (0..1). */
  rootReach: number
  glowIntensity: number
  particleCount: number
}
