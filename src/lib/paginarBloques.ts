/**
 * Reparto de bloques en páginas A4.
 *
 * EXISTE POR UN BUG CONCRETO: el informe estaba clavado en dos páginas, con
 * el número de página escrito a mano —`pie(1, 2)`, `pie(2, 2)`— y todo el
 * análisis metido en la primera. `.inf__pagina` tiene alto fijo y
 * `overflow: hidden`, así que cuando el texto pasaba de 254 mm el resto
 * desaparecía sin aviso. El equipo veía el informe cortado y no había forma
 * de saber cuánto faltaba.
 *
 * Este módulo es aritmética pura y sin DOM a propósito: el reparto es
 * exactamente lo que se rompe en silencio, y así se puede probar entero
 * desde la línea de comandos. Quien mide los altos es el navegador
 * (ver InformePDF), que es el único que sabe cuánto ocupa un párrafo.
 */

export interface BloqueMedido {
  clave: string
  /** Alto real medido en el navegador, en milímetros de papel. */
  alto: number
  /**
   * Este bloque no puede quedar último en la página.
   *
   * Es para los títulos de sección: un título solo al pie de una página,
   * con su contenido recién en la siguiente, es el defecto de maquetación
   * más visible que puede tener un documento institucional.
   */
  pegadoAlSiguiente?: boolean
}

/**
 * Reparte los bloques respetando la capacidad de cada página.
 *
 * La primera página lleva la portada, así que le queda menos lugar que a las
 * interiores; de ahí los dos límites.
 *
 * Un bloque más alto que una página entera se acepta igual, solo, en su
 * propia página: preferimos una página que se desborde —y que el navegador
 * parta en dos al imprimir— antes que un bloque descartado. Que nunca se
 * pierda contenido es la regla que manda sobre la prolijidad.
 */
export function paginar(
  bloques: BloqueMedido[],
  capacidadPrimera: number,
  capacidadResto: number,
): string[][] {
  if (capacidadPrimera <= 0 || capacidadResto <= 0) {
    throw new Error('La capacidad de página tiene que ser positiva.')
  }

  const paginas: string[][] = []
  let actual: string[] = []
  let usado = 0
  let capacidad = capacidadPrimera
  let i = 0

  while (i < bloques.length) {
    // Un título arrastra consigo al bloque que titula: se miden juntos y
    // viajan juntos a la página siguiente si no entran acá.
    const grupo: BloqueMedido[] = [bloques[i]]
    let fin = i
    while (bloques[fin].pegadoAlSiguiente && fin + 1 < bloques.length) {
      fin += 1
      grupo.push(bloques[fin])
    }
    const altoGrupo = grupo.reduce((t, b) => t + b.alto, 0)

    // Si no entra y la página ya tiene algo, se cierra y se reintenta. La
    // condición `usado > 0` es la que garantiza que esto termina: en una
    // página vacía el grupo entra siempre.
    if (usado > 0 && usado + altoGrupo > capacidad) {
      paginas.push(actual)
      actual = []
      usado = 0
      capacidad = capacidadResto
      continue
    }

    for (const b of grupo) actual.push(b.clave)
    usado += altoGrupo
    i = fin + 1
  }

  if (actual.length > 0) paginas.push(actual)
  return paginas
}

/**
 * Cuántas páginas ocupa un bloque que se desborda.
 *
 * Sirve para que el pie diga "Página 3 de 5" de verdad: si un bloque
 * gigante empuja el papel a dos hojas físicas, el total tiene que contarlas,
 * porque si no el documento dice una cosa y la impresora otra.
 */
export function hojasQueOcupa(altoUsado: number, capacidad: number): number {
  if (capacidad <= 0) throw new Error('La capacidad de página tiene que ser positiva.')
  return Math.max(1, Math.ceil(altoUsado / capacidad))
}
