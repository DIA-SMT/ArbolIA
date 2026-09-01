/**
 * Formato del texto que devuelve Migue.
 *
 * Migue escribe en markdown —negritas, listas, algún título— porque es lo que
 * hace cualquier modelo de lenguaje sin que se lo pidan. La burbuja lo pintaba
 * crudo, así que en pantalla salía "**Reclamos puros** (5 de 17)" con los
 * asteriscos a la vista.
 *
 * Esto lo convierte en una estructura, y el componente la dibuja con nodos de
 * React. NO se genera HTML en ningún momento, y es a propósito: el texto lo
 * escribe un modelo a partir de propuestas que cargan vecinos desde sus
 * celulares. Pasar eso por innerHTML sería darle a cualquiera un camino para
 * inyectar marcado en el panel del municipio.
 *
 * Sólo se interpreta lo que Migue usa de verdad. Nada de tablas, links ni
 * imágenes: un intérprete de markdown completo es superficie de ataque y
 * trabajo de mantenimiento a cambio de nada.
 */

export type Trozo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fuerte'; texto: string }
  | { tipo: 'enfasis'; texto: string }
  | { tipo: 'codigo'; texto: string }

export type Bloque =
  | { tipo: 'parrafo'; trozos: Trozo[] }
  | { tipo: 'titulo'; nivel: number; trozos: Trozo[] }
  | { tipo: 'lista'; ordenada: boolean; items: Trozo[][] }
  /** Marcador de gráfico: [grafico:areas]. Ver informe/graficos. */
  | { tipo: 'grafico'; cual: string }

/** `[grafico:areas]` en una línea sola. */
const MARCA_GRAFICO = /^\[grafico:([a-z-]+)\]$/i

/**
 * Divide una línea en trozos con formato.
 *
 * El orden importa: primero el código entre acentos graves, porque adentro de
 * un bloque de código los asteriscos son literales y no marcas.
 */
export function analizarLinea(linea: string): Trozo[] {
  const trozos: Trozo[] = []
  // Código, negrita, itálica. La negrita antes que la itálica: si no, ** se
  // leería como dos aperturas de itálica y quedaría todo torcido.
  const patron = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__/g

  let ultimo = 0
  let m: RegExpExecArray | null

  while ((m = patron.exec(linea)) !== null) {
    if (m.index > ultimo) {
      trozos.push({ tipo: 'texto', texto: linea.slice(ultimo, m.index) })
    }
    if (m[1] !== undefined) trozos.push({ tipo: 'codigo', texto: m[1] })
    else if (m[2] !== undefined) trozos.push({ tipo: 'fuerte', texto: m[2] })
    else if (m[3] !== undefined) trozos.push({ tipo: 'enfasis', texto: m[3] })
    else if (m[4] !== undefined) trozos.push({ tipo: 'fuerte', texto: m[4] })
    ultimo = patron.lastIndex
  }

  if (ultimo < linea.length) {
    trozos.push({ tipo: 'texto', texto: linea.slice(ultimo) })
  }

  return trozos.length > 0 ? trozos : [{ tipo: 'texto', texto: linea }]
}

/** Convierte el texto de Migue en bloques dibujables. */
export function analizarMarkdown(texto: string): Bloque[] {
  const bloques: Bloque[] = []
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')

  let parrafo: string[] = []
  let lista: { ordenada: boolean; items: string[] } | null = null

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return
    bloques.push({ tipo: 'parrafo', trozos: analizarLinea(parrafo.join(' ')) })
    parrafo = []
  }

  const cerrarLista = () => {
    if (!lista) return
    bloques.push({
      tipo: 'lista',
      ordenada: lista.ordenada,
      items: lista.items.map(analizarLinea),
    })
    lista = null
  }

  for (const cruda of lineas) {
    const linea = cruda.trimEnd()
    const limpia = linea.trim()

    if (limpia === '') {
      cerrarParrafo()
      cerrarLista()
      continue
    }

    const grafico = limpia.match(MARCA_GRAFICO)
    if (grafico) {
      cerrarParrafo()
      cerrarLista()
      bloques.push({ tipo: 'grafico', cual: grafico[1].toLowerCase() })
      continue
    }

    const titulo = limpia.match(/^(#{1,4})\s+(.*)$/)
    if (titulo) {
      cerrarParrafo()
      cerrarLista()
      bloques.push({
        tipo: 'titulo',
        nivel: titulo[1].length,
        trozos: analizarLinea(titulo[2]),
      })
      continue
    }

    const vinieta = limpia.match(/^[-*•]\s+(.*)$/)
    const numerada = limpia.match(/^\d+[.)]\s+(.*)$/)

    if (vinieta || numerada) {
      cerrarParrafo()
      const ordenada = Boolean(numerada)
      const texto = (vinieta?.[1] ?? numerada?.[1]) ?? ''
      // Si cambia el tipo de lista, se cierra la anterior: mezclarlas en una
      // sola dejaría números y viñetas en la misma columna.
      if (lista && lista.ordenada !== ordenada) cerrarLista()
      if (!lista) lista = { ordenada, items: [] }
      lista.items.push(texto)
      continue
    }

    cerrarLista()
    parrafo.push(limpia)
  }

  cerrarParrafo()
  cerrarLista()

  return bloques
}
