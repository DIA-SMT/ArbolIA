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

export interface Idea {
  id: string
  text: string
  category: CategorySlug
  device_id: string
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
