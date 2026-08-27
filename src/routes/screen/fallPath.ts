import * as THREE from 'three'
import { getBranchFor, getLeafSlot, type TreeModel } from './treeGeometry'
import type { CategorySlug } from '../../lib/types'

/**
 * Trayectoria de una crítica que cae.
 *
 * Vive en su propio módulo, y no dentro del componente, para poder
 * verificarla sin GPU: que salga de la copa, que termine en la tierra, que
 * no suba en ningún tramo y que la misma crítica caiga siempre del mismo
 * punto. Ver scripts/check-criticas.ts.
 */

/** Duración total de la caída, en milisegundos. */
export const CAIDA_MS = 4200

/** Se desprende de la rama. */
export const DESPRENDER_MS = 900
/** Cae. */
export const CAER_MS = 2100
/** Se hunde y las raíces responden. */
export const HUNDIR_MS = 1200

/** Dónde toca la tierra: al pie del tronco, no donde caiga. */
export const SUELO = new THREE.Vector3(0, -0.04, 0)

export interface Caida {
  curva: THREE.CatmullRomCurve3
  color: string
  /** Semilla derivada del id: fija el punto de origen. */
  semilla: number
}

/**
 * Semilla estable a partir del id.
 *
 * Que sea determinista importa: si una crítica se republica desde el panel
 * después de haberla retirado, tiene que volver a caer del mismo lugar. Una
 * posición al azar la haría aparecer en otra rama y parecería otra idea.
 */
export function semillaDe(id: string): number {
  return [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
}

export function buildFallPath(
  model: TreeModel,
  category: CategorySlug,
  id: string,
): Caida {
  const rama = getBranchFor(model, category)
  const semilla = semillaDe(id)
  const slot = getLeafSlot(rama, semilla)

  const origen = slot.position.clone()
  // Un poco por debajo de la hoja: el fruto cuelga, no brota.
  origen.y -= 0.12

  /*
   * El punto medio deriva hacia el pie del árbol.
   *
   * Una plomada recta se leería como un objeto que se soltó; la deriva la
   * convierte en algo que el árbol deja caer hacia su propia base. El
   * desplazamiento lateral se acota para que la curva nunca vuelva a subir:
   * CatmullRom sobrepasa un poco entre puntos de control, y con un medio
   * demasiado alto el fruto haría una panza hacia arriba.
   */
  const medio = new THREE.Vector3(origen.x * 0.45, origen.y * 0.4, origen.z * 0.45)
  medio.x += Math.sin(semilla) * 0.14
  medio.z += Math.cos(semilla) * 0.14

  return {
    curva: new THREE.CatmullRomCurve3([origen, medio, SUELO.clone()]),
    color: rama.color,
    semilla,
  }
}

/**
 * Cuánto extienden las raíces las críticas recibidas.
 *
 * Se suma al alcance que ya da el crecimiento por participación. El tope
 * existe porque el shader recorta la raíz en uReveal = 1: más allá no queda
 * geometría por revelar y el término dejaría de leerse.
 *
 * Con 22 críticas se alcanza el máximo. Alcanza para empujar la base más
 * allá de 0.68 —donde empiezan las raíces secundarias— bastante antes de
 * que llegara sola por cantidad de ideas. O sea que el reclamo no alarga
 * la base: la ramifica.
 */
export const EMPUJE_MAXIMO = 0.22

export function empujeDeRaices(criticas: number): number {
  return Math.min(EMPUJE_MAXIMO, Math.max(0, criticas) * 0.01)
}
