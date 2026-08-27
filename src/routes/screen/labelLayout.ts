/**
 * Resolución de colisiones entre etiquetas flotantes.
 *
 * Lógica pura, separada del render para poder verificarla sin navegador: es
 * geometría de cajas en coordenadas de pantalla, no depende de three ni del
 * DOM.
 */

export interface CajaEtiqueta {
  /** Centro horizontal en píxeles de pantalla. */
  x: number
  ancho: number
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
 * Sólo se empujan las que se solapan EN LOS DOS EJES. La versión anterior
 * apilaba todas en una única columna, ignorando la horizontal: dos etiquetas
 * en extremos opuestos de la pantalla se corrían entre sí sin motivo, y como
 * la cámara orbita, el orden vertical cambiaba constantemente y los
 * desplazamientos no alcanzaban nunca a estabilizarse. En pantalla se veía
 * como textos que se pisan y tiemblan.
 *
 * Sólo baja, nunca sube: si empujara en las dos direcciones, dos etiquetas
 * cercanas se separarían simétricamente y el conjunto se movería entero cada
 * vez que la cámara las cruza.
 */
export function resolverColisiones(cajas: CajaEtiqueta[], margen: number): number[] {
  const offsets = new Array<number>(cajas.length).fill(0)

  // De arriba hacia abajo, sin perder de vista cuál era cada una.
  const orden = cajas
    .map((caja, i) => ({ caja, i }))
    .filter((x) => x.caja.visible)
    .sort((a, b) => a.caja.y - b.caja.y)

  /** Las que ya encontraron lugar, con su posición final. */
  const colocadas: Array<{ izq: number; der: number; abajo: number }> = []

  for (const { caja, i } of orden) {
    const izq = caja.x - caja.ancho / 2
    const der = caja.x + caja.ancho / 2

    let empuje = 0

    /*
     * Punto fijo: bajar para esquivar una caja puede meter la etiqueta
     * debajo de otra que antes no molestaba. Se repite hasta que ninguna
     * la toque. El tope de vueltas es la cantidad de cajas ya colocadas:
     * más que eso sería imposible, y así no hay forma de quedarse girando.
     */
    for (let vuelta = 0; vuelta <= colocadas.length; vuelta++) {
      let movio = false

      for (const c of colocadas) {
        const seCruzanEnX = izq < c.der && c.izq < der
        if (!seCruzanEnX) continue

        const arriba = caja.y - caja.alto / 2 + empuje
        const falta = c.abajo + margen - arriba
        if (falta > 0) {
          empuje += falta
          movio = true
        }
      }

      if (!movio) break
    }

    offsets[i] = empuje
    colocadas.push({ izq, der, abajo: caja.y + caja.alto / 2 + empuje })
  }

  return offsets
}
