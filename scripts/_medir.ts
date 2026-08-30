import * as THREE from 'three'
import { getTreeModel } from '../src/routes/screen/treeGeometry'
import { getGrowthProfile } from '../src/lib/growth'

const m = getTreeModel()

// --- bbox de la copa (twigs) y del arbol entero
const box = new THREE.Box3()
const canopy = new THREE.Box3()
const sample = (c: THREE.Curve<THREE.Vector3>, target: THREE.Box3[]) => {
  for (let i = 0; i <= 24; i++) {
    const p = c.getPointAt(i / 24)
    target.forEach((t) => t.expandByPoint(p))
  }
}
sample(m.trunk, [box])
m.roots.forEach((r) => sample(r.curve, [box]))
m.branches.forEach((b) => b.twigs.forEach((t) => sample(t.curve, [box, canopy])))
// hojas
const leafBox = new THREE.Box3()
m.branches.forEach((b) => b.leafSlots.forEach((s) => { leafBox.expandByPoint(s.position); box.expandByPoint(s.position) }))
const ambBox = new THREE.Box3()
m.ambientSlots.forEach((s) => { ambBox.expandByPoint(s.position); box.expandByPoint(s.position) })

const f = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`
console.log('BBOX total   min', f(box.min), 'max', f(box.max))
console.log('BBOX copa    min', f(canopy.min), 'max', f(canopy.max))
console.log('BBOX hojas   min', f(leafBox.min), 'max', f(leafBox.max))
console.log('BBOX ambient min', f(ambBox.min), 'max', f(ambBox.max))
console.log('tronco top y', m.trunk.getPointAt(1).y.toFixed(3))

// radio horizontal maximo de la copa
let maxR = 0, maxRy = 0
m.branches.forEach((b) => b.twigs.forEach((t) => {
  for (let i = 0; i <= 12; i++) {
    const p = t.curve.getPointAt(i / 12)
    const r = Math.hypot(p.x, p.z)
    if (r > maxR) { maxR = r; maxRy = p.y }
  }
}))
console.log('radio horiz max copa', maxR.toFixed(2), 'a y', maxRy.toFixed(2))

// origen de cada rama madre
console.log('\nRAMAS MADRE')
m.branches.forEach((b) => {
  const o = m.trunk.getPointAt(b.originT)
  const mother = b.twigs[0]
  const tip = mother.curve.getPointAt(1)
  const ang = (Math.atan2(o.z ? 0 : 0, 1))
  const dir = new THREE.Vector3().subVectors(tip, o)
  console.log(
    `${b.slug.padEnd(11)} originT ${b.originT.toFixed(2)} y=${o.y.toFixed(2)}`,
    `len=${dir.length().toFixed(2)} r0=${mother.radius.toFixed(4)}`,
    `tip=${f(tip)} angXZ=${(Math.atan2(tip.z, tip.x) * 180 / Math.PI).toFixed(0)}deg`,
    `twigs=${b.twigs.length} slots=${b.leafSlots.length}`,
  )
})

// niveles
const lv: Record<number, number> = {}
m.branches.forEach((b) => b.twigs.forEach((t) => { lv[t.level] = (lv[t.level] ?? 0) + 1 }))
console.log('\ntwigs por nivel', lv, 'total', Object.values(lv).reduce((a, b) => a + b, 0))

// distribucion vertical de las hojas (histograma)
console.log('\nHISTOGRAMA hojas ciudadanas (slots) por altura')
const bins = new Array(14).fill(0)
let all = 0
m.branches.forEach((b) => b.leafSlots.forEach((s) => { const i = Math.min(13, Math.max(0, Math.floor(s.position.y / 0.5))); bins[i]++; all++ }))
bins.forEach((n, i) => { if (n) console.log(`y ${(i*0.5).toFixed(1)}-${(i*0.5+0.5).toFixed(1)}`.padEnd(12), '#'.repeat(Math.round(n / all * 200)), (n/all*100).toFixed(1)+'%') })

console.log('\nHISTOGRAMA follaje ambiente por altura')
const b2 = new Array(14).fill(0); let all2 = 0
m.ambientSlots.forEach((s) => { const i = Math.min(13, Math.max(0, Math.floor(s.position.y / 0.5))); b2[i]++; all2++ })
b2.forEach((n, i) => { if (n) console.log(`y ${(i*0.5).toFixed(1)}-${(i*0.5+0.5).toFixed(1)}`.padEnd(12), '#'.repeat(Math.round(n / all2 * 200)), (n/all2*100).toFixed(1)+'%') })

// radio del follaje por altura (silueta)
console.log('\nSILUETA: radio horiz maximo del follaje ambiente por franja de 0.4')
const rad = new Array(16).fill(0)
m.ambientSlots.forEach((s) => { const i = Math.min(15, Math.max(0, Math.floor(s.position.y / 0.4))); rad[i] = Math.max(rad[i], Math.hypot(s.position.x, s.position.z)) })
rad.forEach((r, i) => { if (r) console.log(`y ${(i*0.4).toFixed(1)}`.padEnd(8), '='.repeat(Math.round(r * 12)), r.toFixed(2)) })

// encuadre de camara
console.log('\nENCUADRE')
const fov = 42, aspect = 16 / 9
for (const [label, n] of [['apertura (0 ideas)', 0], ['joven (150)', 150], ['frondoso (350)', 350], ['pleno (600)', 600]] as [string, number][]) {
  const g = getGrowthProfile(n, 500)
  const s = g.canopyScale
  const top = box.max.y * s, bottom = box.min.y * s
  const halfW = Math.max(Math.abs(box.max.x), Math.abs(box.min.x), Math.abs(box.max.z), Math.abs(box.min.z)) * s
  // camara media: radius 7.0, height 2.5, target y 2.05
  const R = 7.0, H = 2.5, TY = 2.05
  const dist = Math.hypot(R, H - TY)
  const halfV = dist * Math.tan((fov / 2) * Math.PI / 180)
  const halfH = halfV * aspect
  console.log(
    `${label.padEnd(20)} escala ${s.toFixed(2)} | arbol y ${bottom.toFixed(2)}..${top.toFixed(2)} (alto ${(top-bottom).toFixed(2)}, ancho ${(halfW*2).toFixed(2)})`,
    `| cuadro y ${(TY-halfV).toFixed(2)}..${(TY+halfV).toFixed(2)} (alto ${(halfV*2).toFixed(2)}, ancho ${(halfH*2).toFixed(2)})`,
    `| ocupa ${((top-bottom)/(halfV*2)*100).toFixed(0)}% alto, ${(halfW*2/(halfH*2)*100).toFixed(0)}% ancho`,
    top > TY + halfV ? '  << COPA CORTADA' : '',
    bottom < TY - halfV ? '  << RAICES CORTADAS' : '',
  )
}
