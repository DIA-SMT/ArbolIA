/**
 * Qué dice el informe institucional, decidido desde los datos.
 *
 * POR QUÉ EXISTE.
 *
 * La primera versión exportaba la última respuesta de Migue: el documento
 * era, literalmente, un mensaje de chat enmarcado. Si Migue no había
 * contestado no había informe, y si contestaba corto el informe salía corto.
 * Un documento que va a la gestión no puede depender de qué se le preguntó
 * al asistente hace un rato.
 *
 * Ahora el informe se arma desde lo que hay en la base y está completo
 * siempre. El análisis de Migue es UNA sección —la que aporta lectura, no la
 * que aporta datos— y cuando no está, el resto del documento sigue en pie.
 *
 * Este módulo es puro: decide y redacta, no dibuja. Así se puede probar qué
 * secciones aparecen con cada estado de los datos sin abrir un navegador,
 * que es donde estaba el problema anterior.
 */
import { analizarMarkdown, type Bloque } from './formatoMigue'
import type { AgeStat, CategoryCount, Idea, Stats } from './types'
import type { TimelinePoint } from './api'

export type Grafico = 'areas' | 'tiempo'

export type BloquePlan =
  | { tipo: 'kpis' }
  | { tipo: 'parrafo'; texto: string }
  /** Markdown de Migue: puede traer negritas, listas y títulos. */
  | { tipo: 'markdown'; texto: string }
  | { tipo: 'grafico'; cual: Grafico }
  /** Barra de reparto entre propuestas y reclamos: hojas contra raíces. */
  | { tipo: 'balance' }
  | { tipo: 'tablaAreas' }
  | { tipo: 'tablaEdades' }
  | { tipo: 'citas'; items: Cita[] }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'cierre'; texto: string }

/**
 * Los alias que puede escribir Migue para cada gráfico.
 *
 * Un modelo puede inventar un nombre, y eso no puede romper el informe: lo
 * que no está en esta lista devuelve null y no dibuja nada.
 */
export function normalizarGrafico(cual: string): Grafico | null {
  const limpio = cual.trim().toLowerCase()
  if (limpio === 'areas' || limpio === 'área' || limpio === 'area' || limpio === 'anillo') {
    return 'areas'
  }
  if (limpio === 'tiempo' || limpio === 'linea' || limpio === 'línea' || limpio === 'ritmo') {
    return 'tiempo'
  }
  return null
}

/**
 * Qué gráficos pidió Migue dentro de su análisis.
 *
 * ES LO QUE ARREGLA LOS GRÁFICOS REPETIDOS. El informe trae sus propias
 * secciones de área y de tiempo, y Migue además puede pedir el mismo gráfico
 * con un marcador: el resultado eran dos anillos iguales, o tres.
 *
 * Con esto la sección fija sabe que Migue ya lo puso y le cede el lugar. Gana
 * la ubicación de Migue porque es la contextual: el gráfico queda al lado del
 * párrafo que lo explica, en vez de en una sección aparte.
 */
export function graficosPedidos(analisis?: string | null): Set<Grafico> {
  const pedidos = new Set<Grafico>()
  if (!analisis?.trim()) return pedidos
  for (const bloque of analizarMarkdown(analisis)) {
    if (bloque.tipo !== 'grafico') continue
    const cual = normalizarGrafico(bloque.cual)
    if (cual) pedidos.add(cual)
  }
  return pedidos
}

/**
 * El análisis de Migue con cada gráfico una sola vez.
 *
 * Si escribe [grafico:areas] tres veces —pasa— se dibuja el primero y se
 * descartan los demás. Los marcadores que no existen también se sacan acá,
 * así no dejan un bloque vacío ocupando lugar en la hoja.
 */
export function sinGraficosRepetidos(analisis: string): Bloque[] {
  const vistos = new Set<Grafico>()
  const salida: Bloque[] = []
  for (const bloque of analizarMarkdown(analisis)) {
    if (bloque.tipo !== 'grafico') {
      salida.push(bloque)
      continue
    }
    const cual = normalizarGrafico(bloque.cual)
    if (!cual || vistos.has(cual)) continue
    vistos.add(cual)
    salida.push({ ...bloque, cual })
  }
  return salida
}

export interface Cita {
  texto: string
  area: string
  tipo: 'propuesta' | 'critica'
}

export interface SeccionPlan {
  clave: string
  titulo?: string
  bloques: BloquePlan[]
}

export interface DatosInforme {
  stats: Stats
  timeline: TimelinePoint[]
  horas: number
  ideas: Idea[]
  edades: AgeStat[]
  goal: number
  /** Lo último que analizó Migue, en markdown. Puede no haber. */
  analisis?: string | null
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function mesYAnio(fecha: Date): string {
  return MESES[fecha.getMonth()] + ' ' + fecha.getFullYear()
}

const num = (n: number) => n.toLocaleString('es-AR')

/** Porcentaje entero, sin dividir por cero. */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 100)
}

/** El área más elegida. Devuelve null si todavía no hay nada. */
export function areaLider(areas: CategoryCount[]): CategoryCount | null {
  const conAlgo = areas.filter((a) => a.total > 0)
  if (!conAlgo.length) return null
  return conAlgo.reduce((mejor, a) => (a.total > mejor.total ? a : mejor))
}

/** La hora de mayor participación, para poder decir cuándo se llenó el stand. */
export function horaPico(timeline: TimelinePoint[]): TimelinePoint | null {
  const conAlgo = timeline.filter((p) => p.publicadas > 0)
  if (!conAlgo.length) return null
  return conAlgo.reduce((mejor, p) => (p.publicadas > mejor.publicadas ? p : mejor))
}

/** "14 h" a partir del inicio de hora que devuelve la base. */
export function etiquetaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return String(d.getHours()).padStart(2, '0') + ' h'
}

/**
 * Selección de citas, una por área.
 *
 * El criterio es la extensión, y es deliberado: entre dos propuestas de la
 * misma área, la más desarrollada es la que más dice. Una por área para que
 * el documento muestre el ancho de la ciudad y no ocho veces el mismo tema.
 *
 * Es un criterio automático, no una curaduría, y el informe lo aclara. Un
 * documento municipal que presenta una selección como si alguien la hubiera
 * elegido a mano está afirmando algo que no pasó.
 */
export function citasPorArea(
  ideas: Idea[],
  tipo: 'propuesta' | 'critica',
  maximo: number,
): Cita[] {
  const mejorPorArea = new Map<string, Idea>()
  for (const idea of ideas) {
    const suTipo = idea.tipo === 'critica' ? 'critica' : 'propuesta'
    if (suTipo !== tipo) continue
    if (idea.status !== 'visible') continue
    const texto = idea.text?.trim()
    if (!texto) continue
    const previa = mejorPorArea.get(idea.category)
    if (!previa || texto.length > previa.text.trim().length) {
      mejorPorArea.set(idea.category, idea)
    }
  }
  return [...mejorPorArea.values()]
    .sort((a, b) => b.text.trim().length - a.text.trim().length)
    .slice(0, maximo)
    .map((i) => ({ texto: i.text.trim(), area: i.category, tipo }))
}

/**
 * El plan completo del informe.
 *
 * El orden importa: primero cuánto llegó, después la lectura de Migue,
 * después el detalle por área y por hora, después la voz de los vecinos, y
 * al final las aclaraciones. Es el orden en el que alguien que no estuvo en
 * el stand puede entender lo que pasó.
 */
export function planificarInforme(datos: DatosInforme): SeccionPlan[] {
  const { stats, timeline, ideas, edades, goal, analisis } = datos
  const secciones: SeccionPlan[] = []

  /*
   * Qué gráficos ubicó Migue él mismo dentro de su análisis.
   *
   * Las secciones fijas de abajo consultan esto para no repetirlos: era el
   * motivo por el que el informe salía con el mismo anillo dos y tres veces.
   */
  const deMigue = graficosPedidos(analisis)

  // ---- Resumen: siempre, y sin depender de nadie ----
  const lider = areaLider(stats.byCategory)
  const pico = horaPico(timeline)
  const cumplida = porcentaje(stats.ideas, goal)

  const frases: string[] = []
  frases.push(
    stats.ideas === 0
      ? 'Todavía no se registraron ideas. Este informe queda listo para cuando empiece la participación.'
      : 'Se registraron ' + num(stats.ideas) + ' ideas de ' + num(stats.participants) +
        ' vecinos, repartidas en ' + stats.areas + ' de las ocho áreas de la ciudad. ' +
        'Sobre la meta vigente de ' + num(goal) + ', la participación alcanzó el ' + cumplida + ' %.',
  )
  if (stats.ideas > 0) {
    frases.push(
      'Del total, ' + num(stats.propuestas) + ' son propuestas (' +
        porcentaje(stats.propuestas, stats.ideas) + ' %) y ' + num(stats.criticas) +
        ' son reclamos (' + porcentaje(stats.criticas, stats.ideas) + ' %). En la instalación ' +
        'las dos cosas se ven: la propuesta brota como hoja en su rama y el reclamo cae desde ' +
        'la copa y extiende las raíces.',
    )
  }
  if (lider) {
    frases.push(
      'El área más elegida fue ' + lider.label + ', con ' + num(lider.total) + ' ideas (' +
        porcentaje(lider.total, stats.ideas) + ' % del total).',
    )
  }
  if (pico) {
    frases.push(
      'El momento de mayor participación fue a las ' + etiquetaHora(pico.hora) + ', con ' +
        num(pico.publicadas) + ' ideas en esa hora.',
    )
  }

  secciones.push({
    clave: 'resumen',
    titulo: 'Resumen',
    bloques: [
      { tipo: 'kpis' },
      // La barra de reparto va arriba de todo: es la lectura que define al
      // proyecto —cuánto de lo que llegó es propuesta y cuánto reclamo— y se
      // entiende sin leer una sola cifra.
      ...(stats.ideas > 0 ? [{ tipo: 'balance' as const }] : []),
      ...frases.map((texto) => ({ tipo: 'parrafo' as const, texto })),
    ],
  })

  // ---- El análisis de Migue: sólo si lo hay ----
  const analisisLimpio = analisis?.trim()
  if (analisisLimpio) {
    secciones.push({
      clave: 'analisis',
      titulo: 'Análisis de lo recibido',
      bloques: [{ tipo: 'markdown', texto: analisisLimpio }],
    })
  }

  /*
   * ---- Por área ----
   *
   * Si Migue ya puso el anillo dentro de su análisis, la sección le cede el
   * gráfico y se queda con la tabla. Antes se dibujaban los dos y el informe
   * salía con el mismo anillo repetido.
   */
  if (stats.ideas > 0) {
    const bloques: BloquePlan[] = []
    if (!deMigue.has('areas')) bloques.push({ tipo: 'grafico', cual: 'areas' })
    bloques.push({ tipo: 'tablaAreas' })
    secciones.push({ clave: 'areas', titulo: 'Participación por área', bloques })
  }

  /*
   * ---- Por hora ----
   *
   * Esta sección es sólo el gráfico, así que si Migue ya lo ubicó en su
   * análisis no queda nada que mostrar y la sección entera no va: un título
   * con una hoja en blanco abajo es peor que no tener la sección.
   */
  if (timeline.some((p) => p.publicadas > 0) && !deMigue.has('tiempo')) {
    secciones.push({
      clave: 'tiempo',
      titulo: 'Ritmo de participación',
      bloques: [{ tipo: 'grafico', cual: 'tiempo' }],
    })
  }

  // ---- Quién participó ----
  if (edades.some((e) => e.total > 0)) {
    secciones.push({
      clave: 'edades',
      titulo: 'Quién participó',
      bloques: [
        { tipo: 'tablaEdades' },
        {
          tipo: 'parrafo',
          texto:
            'El rango etario es opcional y se pide agrupado, no como edad exacta: en un stand ' +
            'público participan menores, y el rango da la misma lectura estadística sin guardar ' +
            'un dato sensible. Se usa únicamente agregado.',
        },
      ],
    })
  }

  // ---- La voz de los vecinos ----
  const propuestas = citasPorArea(ideas, 'propuesta', 8)
  if (propuestas.length) {
    secciones.push({
      clave: 'propuestas',
      titulo: 'Propuestas, en palabras de los vecinos',
      bloques: [
        { tipo: 'citas', items: propuestas },
        {
          tipo: 'nota',
          texto:
            'Selección automática: la propuesta más extensa de cada área, hasta ocho. No es una ' +
            'curaduría del equipo.',
        },
      ],
    })
  }

  const criticas = citasPorArea(ideas, 'critica', 6)
  if (criticas.length) {
    secciones.push({
      clave: 'criticas',
      titulo: 'Lo que la ciudad reclama',
      bloques: [
        { tipo: 'citas', items: criticas },
        {
          tipo: 'nota',
          texto:
            'Selección automática por extensión, hasta seis. Los reclamos se publican igual que ' +
            'las propuestas: en la instalación caen desde la copa y extienden las raíces.',
        },
      ],
    })
  }

  // ---- Aclaraciones: siempre ----
  secciones.push({
    clave: 'metodologia',
    titulo: 'Sobre estos datos',
    bloques: [
      {
        tipo: 'parrafo',
        texto:
          'Las ideas se recibieron en el stand de la Municipalidad en ExpoCom, desde el celular de ' +
          'cada participante y sin registro previo. De cada una se guarda el texto, el área elegida, ' +
          'el momento y, si la persona quiso darlo, el rango etario.',
      },
      {
        tipo: 'parrafo',
        texto:
          'No es una encuesta representativa de San Miguel de Tucumán. Participó quien pasó por el ' +
          'stand y quiso hacerlo, así que estos datos describen a ese público y no a la ciudad ' +
          'entera. Sirven para saber qué temas aparecen y con qué fuerza, no para estimar cuánta ' +
          'gente en la ciudad piensa cada cosa.',
      },
      {
        tipo: 'parrafo',
        texto:
          'En la pantalla del stand se publica únicamente el texto de la idea. Ningún dato que ' +
          'permita identificar a una persona sale de la base ni aparece en este documento.',
      },
    ],
  })

  secciones.push({
    clave: 'cierre',
    bloques: [
      {
        tipo: 'cierre',
        texto:
          stats.ideas === 0
            ? 'El sistema quedó operativo y a la espera de la primera idea.'
            : num(stats.ideas) + ' ideas quedaron registradas con su área y su momento. ' +
              'El conjunto está disponible en el panel para el análisis posterior de la gestión.',
      },
    ],
  })

  return secciones
}

/**
 * Los bloques de todas las secciones, aplanados y con clave única.
 *
 * El título de sección viaja como bloque propio y marcado, para que el
 * repartidor de páginas pueda pegarlo a lo que titula y no dejarlo huérfano
 * al pie de una hoja.
 */
export interface BloqueAplanado {
  clave: string
  seccion: string
  /** null cuando el bloque es el título de la sección. */
  bloque: BloquePlan | null
  esTitulo: boolean
  titulo?: string
}

export function bloquesConClave(secciones: SeccionPlan[]): BloqueAplanado[] {
  const salida: BloqueAplanado[] = []
  for (const s of secciones) {
    if (s.titulo) {
      salida.push({
        clave: s.clave + ':titulo',
        seccion: s.clave,
        bloque: null,
        esTitulo: true,
        titulo: s.titulo,
      })
    }
    s.bloques.forEach((b, i) => {
      salida.push({ clave: s.clave + ':' + i, seccion: s.clave, bloque: b, esTitulo: false })
    })
  }
  return salida
}
