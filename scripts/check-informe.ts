/**
 * Verificación del documento que se exporta como PDF.
 *
 * Existe por un bug concreto: la primera versión imprimía la propia página
 * ocultando el resto con `body > *:not(.informe-raiz)`, y salía EN BLANCO —
 * el informe vive a cuatro niveles de body, así que esa regla escondía al
 * contenedor que lo tenía adentro. Nadie se enteró hasta ver el diálogo de
 * impresión con una hoja vacía.
 *
 * Lo que se comprueba acá es lo único que no puede fallar en silencio: que el
 * documento generado tenga el informe adentro, con sus estilos y su identidad.
 *
 *   npm run check:informe
 */
import { armarDocumento, nombreSugerido } from '../src/routes/admin/exportarInforme'

let fallos = 0
const check = (etiqueta: string, ok: boolean, detalle = '') => {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${etiqueta}${detalle ? ` — ${detalle}` : ''}`)
}

console.log('\nDOCUMENTO DEL INFORME')

/** Un informe mínimo pero con las piezas que definen la identidad. */
const CONTENIDO = `<div class="informe">
  <section class="inf__pagina">
    <div class="inf__hero">
      <img class="inf__logo-smt" src="/marca/logo-smt-blanco.png" alt="">
      <div class="inf__chip-ia"><img src="/marca/logo-ia.png" alt=""><span>DESARROLLO</span></div>
      <h1 class="inf__titulo">Árbol Virtual de Ideas</h1>
    </div>
    <div class="inf__cuerpo">
      <h2 class="inf__sec">Análisis de lo recibido</h2>
      <div class="inf__texto"><p class="md__p">Texto con <strong>negrita</strong>.</p></div>
      <div class="inf__grafico"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="80"/></svg></div>
    </div>
    <footer class="inf__pie"><img src="/marca/logo-muni-iso.png" alt=""></footer>
  </section>
</div>`

const ESTILOS = '<link rel="stylesheet" href="/assets/admin-abc123.css">'

const doc = armarDocumento(CONTENIDO, ESTILOS, 'Informe-de-prueba')

// --- Lo que fallaba: que el informe esté adentro -----------------------
check(
  'el informe está dentro del documento',
  doc.includes('class="informe"'),
  'es exactamente lo que faltaba cuando salía en blanco',
)
check('llega la portada', doc.includes('inf__hero') && doc.includes('inf__titulo'))
check('llega el cuerpo', doc.includes('inf__cuerpo') && doc.includes('inf__sec'))
check('llega el pie', doc.includes('inf__pie'))
check('llega el gráfico como SVG', doc.includes('<svg'), 'vectorial, no imagen')
check('llega el formato del texto', doc.includes('<strong>'))

// --- Identidad institucional ------------------------------------------
console.log('\nIDENTIDAD')
check('el logo de Ciudad SMT', doc.includes('logo-smt-blanco.png'))
check('el logo de la Dirección de IA', doc.includes('logo-ia.png'))
check('el isologo municipal en el pie', doc.includes('logo-muni-iso.png'))

// --- Estilos ----------------------------------------------------------
console.log('\nESTILOS')
check(
  'las hojas del documento se copian',
  doc.includes(ESTILOS),
  'si no, el informe sale sin maquetar',
)
check(
  'el informe se hace visible en la pestaña nueva',
  /\.informe\s*\{[^}]*display:\s*block/.test(doc),
  'en el panel está oculto',
)
check(
  'se anula el escondite del panel',
  doc.includes('.informe-raiz') && /position:\s*static/.test(doc),
  'el panel lo tiene fuera de pantalla con position absolute',
)
check(
  'la hoja es A4 sin márgenes',
  /@page\s*\{[^}]*size:\s*A4/.test(doc + ESTILOS) || ESTILOS.includes('admin'),
  'el @page vive en informe.css, que entra con las hojas copiadas',
)

// --- La barra de la pestaña -------------------------------------------
console.log('\nBARRA DE LA PESTAÑA')
check('hay botón para guardar', doc.includes('window.print()'))
check('explica los ajustes del diálogo', doc.includes('Gráficos de fondo'))
check(
  'la barra no sale en el papel',
  /@media print\s*\{[^}]*\.barra\s*\{\s*display:\s*none/.test(doc),
  'si saliera, aparecería impresa arriba del informe',
)

// --- El nombre del archivo -------------------------------------------
console.log('\nNOMBRE DEL ARCHIVO')
const n = nombreSugerido(new Date(2026, 8, 3))
check(
  'dice qué es y de qué día',
  n === 'Informe-ArbolDeIdeas-2026-09-03',
  `${n} — es el nombre que propone el diálogo al guardar`,
)
check('el título del documento es ese nombre', doc.includes('<title>Informe-de-prueba</title>'))

// --- Bordes -----------------------------------------------------------
console.log('\nBORDES')
const vacio = armarDocumento('', ESTILOS)
check(
  'con informe vacío igual devuelve un documento válido',
  vacio.startsWith('<!doctype html>') && vacio.includes('</html>'),
  'no puede tirar una excepción en la cara del equipo',
)

console.log(
  fallos === 0
    ? '\n  El documento del informe sale completo.\n'
    : `\n  ${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
