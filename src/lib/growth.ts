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
    /*
     * EL ÁRBOL ARRANCA PELADO. Densidad cero con cero ideas.
     *
     * Acá había un piso de 0.58 puesto a propósito, con este argumento: con
     * follaje base ralo el árbol se ve como un esqueleto con confeti colgado,
     * y las hojas ciudadanas pierden el fondo contra el que destacan. Con
     * meta 100 eso eran 9.280 hojas dibujadas antes de que llegara la primera
     * idea.
     *
     * Se cambió por pedido del equipo, y el argumento nuevo es más fuerte que
     * el viejo: la instalación promete que la ciudad construye el árbol, y un
     * árbol que ya está frondoso el primer día a las nueve de la mañana
     * desmiente esa promesa antes de que nadie participe. Arrancando pelado,
     * las primeras hojas SON las primeras ideas —cada una identificable— y a
     * lo largo de la feria el árbol florece de verdad.
     *
     * Lo que sí quedó del argumento viejo: un esqueleto oscuro da lástima. Por
     * eso el brillo mínimo de esta etapa subió (ver glow) y la corteza de las
     * ramas se aclaró en TreeStructure. El árbol vacío tiene que leerse como
     * una promesa, no como un árbol muerto.
     */
    density: [0, 0.3],
    reach: [0.4, 0.56],
    // Más brillo que antes en la etapa vacía: es lo único que se ve.
    glow: [0.95, 1.1],
    particles: [140, 260],
  },
  {
    stage: 'joven',
    label: 'Joven',
    from: Math.round(GOAL * 0.2),
    to: Math.round(GOAL * 0.5),
    canopy: [0.72, 0.9],
    /*
     * La cadena de densidad tiene que ser CONTINUA entre etapas.
     *
     * Si una etapa termina en un número distinto del que arranca la
     * siguiente, al cruzar la frontera el follaje da un salto instantáneo de
     * miles de hojas. La cadena es 0 → 0.3 → 0.55 → 0.8 → 1.
     *
     * Y es deliberadamente lenta: el árbol tiene que seguir llenándose los
     * dos días. Antes llegaba a 0.82 en la mitad de la meta y de ahí en más
     * casi no cambiaba, así que la segunda jornada no se veía crecer nada.
     */
    density: [0.3, 0.55],
    reach: [0.56, 0.73],
    glow: [1.1, 1.3],
    particles: [260, 400],
  },
  {
    stage: 'frondoso',
    label: 'Frondoso',
    from: Math.round(GOAL * 0.5),
    to: GOAL,
    canopy: [0.9, 1.1],
    density: [0.55, 0.8],
    reach: [0.73, 0.9],
    glow: [1.3, 1.5],
    particles: [400, 560],
  },
  {
    stage: 'pleno',
    label: 'Pleno',
    from: GOAL,
    to: GOAL * 2,
    canopy: [1.1, 1.3],
    density: [0.8, 1.0],
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
