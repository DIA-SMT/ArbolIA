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

// ---------------------------------------------------------------------
// Acomodo completo: etiquetas, paneles fijos y bordes de pantalla
// ---------------------------------------------------------------------

/** Un rectángulo que las etiquetas no pueden pisar, en píxeles de pantalla. */
export interface Zona {
  izq: number
  der: number
  arriba: number
  abajo: number
}

export interface Acomodo {
  /** Desplazamiento horizontal en píxeles. */
  dx: number
  /** Desplazamiento vertical en píxeles. */
  dy: number
  /** No se encontró lugar libre: conviene apagarla en vez de superponerla. */
  oculta: boolean
}

function seCruzan(a: Zona, b: Zona): boolean {
  return a.izq < b.der && b.izq < a.der && a.arriba < b.abajo && b.arriba < a.abajo
}


/**
 * Ubica cada etiqueta en un lugar libre.
 *
 * `resolverColisiones` sólo mira etiquetas contra etiquetas y sólo empuja
 * hacia abajo. Alcanzaba mientras el árbol estaba chico y centrado, pero con
 * el encuadre nuevo las etiquetas llegan a los costados y ahí se topan con
 * algo que aquella función no sabe que existe: los paneles fijos del overlay
 * —el título, la columna de contadores, el ranking por área y las últimas
 * ideas—. Medido en pantalla, una tarjeta tapaba el título por 4234 píxeles
 * cuadrados. Y contra un panel lateral bajar no sirve de nada: hay que salir
 * de costado.
 *
 * SE ELIGE ENTRE POSICIONES CANDIDATAS, NO SE EMPUJA.
 *
 * La primera versión empujaba en un ciclo: sacar del panel, corregir contra
 * las otras etiquetas, meter de vuelta en el cuadro, repetir. En el papel
 * convergía; en pantalla se desbocó. Una etiqueta parada sobre un panel
 * pegado al borde escapaba hacia afuera del cuadro, el ajuste del borde la
 * traía de vuelta encima del panel, y la vuelta siguiente repetía el viaje
 * sumando cada vez. Medido en el navegador: `translate: -1240px` en una
 * ventana de 922 px de ancho. La etiqueta no se veía por ningún lado.
 *
 * Acá se arma un puñado de posiciones posibles —quedarse quieta, y salir por
 * cada uno de los cuatro lados de cada obstáculo, más las combinaciones de
 * una salida horizontal con una vertical— se descartan las que no sirven y
 * se elige la más cercana a la posición original. No hay acumulación posible:
 * cada candidata es un desplazamiento absoluto desde el ancla.
 *
 * Si ninguna candidata sirve, la etiqueta se apaga. En el stand es preferible
 * una idea menos en pantalla que una idea ilegible encima del ranking.
 */
export function acomodar(
  cajas: CajaEtiqueta[],
  zonas: Zona[],
  viewport: { ancho: number; alto: number },
  margen: number,
): Acomodo[] {
  const salida: Acomodo[] = cajas.map(() => ({ dx: 0, dy: 0, oculta: false }))

  const orden = cajas
    .map((caja, i) => ({ caja, i }))
    .filter((x) => x.caja.visible)
    .sort((a, b) => a.caja.y - b.caja.y)

  const colocadas: Zona[] = []

  const rectDe = (c: CajaEtiqueta, dx: number, dy: number): Zona => ({
    izq: c.x + dx - c.ancho / 2,
    der: c.x + dx + c.ancho / 2,
    arriba: c.y + dy - c.alto / 2,
    abajo: c.y + dy + c.alto / 2,
  })

  const entraEnCuadro = (r: Zona) =>
    r.izq >= margen &&
    r.der <= viewport.ancho - margen &&
    r.arriba >= margen &&
    r.abajo <= viewport.alto - margen

  for (const { caja, i } of orden) {
    const base = rectDe(caja, 0, 0)
    const estorbos = [...zonas, ...colocadas]

    /*
     * Las salidas de cada obstáculo, por separado en cada eje. Se calculan
     * desde la posición ORIGINAL: son destinos, no empujones encadenados.
     *
     * Se toman de TODOS los obstáculos, no sólo de los que pisa ahora.
     * Limitarlo a los que estorban en la posición inicial dejaba a la
     * etiqueta sin salidas para el panel que se encuentra DESPUÉS de
     * moverse, y se apagaba teniendo lugar al lado: en el barrido de la
     * verificación, 148 de 200 posiciones quedaban sin ubicar.
     */
    const horizontales = new Set<number>([0])
    const verticales = new Set<number>([0])
    for (const z of estorbos) {
      horizontales.add(z.izq - margen - base.der)
      horizontales.add(z.der + margen - base.izq)
      verticales.add(z.arriba - margen - base.abajo)
      verticales.add(z.abajo + margen - base.arriba)
    }

    let mejor: { dx: number; dy: number } | null = null
    let mejorCosto = Infinity

    for (const dx of horizontales) {
      for (const dy of verticales) {
        const r = rectDe(caja, dx, dy)
        if (!entraEnCuadro(r)) continue
        if (estorbos.some((z) => seCruzan(r, z))) continue

        // La más cercana al lugar donde el árbol la puso: mover una etiqueta
        // más de lo necesario la despega de su hoja sin motivo.
        const costo = Math.hypot(dx, dy)
        if (costo < mejorCosto) {
          mejorCosto = costo
          mejor = { dx, dy }
        }
      }
    }

    if (mejor) {
      salida[i] = { dx: mejor.dx, dy: mejor.dy, oculta: false }
      colocadas.push(rectDe(caja, mejor.dx, mejor.dy))
    } else {
      // Sin lugar: se apaga y no reserva espacio para las que siguen.
      salida[i] = { dx: 0, dy: 0, oculta: true }
    }
  }

  return salida
}
