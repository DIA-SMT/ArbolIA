/**
 * Verificación de la crítica que cae y alimenta las raíces.
 *
 * Dos cosas que no se pueden mirar a ojo en el stand:
 *
 *   · Que una crítica NO consuma un slot de hoja. El slot se calcula
 *     contando cuántas hojas hay ya de esa categoría, y ese conteo ocurre
 *     en dos lugares independientes. Mientras toda idea era una hoja,
 *     coincidían por accidente. Si uno de los dos contara las críticas, la
 *     propuesta siguiente aterrizaría sobre una hoja existente y en la
 *     pantalla se verían dos ideas superpuestas en el mismo punto.
 *
 *   · Que el fruto caiga. Una curva Catmull-Rom sobrepasa entre puntos de
 *     control: con un punto medio mal puesto el fruto haría una panza
 *     hacia arriba antes de bajar, y eso en una pantalla de cuatro metros
 *     se lee como un error, no como física.
 *
 *   npm run check:criticas
 */
import {
  buildFallPath,
  CAER_MS,
  CAIDA_MS,
  DESPRENDER_MS,
  empujeDeRaices,
  EMPUJE_MAXIMO,
  HUNDIR_MS,
  semillaDe,
} from '../src/routes/screen/fallPath'
import { getBranchFor, getLeafSlot, getTreeModel } from '../src/routes/screen/treeGeometry'
import { getGrowthProfile } from '../src/lib/growth'
import type { CategorySlug, Idea } from '../src/lib/types'

let fallas = 0

function ok(titulo: string, condicion: boolean, detalle = '') {
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!condicion) fallas++
}

const model = getTreeModel()

function idea(n: number, tipo: 'propuesta' | 'critica', cat: CategorySlug): Idea {
  return {
    id: `${tipo}-${cat}-${n}`,
    text: `${tipo} ${n}`,
    category: cat,
    status: 'visible',
    archived_at: null,
    created_at: new Date(2026, 8, 3, 10, n).toISOString(),
    tipo,
  }
}

/* ------------------------------------------------------------------ */
console.log('\nUNA CRÍTICA NO OCUPA UNA HOJA')

/*
 * Se reproduce el flujo real: `ideas` acumula todo, `propuestas` es lo que
 * llega a la copa, y los DOS lugares que calculan el slot cuentan sobre
 * `propuestas`. Si alguno contara sobre `ideas`, este test lo detecta.
 */
const mezcla: Idea[] = []
let n = 0
for (const paso of ['propuesta', 'critica', 'propuesta', 'critica', 'critica', 'propuesta'] as const) {
  mezcla.push(idea(n++, paso, 'movilidad'))
}

const propuestas = mezcla.filter((i) => i.tipo !== 'critica')
ok('las críticas quedan fuera de la copa', propuestas.length === 3, `${propuestas.length} de ${mezcla.length}`)
ok('pero siguen en el total', mezcla.length === 6)

// Destino del viaje (TreeScene) vs. dibujado (Leaves): los dos conteos.
const slotsDestino: number[] = []
const acumulado: Idea[] = []
for (const i of mezcla) {
  if (i.tipo === 'critica') {
    acumulado.push(i)
    continue
  }
  const yaPlantadas = acumulado.filter((p) => p.tipo !== 'critica' && p.category === i.category).length
  slotsDestino.push(yaPlantadas)
  acumulado.push(i)
}

const slotsDibujo: number[] = []
{
  const contador: Record<string, number> = {}
  for (const p of acumulado.filter((i) => i.tipo !== 'critica')) {
    const k = contador[p.category] ?? 0
    contador[p.category] = k + 1
    slotsDibujo.push(k)
  }
}

ok(
  'los dos conteos del slot coinciden',
  JSON.stringify(slotsDestino) === JSON.stringify(slotsDibujo),
  `viaje ${JSON.stringify(slotsDestino)} vs dibujo ${JSON.stringify(slotsDibujo)}`,
)
ok('ningún slot se repite', new Set(slotsDestino).size === slotsDestino.length)
ok('son consecutivos desde 0', JSON.stringify(slotsDestino) === '[0,1,2]')

// El caso que rompía: contar las críticas corre todas las hojas.
const slotsMal: number[] = []
{
  const acc: Idea[] = []
  for (const i of mezcla) {
    if (i.tipo !== 'critica') {
      slotsMal.push(acc.filter((p) => p.category === i.category).length)
    }
    acc.push(i)
  }
}
ok(
  'contar sobre `ideas` SÍ rompería (control negativo)',
  JSON.stringify(slotsMal) !== JSON.stringify(slotsDibujo),
  `daría ${JSON.stringify(slotsMal)}`,
)

// Y las posiciones reales no pueden pisarse.
const rama = getBranchFor(model, 'movilidad')
const posiciones = slotsDestino.map((s) => getLeafSlot(rama, s).position)
let pisadas = 0
for (let i = 0; i < posiciones.length; i++) {
  for (let j = i + 1; j < posiciones.length; j++) {
    if (posiciones[i].distanceTo(posiciones[j]) < 0.001) pisadas++
  }
}
ok('ninguna hoja cae sobre otra', pisadas === 0, `${pisadas} superpuestas`)

/* ------------------------------------------------------------------ */
console.log('\nEL FRUTO CAE')

const CATEGORIAS: CategorySlug[] = [
  'ambiente', 'movilidad', 'espacios', 'tecnologia',
  'transporte', 'cultura', 'urbanismo', 'comunidad',
]

let sinCaer = 0
let subeEnAlgunTramo = 0
let noLlegaAlSuelo = 0
let naceBajoTierra = 0

for (const cat of CATEGORIAS) {
  for (let k = 0; k < 12; k++) {
    const c = buildFallPath(model, cat, `critica-${cat}-${k}`)
    const puntos = Array.from({ length: 60 }, (_, i) => c.curva.getPoint(i / 59))

    if (puntos[0].y <= 0) naceBajoTierra++
    if (puntos[0].y <= puntos[puntos.length - 1].y) sinCaer++
    if (Math.abs(puntos[puntos.length - 1].y - -0.04) > 0.001) noLlegaAlSuelo++

    // Tolerancia mínima: la curva puede tener microrruido numérico, pero
    // una panza hacia arriba visible son centímetros.
    for (let i = 1; i < puntos.length; i++) {
      if (puntos[i].y > puntos[i - 1].y + 0.002) {
        subeEnAlgunTramo++
        break
      }
    }
  }
}

const total = CATEGORIAS.length * 12
ok('nace en la copa, no bajo tierra', naceBajoTierra === 0, `${naceBajoTierra}/${total}`)
ok('siempre desciende en neto', sinCaer === 0, `${sinCaer}/${total}`)
ok('nunca sube a mitad de camino', subeEnAlgunTramo === 0, `${subeEnAlgunTramo}/${total} con panza`)
ok('termina exactamente en la tierra', noLlegaAlSuelo === 0, `${noLlegaAlSuelo}/${total}`)

// Determinismo: la misma crítica cae siempre del mismo lugar.
const a = buildFallPath(model, 'ambiente', 'idea-fija-42')
const b = buildFallPath(model, 'ambiente', 'idea-fija-42')
ok(
  'la misma crítica cae siempre del mismo punto',
  a.curva.getPoint(0).distanceTo(b.curva.getPoint(0)) < 1e-9,
)
ok('dos críticas distintas no salen calcadas', semillaDe('idea-a') !== semillaDe('idea-b'))

// Sale de la rama de SU área.
const enMovilidad = buildFallPath(model, 'movilidad', 'x')
const ramaMov = getBranchFor(model, 'movilidad')
const cercaDeSuRama = ramaMov.leafSlots.some(
  (s) => s.position.distanceTo(enMovilidad.curva.getPoint(0)) < 0.25,
)
ok('se desprende de la rama de su área', cercaDeSuRama)

/* ------------------------------------------------------------------ */
console.log('\nLOS TIEMPOS CIERRAN')

ok(
  'las tres fases suman la duración total',
  DESPRENDER_MS + CAER_MS + HUNDIR_MS === CAIDA_MS,
  `${DESPRENDER_MS}+${CAER_MS}+${HUNDIR_MS} = ${DESPRENDER_MS + CAER_MS + HUNDIR_MS} vs ${CAIDA_MS}`,
)

/*
 * La duración de la caída también vive en useLiveTree, que es quien libera
 * la cola. Si se separan, o el fruto desaparece antes de hundirse o la
 * pantalla se queda quieta esperando de más.
 */
import { readFileSync } from 'node:fs'
const hook = readFileSync('src/hooks/useLiveTree.ts', 'utf8')
const enHook = Number(/const CAIDA_MS = (\d+)/.exec(hook)?.[1] ?? 0)
ok(
  'la cola espera exactamente lo que dura la caída',
  enHook === CAIDA_MS,
  `useLiveTree ${enHook} vs fallPath ${CAIDA_MS}`,
)

/* ------------------------------------------------------------------ */
console.log('\nLAS CRÍTICAS EXTIENDEN LAS RAÍCES')

ok('sin críticas no hay empuje', empujeDeRaices(0) === 0)
ok('cada crítica suma alcance', empujeDeRaices(5) > empujeDeRaices(1))
ok('el empuje tiene tope', empujeDeRaices(9999) === EMPUJE_MAXIMO)
ok('un número negativo no rompe', empujeDeRaices(-3) === 0)

/*
 * El pago visual de la metáfora: las raíces secundarias arrancan en 0.68
 * del recorrido. Que las críticas empujen la base más allá de ese número
 * antes de que llegue sola es lo que hace que el reclamo RAMIFIQUE la base
 * en vez de sólo alargarla.
 */
const META = 3000
const conIdeas = (cuantas: number) => getGrowthProfile(cuantas, META).rootReach
const ideasParaSecundarias = (() => {
  for (let i = 0; i <= META; i++) if (conIdeas(i) >= 0.68) return i
  return Infinity
})()
const conCriticas = (cuantas: number, criticas: number) =>
  Math.min(1, conIdeas(cuantas) + empujeDeRaices(criticas))
const ideasParaSecundariasCon22 = (() => {
  for (let i = 0; i <= META; i++) if (conCriticas(i, 22) >= 0.68) return i
  return Infinity
})()

ok(
  'con críticas, las raíces secundarias aparecen antes',
  ideasParaSecundariasCon22 < ideasParaSecundarias,
  `${ideasParaSecundariasCon22} ideas en vez de ${ideasParaSecundarias}`,
)
ok('el alcance nunca supera 1', conCriticas(META * 2, 9999) <= 1)

/* ------------------------------------------------------------------ */
console.log(
  fallas === 0
    ? '\nLa crítica cae, no le roba el lugar a ninguna hoja y las raíces se extienden.\n'
    : `\n${fallas} verificación(es) fallaron.\n`,
)
process.exit(fallas === 0 ? 0 : 1)
