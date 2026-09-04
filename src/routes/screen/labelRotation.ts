import type { Idea } from '../../lib/types'

export interface PickResult {
  idea: Idea
  /** Cursor a guardar para la próxima llamada. */
  cursor: number
}

/**
 * Elige la próxima idea a mostrar en una etiqueta flotante.
 *
 * Recorre el histórico de más nueva a más vieja en ciclo, salteando las que
 * ya están en pantalla. Dos propiedades importan:
 *
 *  - Nunca repite una idea que ya está visible en otro slot.
 *  - Con el tiempo recorre TODO el histórico. Una idea que alguien dejó a
 *    la mañana vuelve a aparecer a la tarde, en vez de perderse para
 *    siempre a los pocos segundos de haber llegado.
 *
 * `mostradas` son las que ya tuvieron su turno en la ronda actual. Se
 * saltean, así cada propuesta se muestra UNA vez por ronda y no queda
 * girando entre las mismas tres cuando no llega nada nuevo — con pocas
 * ideas cargadas, eso se leía como una pantalla congelada.
 *
 * Devuelve null si no queda ninguna candidata en la ronda actual. Quien
 * decide qué hacer con eso es siguienteTurno(), acá abajo: la ronda que se
 * agota empieza otra, no apaga la copa.
 */
export function pickNextIdea(
  pool: Idea[],
  visibleIds: Set<string>,
  cursor: number,
  mostradas?: ReadonlySet<string>,
): PickResult | null {
  if (pool.length === 0) return null

  const start = ((cursor % pool.length) + pool.length) % pool.length

  for (let step = 0; step < pool.length; step++) {
    const offset = (start + step) % pool.length
    // offset 0 = la más nueva.
    const candidate = pool[pool.length - 1 - offset]

    if (candidate && !visibleIds.has(candidate.id) && !mostradas?.has(candidate.id)) {
      return { idea: candidate, cursor: (offset + 1) % pool.length }
    }
  }

  return null
}

export interface TurnoResult {
  idea: Idea
  cursor: number
  /**
   * Memoria de la ronda a partir de este turno.
   *
   * Se devuelve en vez de mutarse porque puede ser una ronda NUEVA: cuando
   * la anterior se agota, acá adentro se decide empezar otra, y quien llama
   * tiene que quedarse con la que corresponde.
   */
  mostradas: Set<string>
}

/**
 * El turno de un slot, empezando una ronda nueva si la anterior se agotó.
 *
 * Antes, agotada la ronda, el slot se vaciaba y la copa quedaba limpia tres
 * minutos. Con el árbol recién arrancado eso no se leía como un descanso:
 * las etiquetas se apagaban de a una cada siete segundos hasta quedar UNA
 * sola —la más vieja, la primera que se había cargado— y después nada. El
 * vecino que acababa de mandar su idea miraba una copa muda.
 *
 * Ahora la ronda siguiente empieza en el acto. Lo que sigue en pantalla
 * —incluida la que está saliendo— arranca la ronda nueva ya usada, así que
 * el turno se lo lleva otra propuesta y el orden sigue siendo justo: todas
 * pasan antes de que alguna repita.
 *
 * Devuelve null sólo si no hay NINGUNA otra propuesta para poner en ese
 * slot. Ahí el slot no se toca: con tres ideas cargadas y tres etiquetas,
 * quietas dicen más que vacías.
 */
export function siguienteTurno(
  pool: Idea[],
  visibles: Set<string>,
  cursor: number,
  mostradas: ReadonlySet<string>,
  saliente: Idea | null,
): TurnoResult | null {
  const enRonda = pickNextIdea(pool, visibles, cursor, mostradas)
  if (enRonda) {
    return {
      idea: enRonda.idea,
      cursor: enRonda.cursor,
      mostradas: new Set([...mostradas, enRonda.idea.id]),
    }
  }

  // Ronda agotada: arranca otra, con lo que hay en pantalla ya usado.
  const nuevaRonda = new Set(visibles)
  if (saliente) nuevaRonda.add(saliente.id)

  const reintento = pickNextIdea(pool, visibles, cursor, nuevaRonda)
  if (!reintento) return null

  nuevaRonda.add(reintento.idea.id)
  return { idea: reintento.idea, cursor: reintento.cursor, mostradas: nuevaRonda }
}
