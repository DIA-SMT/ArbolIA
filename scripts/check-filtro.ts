/**
 * Verificación del filtro de contenido.
 *
 * Dos errores opuestos, los dos caros:
 *
 *   · Dejar pasar un insulto → queda proyectado en un LED municipal.
 *   · Rechazar una idea legítima → el municipio le dice a un vecino que
 *     escribió una grosería por proponer computadoras para una escuela.
 *
 * El segundo es el que efectivamente estaba pasando: seis de cada nueve
 * ideas normales caían porque el filtro comparaba subcadenas.
 *
 *   npm run check:filtro
 */
import { checkIdeaText } from '../src/lib/moderation'

let fallos = 0

function debePasar(texto: string) {
  const r = checkIdeaText(texto)
  if (!r.ok) {
    fallos++
    console.log(`  FALLA  rechaza una idea legítima: "${texto}"`)
  }
}

function debeFrenar(texto: string) {
  const r = checkIdeaText(texto)
  if (r.ok) {
    fallos++
    console.log(`  FALLA  deja pasar: "${texto}"`)
  }
}

// ---------------------------------------------------------------------

console.log('\nIDEAS LEGÍTIMAS (no deben rechazarse)')

const LEGITIMAS = [
  // Las que rompía la versión de subcadenas.
  'Más computadoras en las escuelas municipales',
  'Talleres de computación para adultos mayores',
  'Que se pueda controlar el estado de los trámites online',
  'Un sistema para controlar la velocidad en las avenidas',
  'Que el municipio controle las obras en construcción',
  'Una diputada propuso algo parecido el año pasado',
  'Resolver la disputa por el uso de la plaza',
  // Vocabulario normal de propuestas ciudadanas.
  'Más espacios verdes en cada barrio',
  'Ciclovías seguras que conecten el centro con Yerba Buena',
  'Recuperar la Plaza Independencia para eventos de noche',
  'Contenedores de basura en cada esquina',
  'Mejorar la frecuencia de los colectivos',
  'Iluminación LED en los pasajes oscuros',
  'Un semáforo en la esquina de casa, se cruza muy mal',
  'Arreglar el bache de la calle Muñecas',
  'Wifi libre en las plazas del centro',
  'Que los trámites se puedan hacer sin ir a la municipalidad',
  // Con números: la reversión de leet no puede deformar estas.
  'Plantar 100 árboles nativos en la avenida',
  'Mejorar la parada del 118 en la terminal',
  'Un carril exclusivo en la ruta 9',
  'Que la línea 4 pase cada 10 minutos',
]

LEGITIMAS.forEach(debePasar)
if (fallos === 0) console.log(`  OK     las ${LEGITIMAS.length} pasan`)

// ---------------------------------------------------------------------

const antes = fallos
console.log('\nINSULTOS (deben frenarse)')

const OFENSIVAS = [
  'esta ciudad es una mierda',
  'sos un pelotudo',
  'la municipalidad no hace un carajo',
  'andate a la mierda con tus obras',
  'todos ladrones',
  'son todos unos chorros',
  // Evasiones por separadores.
  'sos un p-e-l-o-t-u-d-o',
  'esto es una m i e r d a',
  'que p.u.t.o el intendente',
  // Evasiones "leet". El primero es el caso real que se coló en el stand.
  'Estoy harto de esta gestion de m1erd4, no hace nada',
  'que pel0tud0 el intendente',
  'son unos l4dr0nes',
  'todo m13rd4',
  'sos un 1d10t4',
]

OFENSIVAS.forEach(debeFrenar)
if (fallos === antes) console.log(`  OK     las ${OFENSIVAS.length} se frenan`)

// ---------------------------------------------------------------------

const antes2 = fallos
console.log('\nCASOS LÍMITE')

const cortos = checkIdeaText('ok')
if (cortos.ok) {
  fallos++
  console.log('  FALLA  acepta un texto demasiado corto')
}

const simbolos = checkIdeaText('!!!! ???? 1234')
if (simbolos.ok) {
  fallos++
  console.log('  FALLA  acepta texto sin ninguna letra')
}

const acentos = checkIdeaText('Más árboles nativos en avenidas')
if (!acentos.ok) {
  fallos++
  console.log('  FALLA  rechaza texto con tildes')
}

if (fallos === antes2) console.log('  OK     texto corto, sin letras y con tildes')

console.log(
  fallos === 0
    ? '\nEl filtro separa insultos de ideas legítimas.\n'
    : `\n${fallos} caso(s) mal clasificados.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
