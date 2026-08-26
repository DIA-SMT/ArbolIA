/**
 * Resolución de colisiones entre etiquetas flotantes.
 *
 * Lógica pura, separada del render para poder verificarla sin navegador: es
 * geometría de cajas en coordenadas de pantalla, no depende de three ni del
 * DOM.
 */

export interface CajaEtiqueta {
  /** Centro vertical en píxeles de pantalla. */
  y: number
  alto: number
  /** Una etiqueta atenuada no ocupa lugar: correr las visibles por algo que
   *  no se ve las movería sin motivo. */
  visible: boolean
}

/**
 * Devuelve, para cada caja, cuántos píxeles hay que bajarla para que no pise
 * a las de arriba. Cero si no hace falta.
 *
 * Recorre de arriba hacia abajo y empuja lo mínimo necesario. Sólo baja,
 * nunca sube: si empujara en las dos direcciones, dos etiquetas cercanas se
 * separarían simétricamente y el conjunto se movería entero cada vez que la
 * cámara las cruza.
 */
export function resolverColisiones(cajas: CajaEtiqueta[], margen: number): number[] {
  const offsets = new Array<number>(cajas.length).fill(0)

  // Índices ordenados por posición vertical, sin perder de vista cuál era
  // cada uno.
  const orden = cajas
    .map((caja, i) => ({ caja, i }))
    .filter((x) => x.caja.visible)
    .sort((a, b) => a.caja.y - b.caja.y)

  let limiteInferior = -Infinity

  for (const { caja, i } of orden) {
    const arriba = caja.y - caja.alto / 2
    const empuje = arriba < limiteInferior ? limiteInferior - arriba : 0

    offsets[i] = empuje
    limiteInferior = caja.y + caja.alto / 2 + empuje + margen
  }

  return offsets
}
