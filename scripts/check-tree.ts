/**
 * Verificación numérica del árbol procedural.
 *
 * Corre sin navegador: comprueba que la geometría generada sea sana antes de
 * confiar en lo que se ve en pantalla. Detecta el tipo de fallo que en un LED
 * grande se nota tarde y mal: coordenadas NaN, hojas dentro del tronco,
 * ramas que se solapan o slots que no alcanzan para la meta de ideas.
 *
 *   npm run check:tree
 */
import { getTreeModel, getBranchFor, getLeafSlot, buildJourneyPath } from '../src/routes/screen/treeGeometry'
import { CATEGORIES } from '../src/lib/categories'
import type { CategorySlug } from '../src/lib/types'

const GOAL = 500
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'OK  ' : 'FALLA'
  if (!ok) failures++
  console.log(`  ${mark}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const model = getTreeModel()

console.log('\nESTRUCTURA')
check('tronco generado', model.trunk.getPoints(2).length === 3)
const mainRoots = model.roots.filter((r) => r.level === 1)
const subRoots = model.roots.filter((r) => r.level === 2)
/*
 * Rango, no número exacto.
 *
 * Antes exigía exactamente 11 principales, que es un parámetro de diseño y
 * no un invariante: al hacer las raíces más frondosas la verificación se
 * puso roja sin que nada estuviera mal. Lo que hay que proteger es que las
 * raíces existan, que no se disparen y que cada principal se ramifique —
 * si alguna vez quedan sin ramificar, extenderse sería sólo alargarse y se
 * pierde lo que la base cuenta.
 */
check(
  'raíces con ramificación',
  mainRoots.length >= 8 &&
    mainRoots.length <= 24 &&
    subRoots.length >= mainRoots.length * 2,
  `${mainRoots.length} principales + ${subRoots.length} secundarias`,
)
check('8 ramas, una por área', model.branches.length === CATEGORIES.length)
check('follaje de base presente', model.ambientSlots.length > 400, `${model.ambientSlots.length} slots`)

// --- Sin NaN en ninguna coordenada -----------------------------------
console.log('\nCOORDENADAS')
let nanCount = 0
const sampleCurve = (c: { getPointAt: (t: number) => { x: number; y: number; z: number } }) => {
  for (let i = 0; i <= 20; i++) {
    const p = c.getPointAt(i / 20)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) nanCount++
  }
}
sampleCurve(model.trunk)
model.roots.forEach((r) => sampleCurve(r.curve))
model.branches.forEach((b) => b.twigs.forEach((tw) => sampleCurve(tw.curve)))
check('sin coordenadas NaN/Infinity', nanCount === 0, `${nanCount} inválidas`)

// --- Raíces bajo tierra, copa arriba ---------------------------------
const rootTips = mainRoots.map((r) => r.curve.getPointAt(1).y)
check('las raíces descienden', Math.max(...rootTips) < 0, `y máx ${Math.max(...rootTips).toFixed(2)}`)

/*
 * El crecimiento encadena los tramos por uv.x: cada nivel tiene que
 * arrancar exactamente donde termina el anterior, o el frente daría un
 * salto y las raicillas aparecerían de golpe.
 *
 * Esto verificaba los dos números literales del reparto de cuando había
 * dos niveles (0.68 y 0.68). Con cuatro niveles esos números cambiaron y
 * la prueba se habría puesto roja sin que nada estuviera mal: estaba
 * comprobando el VALOR en vez del invariante. Ahora deriva el reparto del
 * propio modelo y comprueba lo que importa — que no queden huecos ni
 * solapamientos, que empiece en 0 y que termine en 1.
 */
const niveles = [...new Set(model.roots.map((r) => r.level))].sort((a, b) => a - b)
const tramos = niveles.map((n) => {
  const delNivel = model.roots.filter((r) => r.level === n)
  return {
    nivel: n,
    desde: Math.min(...delNivel.map((r) => r.uvStart)),
    hasta: Math.max(...delNivel.map((r) => r.uvEnd)),
    parejo: delNivel.every(
      (r) => r.uvStart === delNivel[0].uvStart && r.uvEnd === delNivel[0].uvEnd,
    ),
  }
})

const continuo =
  tramos.length > 1 &&
  tramos.every((t) => t.parejo && t.hasta > t.desde) &&
  tramos[0].desde === 0 &&
  tramos[tramos.length - 1].hasta === 1 &&
  tramos.every((t, i) => i === 0 || t.desde === tramos[i - 1].hasta)

check(
  'el recorrido de crecimiento es continuo entre tramos',
  continuo,
  tramos.map((t) => `n${t.nivel} ${t.desde}→${t.hasta}`).join(' · '),
)

// Ramificación de verdad: cada nivel tiene que tener más tramos que el
// anterior, o la "maraña" es un puñado de palos con puntas.
const porNivel = niveles.map((n) => model.roots.filter((r) => r.level === n).length)
check(
  'la maraña se abre en cada nivel',
  porNivel.every((c, i) => i === 0 || c > porNivel[i - 1]),
  porNivel.map((c, i) => `n${niveles[i]}: ${c}`).join(' · '),
)

const trunkTop = model.trunk.getPointAt(1).y
check('altura de tronco razonable', trunkTop > 2.5 && trunkTop < 4, `y ${trunkTop.toFixed(2)}`)

// --- Capacidad de hojas ----------------------------------------------
console.log('\nCAPACIDAD')
const perBranch = model.branches[0].leafSlots.length
const totalSlots = model.branches.reduce((n, b) => n + b.leafSlots.length, 0)
check(
  `slots suficientes para la meta de ${GOAL} ideas`,
  totalSlots >= GOAL,
  `${totalSlots} slots (${perBranch} por rama)`,
)

// --- Las hojas no caen dentro del tronco -----------------------------
console.log('\nUBICACIÓN DE HOJAS')
let insideTrunk = 0
let belowGround = 0
for (const branch of model.branches) {
  for (const slot of branch.leafSlots) {
    const radial = Math.hypot(slot.position.x, slot.position.z)
    if (radial < 0.2 && slot.position.y < trunkTop) insideTrunk++
    if (slot.position.y < 0) belowGround++
  }
}
check('ninguna hoja dentro del tronco', insideTrunk === 0, `${insideTrunk} hojas`)
check('ninguna hoja bajo tierra', belowGround === 0, `${belowGround} hojas`)

// --- Cada área ocupa su propio sector --------------------------------
console.log('\nSECTORES POR ÁREA')
const centroids = model.branches.map((b) => {
  const tip = b.twigs[0].curve.getPointAt(1)
  return { slug: b.slug, angle: (Math.atan2(tip.z, tip.x) * 180) / Math.PI }
})
let tooClose = 0
for (let i = 0; i < centroids.length; i++) {
  for (let j = i + 1; j < centroids.length; j++) {
    let d = Math.abs(centroids[i].angle - centroids[j].angle)
    if (d > 180) d = 360 - d
    if (d < 20) tooClose++
  }
}
check('las 8 ramas están separadas entre sí', tooClose === 0, `${tooClose} pares a <20°`)

/*
 * El reparto del follaje alrededor del tronco.
 *
 * Es el hueco de la copa, medido. Las ocho ramas dejan boquetes de hasta 68°
 * entre sus puntas, y desde el pasillo de la feria eso se lee como un árbol
 * desbalanceado. Lo que lo cierra es el estiramiento tangencial de los
 * racimos (ESTIRE_TANGENCIAL en treeGeometry).
 *
 * Se mide como razón entre el sector más poblado y el más vacío. Sin estirar
 * daba 2.19; con el estiramiento actual, 1.80. El tope de 2.0 deja margen
 * para retoques y se pone rojo si alguien anula el estiramiento sin saber
 * qué estaba resolviendo.
 *
 * No se pide reparto perfecto: un árbol con las ocho zonas exactamente
 * iguales se vería como un gráfico de torta.
 */
{
  const sectores = new Array(12).fill(0)
  for (const s of model.ambientSlots) {
    const a = (Math.atan2(s.position.z, s.position.x) + Math.PI * 2) % (Math.PI * 2)
    sectores[Math.floor((a / (Math.PI * 2)) * 12)]++
  }
  const total = sectores.reduce((x, y) => x + y, 0)
  const pct = sectores.map((v) => (v / total) * 100)
  const razon = Math.max(...pct) / Math.min(...pct)

  check(
    'el follaje se reparte sin huecos alrededor del tronco',
    razon <= 2.0,
    `razón ${razon.toFixed(2)} entre el sector más poblado y el más vacío ` +
      `(sin estirar los racimos era 2.19)`,
  )
}

// --- Determinismo: misma idea, misma hoja ----------------------------
console.log('\nDETERMINISMO')
const branchA = getBranchFor(model, 'movilidad')
const first = getLeafSlot(branchA, 12)
const second = getLeafSlot(getBranchFor(getTreeModel(), 'movilidad'), 12)
check(
  'la hoja 12 de movilidad cae siempre en el mismo punto',
  first.position.distanceTo(second.position) === 0,
)

// --- El recorrido de la partícula termina en la hoja -----------------
console.log('\nRECORRIDO DE LA PARTÍCULA')
let badPaths = 0
let startsAtRoot = 0
for (const cat of CATEGORIES) {
  const branch = getBranchFor(model, cat.slug as CategorySlug)
  const slot = getLeafSlot(branch, 5)
  const path = buildJourneyPath(model, branch, slot, `test-${cat.slug}`)
  const end = path.getPointAt(1)
  const start = path.getPointAt(0)
  if (end.distanceTo(slot.position) > 0.001) badPaths++
  if (start.y < 0) startsAtRoot++
}
check('el viaje termina exactamente en la hoja', badPaths === 0, `${badPaths} desviados`)
check('el viaje nace en una raíz', startsAtRoot === CATEGORIES.length, `${startsAtRoot}/8`)

console.log(
  failures === 0
    ? '\nTodo en orden: la geometría del árbol es sana.\n'
    : `\n${failures} verificación(es) fallaron.\n`,
)

process.exit(failures === 0 ? 0 : 1)
