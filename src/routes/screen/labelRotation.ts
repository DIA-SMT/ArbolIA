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
 * Devuelve null si no hay ninguna candidata (menos ideas que slots).
 */
export function pickNextIdea(
  pool: Idea[],
  visibleIds: Set<string>,
  cursor: number,
): PickResult | null {
  if (pool.length === 0) return null

  const start = ((cursor % pool.length) + pool.length) % pool.length

  for (let step = 0; step < pool.length; step++) {
    const offset = (start + step) % pool.length
    // offset 0 = la más nueva.
    const candidate = pool[pool.length - 1 - offset]

    if (candidate && !visibleIds.has(candidate.id)) {
      return { idea: candidate, cursor: (offset + 1) % pool.length }
    }
  }

  return null
}
