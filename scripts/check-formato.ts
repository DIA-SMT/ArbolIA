import { analizarMarkdown, analizarLinea } from '../src/lib/formatoMigue'
let fallos = 0
const check = (l: string, ok: boolean, d = '') => { if (!ok) fallos++; console.log(`  ${ok?'OK  ':'FALLA'}  ${l}${d?` — ${d}`:''}`) }

console.log('\nFORMATO DE MIGUE')

// El caso que se veía mal en la captura del panel.
const real = `Che, mirando las 17 propuestas, te diría que hay dos tipos de mensajes mezclados: **reclamos/quejas genéricas** (sin pedido concreto) y **propuestas puntuales**.

**Reclamos/quejas puros** (5 de 17, ~30%):
- "La recolección de residuos no pasa desde hace semanas" (Ambiente)
- "No renuevan las calles hace meses" (Comunidad)`

const b = analizarMarkdown(real)
check('separa los bloques', b.length === 3, `${b.length} bloques`)
check('el primero es párrafo', b[0].tipo === 'parrafo')
check('el último es lista', b[2].tipo === 'lista', b[2].tipo)
check('la lista tiene sus dos items', b[2].tipo === 'lista' && b[2].items.length === 2)

const trozos = b[0].tipo === 'parrafo' ? b[0].trozos : []
check('reconoce la negrita', trozos.some(t => t.tipo === 'fuerte' && t.texto.includes('reclamos')))
check('no deja asteriscos sueltos',
  !trozos.some(t => t.tipo === 'texto' && t.texto.includes('**')),
  'era exactamente lo que se veía en pantalla')

console.log('\nCASOS SUELTOS')
check('negrita simple', analizarLinea('hola **mundo**').some(t => t.tipo==='fuerte' && t.texto==='mundo'))
check('itálica', analizarLinea('hola *mundo*').some(t => t.tipo==='enfasis'))
check('código', analizarLinea('usá `npm run check`').some(t => t.tipo==='codigo'))
check('guión bajo doble también es negrita', analizarLinea('__fuerte__').some(t => t.tipo==='fuerte'))
check('texto sin marcas queda entero',
  analizarLinea('sin nada').every(t => t.tipo === 'texto'))
check('un asterisco suelto no rompe',
  analizarLinea('2 * 3 = 6').map(t=>t.texto).join('') === '2 * 3 = 6')

console.log('\nTÍTULOS Y GRÁFICOS')
const t2 = analizarMarkdown('# Resumen\n\ntexto\n\n[grafico:areas]\n\nmás texto')
check('reconoce el título', t2[0].tipo === 'titulo')
check('reconoce el marcador de gráfico',
  t2.some(x => x.tipo === 'grafico' && x.cual === 'areas'))
check('el gráfico no se mezcla con el párrafo', t2.filter(x=>x.tipo==='parrafo').length === 2)

console.log('\nBORDES')
check('texto vacío no rompe', analizarMarkdown('').length === 0)
check('sólo espacios no rompe', analizarMarkdown('   \n\n  ').length === 0)
check('lista numerada', analizarMarkdown('1. uno\n2. dos')[0].tipo === 'lista')
const mezcla = analizarMarkdown('- viñeta\n1. numerada')
check('no mezcla viñetas con numeradas', mezcla.length === 2, `${mezcla.length} listas`)

console.log(fallos === 0 ? '\n  El formato de Migue se interpreta bien.\n' : `\n  ${fallos} fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)
