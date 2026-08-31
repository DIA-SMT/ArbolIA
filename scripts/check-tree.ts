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

// El crecimiento encadena los tramos por uv.x: la secundaria tiene que
// arrancar exactamente donde termina su madre, o el frente daría un salto.
const uvGap = model.roots.some(
  (r) => (r.level === 1 && r.uvEnd !== 0.68) || (r.level === 2 && r.uvStart !== 0.68),
)
check('el recorrido de crecimiento es continuo entre tramos', !uvGap)

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
