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
 * Devuelve null si no queda ninguna candidata: ahí el slot se vacía y la
 * copa queda limpia hasta que empiece la ronda siguiente.
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
