/**
 * Verificación del informe institucional.
 *
 * EXISTE POR TRES BUGS QUE LLEGARON AL EQUIPO, EN ESTE ORDEN:
 *
 *  1. El PDF salía EN BLANCO. La regla de impresión decía
 *     `body > *:not(.informe-raiz)`, y el informe vive cuatro niveles abajo
 *     de body: la regla escondía al contenedor que lo tenía adentro.
 *
 *  2. El informe salía CORTADO y la pestaña NO SCROLLEABA. Dos causas
 *     distintas con el mismo síntoma: `.inf__pagina` tenía alto fijo con
 *     `overflow: hidden`, y el documento clonaba global.css, que pone
 *     `body { overflow: hidden }`.
 *
 *  3. El informe ERA EL CHAT. Se exportaba la última respuesta de Migue, así
 *     que sin conversación no había documento.
 *
 * Los tres eran invisibles hasta abrir el diálogo de impresión. Lo que se
 * prueba acá es exactamente eso: que el documento tenga el informe adentro,
 * que se pueda scrollear, que el reparto en hojas no pierda contenido y que
 * el informe esté completo sin que Migue haya dicho una palabra.
 *
 *   npm run check:informe
 */
import { readFileSync } from 'node:fs'
import { armarDocumento, nombreSugerido } from '../src/routes/admin/documentoInforme'
import { hojasQueOcupa, paginar, type BloqueMedido } from '../src/lib/paginarBloques'
import {
  areaLider,
  bloquesConClave,
  citasPorArea,
  horaPico,
  planificarInforme,
  porcentaje,
  type DatosInforme,
} from '../src/lib/informePlan'
import { CATEGORIES } from '../src/lib/categories'
import type { AgeStat, Idea, Stats } from '../src/lib/types'
import type { TimelinePoint } from '../src/lib/api'

let fallos = 0
const check = (etiqueta: string, ok: boolean, detalle = '') => {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${etiqueta}${detalle ? ` — ${detalle}` : ''}`)
}

// =====================================================================
// Datos de prueba
// =====================================================================

const statsBase = (over: Partial<Stats> = {}): Stats => ({
  ideas: 120,
  propuestas: 96,
  criticas: 24,
  participants: 83,
  areas: 8,
  byCategory: CATEGORIES.map((c, i) => ({
    slug: c.slug,
    label: c.label,
    emoji: c.emoji,
    color: c.color,
    total: 24 - i * 2,
  })),
  ...over,
})

const idea = (over: Partial<Idea> = {}): Idea => ({
  id: 'i' + Math.random().toString(36).slice(2),
  text: 'Poner más luces en la plaza',
  category: 'espacios',
  status: 'visible',
  archived_at: null,
  created_at: '2026-09-03T14:00:00Z',
  tipo: 'propuesta',
  ...over,
})

const serie: TimelinePoint[] = [
  { hora: '2026-09-03T12:00:00', publicadas: 4, marcadas: 0, dispositivos: 3 },
  { hora: '2026-09-03T13:00:00', publicadas: 19, marcadas: 1, dispositivos: 14 },
  { hora: '2026-09-03T14:00:00', publicadas: 7, marcadas: 0, dispositivos: 6 },
]

const edadesBase: AgeStat[] = [
  { slug: '18-29', label: '18 a 29', total: 40, topArea: 'movilidad' },
  { slug: '30-44', label: '30 a 44', total: 31, topArea: 'ambiente' },
]

const datosBase = (over: Partial<DatosInforme> = {}): DatosInforme => ({
  stats: statsBase(),
  timeline: serie,
  horas: 24,
  ideas: [idea()],
  edades: edadesBase,
  goal: 500,
  analisis: null,
  ...over,
})

// =====================================================================
// 1. Reparto en hojas — que no se pierda contenido
// =====================================================================

console.log('\nREPARTO EN HOJAS')

const b = (clave: string, alto: number, titulo = false): BloqueMedido => ({
  clave,
  alto,
  pegadoAlSiguiente: titulo,
})

// El invariante que importa: nada se pierde y nada se duplica.
const noPierdeNada = (entrada: BloqueMedido[], hojas: string[][]) => {
  const salida = hojas.flat()
  return (
    salida.length === entrada.length &&
    salida.every((c, i) => c === entrada[i].clave)
  )
}

{
  const entrada = [b('a', 50), b('b', 50), b('c', 50)]
  const hojas = paginar(entrada, 221, 254)
  check('lo que entra en una hoja va en una hoja', hojas.length === 1)
  check('no pierde ni reordena bloques', noPierdeNada(entrada, hojas))
}

{
  const entrada = [b('a', 150), b('b', 150), b('c', 150)]
  const hojas = paginar(entrada, 221, 254)
  check(
    'corta cuando se pasa de la capacidad',
    hojas.length === 3,
    `${hojas.length} hojas: ${JSON.stringify(hojas)}`,
  )
  check('tampoco pierde nada al cortar', noPierdeNada(entrada, hojas))
}

{
  // La portada tiene menos lugar que las interiores: 221 contra 254.
  const entrada = [b('a', 200), b('b', 40), b('c', 200)]
  const hojas = paginar(entrada, 221, 254)
  check(
    'la portada usa su propia capacidad, más chica',
    hojas[0].length === 1 && hojas[0][0] === 'a',
    'b mide 40 y no entra en los 21 mm que sobran de la portada',
  )
  check(
    'las interiores usan la capacidad grande',
    hojas[1].join() === 'b,c',
    `${JSON.stringify(hojas)} — 40 + 200 = 240, entra en 254`,
  )
}

{
  // Un título no puede quedar solo al pie de una hoja.
  const entrada = [b('texto', 200), b('titulo', 12, true), b('cuerpo', 100)]
  const hojas = paginar(entrada, 221, 254)
  check(
    'el título viaja con lo que titula',
    hojas.length === 2 && hojas[0].join() === 'texto' && hojas[1].join() === 'titulo,cuerpo',
    JSON.stringify(hojas),
  )
  check('el título no queda huérfano al pie', noPierdeNada(entrada, hojas))
}

{
  // Un bloque más alto que una hoja entera: se acepta solo, no se descarta.
  const entrada = [b('chico', 20), b('gigante', 400), b('otro', 20)]
  const hojas = paginar(entrada, 221, 254)
  check(
    'un bloque más alto que la hoja no se pierde',
    noPierdeNada(entrada, hojas),
    'preferimos una hoja desbordada antes que contenido descartado',
  )
  check(
    'el bloque gigante va solo en su hoja',
    hojas.some((h) => h.length === 1 && h[0] === 'gigante'),
    JSON.stringify(hojas),
  )
}

{
  const hojas = paginar([], 221, 254)
  check('sin bloques no inventa hojas', hojas.length === 0)
}

{
  // Cadena de títulos pegados: no puede quedar girando en el lugar.
  const entrada = [
    b('t1', 300, true),
    b('t2', 300, true),
    b('t3', 300, true),
    b('fin', 10),
  ]
  const hojas = paginar(entrada, 221, 254)
  check(
    'una cadena de títulos pegados termina y no pierde nada',
    noPierdeNada(entrada, hojas),
    `${hojas.length} hoja(s)`,
  )
}

{
  let tiro = false
  try {
    paginar([b('a', 10)], 0, 254)
  } catch {
    tiro = true
  }
  check('una capacidad de cero es un error, no una división rara', tiro)
}

check('un bloque de 300 mm ocupa 2 hojas de 254', hojasQueOcupa(300, 254) === 2)
check('un bloque vacío ocupa 1 hoja, no 0', hojasQueOcupa(0, 254) === 1)

// Barrido: con altos al azar, nunca se pierde un bloque.
{
  let peor = ''
  let malos = 0
  for (let corrida = 0; corrida < 300; corrida++) {
    const n = 1 + Math.floor(Math.random() * 25)
    const entrada = Array.from({ length: n }, (_, i) =>
      b('k' + i, Math.round(Math.random() * 320), Math.random() < 0.2),
    )
    const hojas = paginar(entrada, 221, 254)
    if (!noPierdeNada(entrada, hojas)) {
      malos++
      if (!peor) peor = JSON.stringify(entrada.map((x) => [x.clave, x.alto, !!x.pegadoAlSiguiente]))
    }
  }
  check(
    '300 repartos al azar sin perder un solo bloque',
    malos === 0,
    malos ? `${malos} fallaron, el primero: ${peor}` : '',
  )
}

// =====================================================================
// 2. El plan — el informe está completo sin Migue
// =====================================================================

console.log('\nQUÉ SECCIONES TIENE EL INFORME')

const claves = (d: DatosInforme) => planificarInforme(d).map((s) => s.clave)

{
  const sinMigue = claves(datosBase())
  check(
    'sin una palabra de Migue, el informe igual está completo',
    sinMigue.includes('resumen') &&
      sinMigue.includes('areas') &&
      sinMigue.includes('metodologia') &&
      sinMigue.includes('cierre'),
    'era el bug 3: sin chat no había documento',
  )
  check('y no aparece una sección de análisis vacía', !sinMigue.includes('analisis'))
}

{
  const conMigue = claves(datosBase({ analisis: 'Lo que más se repite es el transporte.' }))
  check('con análisis de Migue, entra como sección', conMigue.includes('analisis'))
  const posicion = conMigue.indexOf('analisis')
  check(
    'el análisis va después del resumen y antes de los datos',
    posicion === conMigue.indexOf('resumen') + 1 && posicion < conMigue.indexOf('areas'),
    conMigue.join(' → '),
  )
}

{
  const soloEspacios = claves(datosBase({ analisis: '   \n  ' }))
  check('un análisis en blanco no crea sección', !soloEspacios.includes('analisis'))
}

{
  const vacio = claves(
    datosBase({
      stats: statsBase({ ideas: 0, propuestas: 0, criticas: 0, participants: 0, areas: 0 }),
      timeline: [],
      ideas: [],
      edades: [],
    }),
  )
  check(
    'con la base vacía el informe sigue siendo un documento válido',
    vacio.includes('resumen') && vacio.includes('metodologia') && vacio.includes('cierre'),
    vacio.join(' → '),
  )
  check('y no dibuja gráficos de nada', !vacio.includes('areas') && !vacio.includes('tiempo'))
}

{
  const sinEdad = claves(datosBase({ edades: [] }))
  check('sin datos de edad no hay sección de edad', !sinEdad.includes('edades'))
  const conEdadCero = claves(
    datosBase({ edades: [{ slug: '18-29', label: '18 a 29', total: 0, topArea: null }] }),
  )
  check('con edades en cero tampoco', !conEdadCero.includes('edades'))
}

{
  const soloPropuestas = claves(datosBase({ ideas: [idea(), idea()] }))
  check('sin reclamos no hay sección de reclamos', !soloPropuestas.includes('criticas'))
  const conCritica = claves(
    datosBase({ ideas: [idea(), idea({ tipo: 'critica', text: 'No pasa el colectivo' })] }),
  )
  check('con reclamos sí', conCritica.includes('criticas'))
}

console.log('\nHONESTIDAD DEL DOCUMENTO')

{
  const secciones = planificarInforme(datosBase())
  const metodologia = secciones.find((s) => s.clave === 'metodologia')
  const texto = metodologia?.bloques.map((x) => ('texto' in x ? x.texto : '')).join(' ') ?? ''
  check(
    'aclara que no es una encuesta representativa',
    /no es una encuesta representativa/i.test(texto),
    'un informe municipal no puede dejar que se lea como un sondeo de la ciudad',
  )
  check(
    'aclara que no hay datos personales en el documento',
    /identificar a una persona/i.test(texto),
  )

  const propuestas = secciones.find((s) => s.clave === 'propuestas')
  const nota = propuestas?.bloques.find((x) => x.tipo === 'nota')
  check(
    'avisa que la selección de citas es automática',
    !!nota && /autom[áa]tica/i.test(nota.texto),
    'presentarla como curaduría sería afirmar algo que no pasó',
  )
}

console.log('\nSELECCIÓN DE CITAS')

{
  const ideas = [
    idea({ category: 'movilidad', text: 'corta' }),
    idea({ category: 'movilidad', text: 'una propuesta bastante más desarrollada y larga' }),
    idea({ category: 'ambiente', text: 'plantar árboles' }),
    idea({ category: 'ambiente', text: 'oculta', status: 'hidden' }),
    idea({ category: 'cultura', text: 'un reclamo', tipo: 'critica' }),
  ]
  const citas = citasPorArea(ideas, 'propuesta', 8)
  check('una cita por área, no varias de la misma', new Set(citas.map((c) => c.area)).size === citas.length)
  check(
    'elige la más desarrollada de cada área',
    citas.find((c) => c.area === 'movilidad')?.texto.startsWith('una propuesta bastante') === true,
  )
  check('no cita ideas ocultas por moderación', !citas.some((c) => c.texto === 'oculta'))
  check('no mezcla reclamos con propuestas', !citas.some((c) => c.tipo === 'critica'))
  check('respeta el máximo', citasPorArea(ideas, 'propuesta', 1).length === 1)
  check(
    'no cita textos vacíos',
    citasPorArea([idea({ text: '   ' })], 'propuesta', 8).length === 0,
  )
}

console.log('\nCUENTAS')

check('un porcentaje sobre cero da cero, no NaN', porcentaje(5, 0) === 0)
check('24 de 120 es 20 %', porcentaje(24, 120) === 20)
check('sin áreas con ideas no hay área líder', areaLider([]) === null)
check(
  'el área líder es la de más ideas',
  areaLider(statsBase().byCategory)?.slug === CATEGORIES[0].slug,
)
check('sin serie no hay hora pico', horaPico([]) === null)
check('la hora pico es la de más ideas', horaPico(serie)?.publicadas === 19)
check(
  'una serie toda en cero no tiene pico',
  horaPico([{ hora: 'x', publicadas: 0, marcadas: 0, dispositivos: 0 }]) === null,
)

console.log('\nBLOQUES APLANADOS')

{
  const aplanados = bloquesConClave(planificarInforme(datosBase({ analisis: 'Hola.' })))
  check('todas las claves son únicas', new Set(aplanados.map((x) => x.clave)).size === aplanados.length)
  check('los títulos vienen marcados', aplanados.some((x) => x.esTitulo && x.titulo))
  check(
    'un título marcado no trae bloque de contenido',
    aplanados.filter((x) => x.esTitulo).every((x) => x.bloque === null),
  )
  check(
    'el título de sección aparece antes que sus bloques',
    aplanados.findIndex((x) => x.clave === 'resumen:titulo') <
      aplanados.findIndex((x) => x.clave === 'resumen:0'),
  )
}

// =====================================================================
// 3. El documento — que se vea y que se pueda scrollear
// =====================================================================

console.log('\nDOCUMENTO EXPORTADO')

const CONTENIDO = `<div class="informe">
  <section class="inf__pagina">
    <div class="inf__hero"><h1 class="inf__titulo">Árbol Virtual de Ideas</h1></div>
    <div class="inf__cuerpo">
      <h2 class="inf__sec">Resumen</h2>
      <p class="md__p">Texto con <strong>negrita</strong>.</p>
      <div class="inf__grafico"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="80"/></svg></div>
      <table class="inf__tabla"><tbody><tr><td>Ambiente</td><td>24</td></tr></tbody></table>
    </div>
    <footer class="inf__pie">Página 1 de 3</footer>
  </section>
</div>`

const HOJA = '.informe { color: #333 } .inf__pagina { min-height: 297mm }'
const doc = armarDocumento(CONTENIDO, HOJA, 'Informe-de-prueba', 'http://localhost:5173/')

check(
  'el informe está dentro del documento',
  doc.includes('class="informe"'),
  'era el bug 1: salía en blanco',
)
check('llega la portada', doc.includes('inf__hero') && doc.includes('inf__titulo'))
check('llega el cuerpo', doc.includes('inf__cuerpo') && doc.includes('inf__sec'))
check('llega el pie con su numeración', doc.includes('Página 1 de 3'))
check('llega el gráfico como SVG', doc.includes('<svg'), 'vectorial, no imagen')
check('llegan las tablas', doc.includes('inf__tabla'))
check('llega el formato del texto', doc.includes('<strong>'))
check('la hoja del informe va embutida', doc.includes(HOJA))

console.log('\nQUE SE PUEDA SCROLLEAR (el bug 2)')

/*
 * El documento sin la hoja del informe: acá se miran SOLO sus propias reglas.
 *
 * Se sacan también los comentarios de CSS. La primera versión de esta
 * comprobación fallaba porque el documento tiene un comentario que EXPLICA el
 * bug del overflow:hidden, y el texto del comentario daba positivo. Lo que
 * hay que buscar son reglas, no menciones.
 */
const propias = doc.replace(HOJA, '').replace(/\/\*[\s\S]*?\*\//g, '')

check(
  'html y body pueden scrollear',
  /html,\s*body\s*\{[^}]*overflow:\s*auto/.test(propias),
  'global.css ponía overflow:hidden y por eso no se podía ver el informe entero',
)
check(
  'el alto es automático, no 100 %',
  /html,\s*body\s*\{[^}]*height:\s*auto/.test(propias),
  'un height:100% heredado tapaba todo lo que pasara de una pantalla',
)
check(
  'no queda ningún overflow:hidden propio del documento',
  !/overflow:\s*hidden/.test(propias),
)
check(
  'no se clonan las hojas de la app',
  !doc.includes('<link rel="stylesheet"'),
  'clonarlas es exactamente lo que arrastraba el overflow:hidden',
)
check(
  'hay base para resolver las imágenes de marca',
  doc.includes('<base href="http://localhost:5173/">'),
  'sin base, /marca/... no apunta a ningún lado en una pestaña en blanco',
)

console.log('\nBARRA DE LA PESTAÑA')

check('hay botón para guardar', doc.includes('window.print()'))
check('explica los ajustes del diálogo', doc.includes('Gráficos de fondo'))
check(
  'la barra no sale en el papel',
  /@media print\s*\{[^}]*\.barra\s*\{\s*display:\s*none/.test(doc),
)
check('el título del documento es el nombre del archivo', doc.includes('<title>Informe-de-prueba</title>'))

console.log('\nNOMBRE DEL ARCHIVO')

const n = nombreSugerido(new Date(2026, 8, 3))
check('dice qué es y de qué día', n === 'Informe-ArbolDeIdeas-2026-09-03', n)

console.log('\nBORDES')

const vacio = armarDocumento('', HOJA)
check(
  'con informe vacío igual devuelve un documento válido',
  vacio.startsWith('<!doctype html>') && vacio.includes('</html>'),
  'no puede tirar una excepción en la cara del equipo',
)

// =====================================================================
// 4. La hoja de estilos — que no vuelva a recortar
// =====================================================================

console.log('\nLA HOJA NO PUEDE RECORTAR (el bug 2, la otra causa)')

const css = readFileSync('src/routes/admin/informe.css', 'utf8')
const regla = (selector: string) => {
  const i = css.indexOf(selector + ' {')
  if (i < 0) return ''
  return css.slice(i, css.indexOf('}', i))
}

const pagina = regla('.inf__pagina')
check('la hoja existe como regla', pagina.length > 0)
check(
  'la página usa min-height, no height fijo',
  /min-height:\s*297mm/.test(pagina) && !/[^-]height:\s*297mm/.test(pagina),
  'con height fijo, todo lo que se pasaba desaparecía',
)
check(
  'la página no recorta lo que se desborda',
  /overflow:\s*visible/.test(pagina) && !/overflow:\s*hidden/.test(pagina),
)

const cuerpo = regla('.inf__cuerpo')
check(
  'el cuerpo tampoco recorta',
  !/overflow:\s*hidden/.test(cuerpo) && !/[^-]height:\s*calc\(297mm - 53mm - 15mm\)/.test(cuerpo),
)
check(
  'el cuerpo reserva los 15 mm del pie',
  /padding:\s*8mm 14mm 15mm/.test(cuerpo),
  'sin eso el último párrafo se escribe debajo del pie',
)

check(
  'el informe tiene maqueta para poder medirlo',
  /\.informe\s*\{\s*display:\s*block/.test(css),
  'con display:none no hay alto que medir y no se puede repartir en hojas',
)
check(
  'cada bloque contiene sus márgenes',
  /\.inf__bloque\s*\{\s*display:\s*flow-root/.test(css),
  'si el margen se escapa, el alto medido sale menor que el real',
)

console.log(
  fallos === 0
    ? '\n  El informe sale completo, repartido y scrolleable.\n'
    : `\n  ${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
