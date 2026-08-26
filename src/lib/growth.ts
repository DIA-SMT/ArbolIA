import { GOAL_FALLBACK } from './config'
import type { GrowthProfile, GrowthStage } from './types'

interface StageDef {
  stage: GrowthStage
  label: string
  from: number
  to: number
  canopy: [number, number]
  density: [number, number]
  reach: [number, number]
  glow: [number, number]
  particles: [number, number]
}

/**
 * Etapas de evolucion del arbol. Los tramos siguen la meta configurada:
 * con GOAL=500 quedan 0-100 / 100-250 / 250-500 / 500+.
 */
function stagesFor(GOAL: number): StageDef[] {
  return [
  {
    stage: 'brote',
    label: 'Brote',
    from: 0,
    to: Math.round(GOAL * 0.2),
    canopy: [0.52, 0.72],
    // El piso de densidad es alto a propósito: con follaje base ralo el
    // árbol se ve como un esqueleto con confeti colgado, y las hojas
    // ciudadanas pierden el fondo contra el que destacan.
    density: [0.58, 0.7],
    reach: [0.4, 0.56],
    glow: [0.75, 1.0],
    particles: [140, 260],
  },
  {
    stage: 'joven',
    label: 'Joven',
    from: Math.round(GOAL * 0.2),
    to: Math.round(GOAL * 0.5),
    canopy: [0.72, 0.9],
    density: [0.7, 0.82],
    reach: [0.56, 0.73],
    glow: [1.0, 1.25],
    particles: [260, 400],
  },
  {
    stage: 'frondoso',
    label: 'Frondoso',
    from: Math.round(GOAL * 0.5),
    to: GOAL,
    canopy: [0.9, 1.1],
    density: [0.82, 0.93],
    reach: [0.73, 0.9],
    glow: [1.25, 1.5],
    particles: [400, 560],
  },
  {
    stage: 'pleno',
    label: 'Pleno',
    from: GOAL,
    to: GOAL * 2,
    canopy: [1.1, 1.3],
    density: [0.93, 1.0],
    reach: [0.9, 1.0],
    glow: [1.5, 1.85],
    particles: [560, 700],
  },
  ]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function getGrowthProfile(
  ideaCount: number,
  goal: number = GOAL_FALLBACK,
): GrowthProfile {
  const count = Math.max(0, ideaCount)
  const stages = stagesFor(goal)
  const def = stages.find((s) => count < s.to) ?? stages[stages.length - 1]
  const span = def.to - def.from
  const t = clamp01(span > 0 ? (count - def.from) / span : 1)

  return {
    stage: def.stage,
    label: def.label,
    progress: t,
    canopyScale: lerp(def.canopy[0], def.canopy[1], t),
    foliageDensity: lerp(def.density[0], def.density[1], t),
    rootReach: lerp(def.reach[0], def.reach[1], t),
    glowIntensity: lerp(def.glow[0], def.glow[1], t),
    particleCount: Math.round(lerp(def.particles[0], def.particles[1], t)),
  }
}

/** Progreso hacia la meta vigente, tope 1. */
export function getGoalProgress(ideaCount: number, goal: number = GOAL_FALLBACK): number {
  return clamp01(ideaCount / goal)
}
