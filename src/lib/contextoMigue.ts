import { getCategory } from './categories'
import type { Idea, Stats } from './types'

/** Cuántas propuestas se le pasan a Migue como máximo. */
export const MAX_PROPUESTAS = 400

/**
 * Lo que Migue puede ver de cada propuesta.
 *
 * Va el texto, el área, el rango etario y la hora: eso es exactamente lo
 * que hace falta para responder "qué pide cada generación", que es la
 * lectura que el municipio quiere del informe.
 *
 * NO va el nombre de quien la dejó ni el identificador de su dispositivo.
 * Esos datos existen para el análisis agregado dentro de la base, no para
 * salir hacia un servicio externo: el análisis no mejora en nada sabiendo
 * quién firmó, y mandarlo sería exponer un dato personal sin necesidad.
 *
 * Vive en su propio módulo, y no dentro del componente, para que esa regla
 * se pueda verificar sola. Ver scripts/check-ia.ts.
 */
export function armarContextoMigue(ideas: Idea[], stats: Stats): string {
  const lineas = ideas
    // Una idea retirada se retiró por algo. No vuelve por la ventana del
    // análisis.
    .filter((i) => i.status !== 'hidden')
    .slice(0, MAX_PROPUESTAS)
    .map((i) => {
      const hora = new Date(i.created_at).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const edad = i.age_range ? ` | edad: ${i.age_range}` : ''
      return `- [${getCategory(i.category).label}${edad} | ${hora}] ${i.text}`
    })

  return [
    `Participantes: ${stats.participants}`,
    `Propuestas publicadas: ${stats.ideas}`,
    `Áreas con propuestas: ${stats.areas}`,
    '',
    `PROPUESTAS (${lineas.length}):`,
    ...lineas,
  ].join('\n')
}
