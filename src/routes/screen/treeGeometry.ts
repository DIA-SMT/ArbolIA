import * as THREE from 'three'
import { CATEGORIES } from '../../lib/categories'
import { randomRange, seededRandom } from '../../lib/rng'
import type { CategorySlug } from '../../lib/types'

/**
 * Generación procedural del árbol.
 *
 * Todo sale de semillas fijas, así que la forma es idéntica en cada carga.
 * Lo único que cambia en vivo es qué posiciones de hoja están ocupadas.
 *
 * Dos decisiones definen que esto se lea como un árbol y no como un gráfico:
 *
 *  - Las ramas madre se reparten por ÁNGULO ÁUREO (137.5°), no en octavos
 *    exactos. Es la filotaxis que usan las plantas de verdad: queda pareja
 *    pero nunca simétrica. Ocho ramas cada 45° se leen como diagrama radial.
 *
 *  - Cada rama se bifurca de forma recursiva en cuatro niveles, con ángulos
 *    y longitudes variables. La silueta de un árbol es fractal; un tronco
 *    con ocho palos derechos no lo es.
 */

/** Filotaxis: el ángulo que usan las plantas para repartir sus brotes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const TRUNK_HEIGHT = 3.15
const MAX_LEVEL = 4

/**
 * Tramo del recorrido que ocupa cada nivel de rama, encadenado.
 *
 * La copa se despliega igual que las raíces: el shader recorta lo que
 * todavía no creció. Con estos cortes, una copa al 46 % tiene sólo las
 * ramas madre; al 79 % ya llegó al tercer nivel; al 100 % está entera.
 * Así el árbol no sólo se agranda: se ramifica.
 */
const LEVEL_UV = [0, 0.4, 0.64, 0.83, 1]

export interface Twig {
  curve: THREE.CatmullRomCurve3
  level: number
  radius: number
  /** Tramo de uv.x que ocupa: define cuándo aparece al crecer. */
  uvStart: number
  uvEnd: number
  /**
   * Tramo de voladizo que ocupa: define cuánto se dobla con el viento.
   *
   * Va aparte de uvStart/uvEnd porque las dos coordenadas quieren cosas
   * distintas. El crecimiento necesita que todas las ramas de un mismo
   * nivel aparezcan juntas, así que uv.x está cuantizado por nivel. El
   * viento necesita lo contrario: que una hija arranque exactamente en el
   * valor que tiene su madre en la axila donde nace, que está a mitad de
   * camino. Un solo número no puede cumplir las dos.
   */
  spanStart: number
  spanEnd: number
  /** Índice del twig padre dentro de la misma rama; -1 si nace del tronco. */
  parent: number
  /** Punto de la curva del padre donde nace. */
  parentT: number
  segments: number
}

export interface LeafSlot {
  position: THREE.Vector3
  normal: THREE.Vector3
  scale: number
  /** Índice del twig del que cuelga. */
  twig: number
  t: number
  /** Flexión de la ramita justo acá: la hoja usa el mismo número. */
  flex: number
}

export interface RootCurve {
  curve: THREE.CatmullRomCurve3
  /** 1 = raíz principal, 2 = secundaria. */
  level: number
  /** Tramo de uv.x que ocupa: define cuándo aparece al crecer. */
  uvStart: number
  uvEnd: number
}

export interface AmbientSlot {
  position: THREE.Vector3
  normal: THREE.Vector3
  scale: number
  /** Índice de la rama madre: define con qué color de área se tiñe. */
  branch: number
  /** 0 = borde exterior del racimo, 1 = centro. Modula el sombreado. */
  depth: number
  /** Flexión de la ramita que sostiene el racimo. */
  flex: number
}

export interface BranchGeometry {
  slug: CategorySlug
  color: string
  slot: number
  twigs: Twig[]
  /** Punto del tronco (0..1) donde nace la rama madre. */
  originT: number
  leafSlots: LeafSlot[]
}

export interface TreeModel {
  trunk: THREE.CatmullRomCurve3
  roots: RootCurve[]
  branches: BranchGeometry[]
  ambientSlots: AmbientSlot[]
  height: number
}

const UP = new THREE.Vector3(0, 1, 0)

// ---------------------------------------------------------------------
// Tronco
// ---------------------------------------------------------------------

/**
 * El tronco no sube derecho: se inclina, corrige y vuelve. Esa doble
 * curvatura asimétrica es la diferencia entre madera y caño.
 */
function buildTrunk(): THREE.CatmullRomCurve3 {
  const rng = seededRandom('arbolia-trunk-v2')
  const points: THREE.Vector3[] = []
  const segments = 9
  const lean = randomRange(rng, 0.1, 0.16)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const y = t * TRUNK_HEIGHT

    // Curva en S: se va para un lado abajo y corrige arriba.
    const sway = Math.sin(t * Math.PI * 1.45) * 0.19 - t * lean
    const drift = Math.cos(t * Math.PI * 0.9 + 1.2) * 0.1 * t
    const noise = randomRange(rng, -0.022, 0.022)

    points.push(new THREE.Vector3(sway + noise, y, drift + noise * 0.7))
  }

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

/**
 * Raíces: descienden y se abren. Representan a la comunidad.
 *
 * Cada raíz principal se bifurca en dos o tres secundarias más finas.
 * Importa porque las raíces crecen con la participación: si fueran once
 * palos rectos, extenderse sería sólo alargarse. Con ramificación, cuanto
 * más participa la gente más se ramifica la base — que es exactamente lo
 * que la instalación quiere decir.
 *
 * El `depth` de cada tramo indica su nivel, y el orden importa: las
 * secundarias se generan después para que su uv.x arranque donde termina
 * la madre y el crecimiento se lea continuo.
 */
function buildRoots(): RootCurve[] {
  const rng = seededRandom('arbolia-roots-v3')
  const count = 16
  const roots: RootCurve[] = []

  for (let i = 0; i < count; i++) {
    // También por ángulo áureo: raíces sin patrón de estrella.
    const angle = i * GOLDEN_ANGLE + randomRange(rng, -0.12, 0.12)
    const reach = randomRange(rng, 1.15, 2.5)
    const depth = randomRange(rng, 0.42, 1.05)

    const tipAngle = angle + randomRange(rng, -0.3, 0.3)
    const tip = new THREE.Vector3(
      Math.cos(tipAngle) * reach,
      -depth,
      Math.sin(tipAngle) * reach,
    )

    const main = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 0.3, 0),
        new THREE.Vector3(
          Math.cos(angle) * reach * 0.2,
          randomRange(rng, -0.02, 0.06),
          Math.sin(angle) * reach * 0.2,
        ),
        new THREE.Vector3(
          Math.cos(angle) * reach * 0.58,
          -depth * 0.5,
          Math.sin(angle) * reach * 0.58,
        ),
        tip,
      ],
      false,
      'catmullrom',
      0.5,
    )

    roots.push({ curve: main, level: 1, uvStart: 0, uvEnd: 0.68 })

    // Secundarias: nacen en el tramo final y siguen abriéndose.
    const childCount = rng() > 0.4 ? 4 : 3
    for (let c = 0; c < childCount; c++) {
      const at = 0.55 + (c / childCount) * 0.35
      const base = main.getPointAt(Math.min(0.95, at))
      const spread = randomRange(rng, 0.45, 1.05)
      const childAngle = tipAngle + (c - (childCount - 1) / 2) * spread

      const childReach = reach * randomRange(rng, 0.34, 0.58)
      const childDepth = randomRange(rng, 0.15, 0.42)

      roots.push({
        curve: new THREE.CatmullRomCurve3(
          [
            base.clone(),
            base
              .clone()
              .add(
                new THREE.Vector3(
                  Math.cos(childAngle) * childReach * 0.5,
                  -childDepth * 0.55,
                  Math.sin(childAngle) * childReach * 0.5,
                ),
              ),
            base
              .clone()
              .add(
                new THREE.Vector3(
                  Math.cos(childAngle + randomRange(rng, -0.25, 0.25)) * childReach,
                  -childDepth,
                  Math.sin(childAngle + randomRange(rng, -0.25, 0.25)) * childReach,
                ),
              ),
          ],
          false,
          'catmullrom',
          0.5,
        ),
        level: 2,
        // Arrancan donde termina la madre: el avance se ve continuo.
        uvStart: 0.68,
        uvEnd: 1,
      })
    }
  }

  return roots
}

// ---------------------------------------------------------------------
// Ramificación recursiva
// ---------------------------------------------------------------------

interface GrowInput {
  rng: () => number
  origin: THREE.Vector3
  direction: THREE.Vector3
  length: number
  radius: number
  level: number
  parent: number
  parentT: number
  /** Voladizo heredado: lo que vale la madre justo en esta axila. */
  spanStart: number
  out: Twig[]
}

/**
 * Hace crecer una rama y, recursivamente, sus hijas.
 *
 * Cada rama se arquea hacia arriba a medida que avanza (gravitropismo: las
 * puntas buscan la luz) y va perdiendo grosor. Las hijas salen cerca de la
 * punta con un ángulo de divergencia variable, nunca el mismo dos veces.
 */
function grow(input: GrowInput): void {
  const { rng, origin, direction, length, radius, level, parent, parentT, spanStart, out } = input

  /*
   * Reparto del voladizo que queda.
   *
   * Cada nivel se queda con una parte de lo que va del punto donde nace
   * hasta 1. Al último nivel le toca todo lo que sobra, así las puntas
   * llegan justo a 1 y ninguna rama termina a mitad de camino.
   */
  const restantes = MAX_LEVEL - level + 1
  const spanEnd = spanStart + (1 - spanStart) / restantes

  const dir = direction.clone().normalize()

  // Arqueo hacia arriba, más marcado en las ramas finas.
  const lift = (0.16 + level * 0.11) * length
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize()
  if (side.lengthSq() < 0.001) side.set(1, 0, 0)

  const wobble = randomRange(rng, -0.09, 0.09) * length
  const segments = Math.max(5, 18 - level * 3)

  const points = [
    origin.clone(),
    origin
      .clone()
      .addScaledVector(dir, length * 0.34)
      .addScaledVector(UP, lift * 0.2)
      .addScaledVector(side, wobble * 0.4),
    origin
      .clone()
      .addScaledVector(dir, length * 0.7)
      .addScaledVector(UP, lift * 0.62)
      .addScaledVector(side, wobble),
    origin
      .clone()
      .addScaledVector(dir, length)
      .addScaledVector(UP, lift)
      .addScaledVector(side, wobble * 0.7)
      .add(
        new THREE.Vector3(
          randomRange(rng, -0.06, 0.06),
          randomRange(rng, -0.03, 0.07),
          randomRange(rng, -0.06, 0.06),
        ),
      ),
  ]

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
  const selfIndex = out.length

  out.push({
    curve,
    level,
    radius,
    parent,
    parentT,
    segments,
    uvStart: LEVEL_UV[level - 1],
    uvEnd: LEVEL_UV[level],
    spanStart,
    spanEnd,
  })

  if (level >= MAX_LEVEL) return

  // Dos o tres hijas. El tres es menos frecuente, si no la copa se infla.
  const childCount = rng() > 0.62 ? 3 : 2

  for (let i = 0; i < childCount; i++) {
    // Nacen escalonadas hacia la punta, no todas del mismo nudo.
    const at = 0.52 + (i / childCount) * 0.42 + randomRange(rng, -0.05, 0.05)
    const clamped = Math.min(0.97, at)

    const base = curve.getPointAt(clamped)
    const tangent = curve.getTangentAt(clamped)

    // Divergencia: ángulo variable alrededor de un eje que también rota,
    // así las hijas no quedan todas en el mismo plano.
    const divergence = randomRange(rng, 0.42, 0.92)
    const roll = i * GOLDEN_ANGLE + randomRange(rng, -0.5, 0.5)

    const axis = new THREE.Vector3()
      .crossVectors(tangent, UP)
      .normalize()
      .applyAxisAngle(tangent, roll)

    if (axis.lengthSq() < 0.001) axis.set(1, 0, 0)

    const childDir = tangent.clone().applyAxisAngle(axis, divergence).normalize()

    grow({
      rng,
      origin: base,
      direction: childDir,
      length: length * randomRange(rng, 0.6, 0.78),
      radius: radius * randomRange(rng, 0.5, 0.66),
      level: level + 1,
      parent: selfIndex,
      parentT: clamped,
      // Acá está toda la continuidad: la hija no empieza en el voladizo de
      // su nivel, empieza en el que tiene la madre en el punto exacto donde
      // se tocan. Sin esta línea el viento las separa en cada ráfaga.
      spanStart: spanStart + (spanEnd - spanStart) * clamped,
      out,
    })
  }
}

/**
 * Una rama madre por categoría.
 *
 * El ángulo sale del índice por filotaxis, así que cada área ocupa siempre
 * el mismo sector: quien vuelve al stand encuentra su rama donde la dejó.
 */
function buildBranch(
  slug: CategorySlug,
  color: string,
  slot: number,
  trunk: THREE.CatmullRomCurve3,
): BranchGeometry {
  const rng = seededRandom(`arbolia-branch-${slug}-v2`)

  // Espiral ascendente: las ramas nacen cada vez más arriba, girando.
  const angle = slot * GOLDEN_ANGLE + randomRange(rng, -0.1, 0.1)
  const heightRatio = slot / CATEGORIES.length
  const originT = 0.34 + heightRatio * 0.52 + randomRange(rng, -0.035, 0.035)
  const clampedT = Math.min(0.96, originT)

  const origin = trunk.getPointAt(clampedT)

  // Las de abajo son más largas y más abiertas; las de arriba, cortas y
  // empinadas. Es lo que da la silueta de copa en vez de rueda de carro.
  const length = randomRange(rng, 1.62, 2.08) * (1 - heightRatio * 0.28)
  const spread = 1 - heightRatio * 0.45

  const direction = new THREE.Vector3(
    Math.cos(angle) * spread,
    0.34 + heightRatio * 0.5,
    Math.sin(angle) * spread,
  ).normalize()

  const twigs: Twig[] = []
  grow({
    rng,
    origin,
    direction,
    length,
    radius: 0.068 * (1 - heightRatio * 0.22),
    level: 1,
    parent: -1,
    parentT: 0,
    // La rama nace clavada al tronco, que no se dobla: voladizo cero.
    spanStart: 0,
    out: twigs,
  })

  const leafSlots = buildLeafSlots(rng, twigs)

  return { slug, color, slot, twigs, originT: clampedT, leafSlots }
}

// ---------------------------------------------------------------------
// Posiciones de hoja
// ---------------------------------------------------------------------

/**
 * Las hojas se agrupan en las ramitas finas, en racimos hacia las puntas.
 * Repartirlas parejo por toda la rama —incluido el tramo grueso— es lo que
 * hace que un árbol digital parezca un cepillo.
 */
/**
 * Cuánto se dobla la madera en un punto dado de una ramita.
 *
 * Es el espejo exacto de la fórmula del vertex shader de la corteza (ver
 * energyMaterial). Vive acá porque las hojas necesitan el MISMO número que
 * la rama de la que cuelgan: si la hoja usa una aproximación propia, se
 * despega de su ramita en cada ráfaga y el racimo hormiguea en vez de
 * viajar entero.
 *
 * Medido sobre el árbol real, este valor va de 0.15 a 0.83 según dónde
 * cuelgue la hoja —mediana 0.50—, así que una constante no alcanza: en las
 * zonas rígidas las hojas se moverían cinco veces de más.
 */
export function twigFlex(twig: Twig, t: number, y: number): number {
  const span = twig.spanStart + (twig.spanEnd - twig.spanStart) * t
  const thickness = 1 - (twig.level - 1) / 4
  const rigido = 1 + (0.45 - 1) * Math.min(1, Math.max(0, thickness))
  const u = Math.min(1, Math.max(0, y / 1.2))
  const upward = u * u * (3 - 2 * u)
  return span * span * rigido * upward
}

function buildLeafSlots(rng: () => number, twigs: Twig[]): LeafSlot[] {
  const slots: LeafSlot[] = []

  twigs.forEach((twig, index) => {
    // Sólo las ramitas de los dos últimos niveles llevan hoja.
    if (twig.level < MAX_LEVEL - 1) return

    const density = twig.level === MAX_LEVEL ? 15 : 8
    const from = twig.level === MAX_LEVEL ? 0.16 : 0.55

    for (let i = 0; i < density; i++) {
      const t = from + (i / density) * (1 - from) + randomRange(rng, -0.03, 0.03)
      const clamped = Math.min(0.995, Math.max(0.02, t))

      const point = twig.curve.getPointAt(clamped)
      const tangent = twig.curve.getTangentAt(clamped)

      const side = new THREE.Vector3().crossVectors(tangent, UP).normalize()
      if (side.lengthSq() < 0.001) side.set(1, 0, 0)
      const up = new THREE.Vector3().crossVectors(side, tangent).normalize()

      // Racimo apretado alrededor de la ramita.
      const spread = 0.055 + clamped * 0.075
      const offset = new THREE.Vector3()
        .addScaledVector(side, randomRange(rng, -spread, spread))
        .addScaledVector(up, randomRange(rng, -spread * 0.8, spread))
        .addScaledVector(tangent, randomRange(rng, -spread * 0.5, spread * 0.5))

      const normal = offset.clone().normalize()
      if (normal.lengthSq() < 0.01) normal.copy(up)

      const position = point.clone().add(offset)

      slots.push({
        position,
        normal,
        scale: randomRange(rng, 0.72, 1.24),
        twig: index,
        t: clamped,
        flex: twigFlex(twig, clamped, position.y),
      })
    }
  })

  // Barajado determinista: la copa se llena pareja desde la primera idea,
  // en vez de crecer como una fila que avanza rama por rama.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }

  return slots
}

/**
 * Follaje de base: la masa de la copa.
 *
 * Es la capa que hace que esto se lea como un árbol y no como confeti
 * colgado de un esqueleto. Un árbol tiene miles de hojas agrupadas en
 * volúmenes, no cientos repartidas de a una: sin esta masa, las hojas
 * ciudadanas quedan flotando en el aire y se ve el andamio.
 *
 * Se generan como nubes elipsoidales alrededor de las ramitas terminales
 * —así la copa tiene bulto— y se tiñen con el color del área, que es lo que
 * produce el degradado por sector: cada zona del árbol es su categoría.
 *
 * Cuesta una sola llamada de dibujo: son instancias de la misma hoja.
 */
function buildAmbientSlots(branches: BranchGeometry[]): AmbientSlot[] {
  const rng = seededRandom('arbolia-ambient-v3')
  const slots: AmbientSlot[] = []

  branches.forEach((branch, branchIndex) => {
    // Sólo las ramitas finas llevan masa de follaje.
    const tips = branch.twigs.filter((t) => t.level >= MAX_LEVEL - 1)

    tips.forEach((twig) => {
      const isTerminal = twig.level === MAX_LEVEL
      const clusters = isTerminal ? 6 : 3
      const perCluster = isTerminal ? 13 : 7

      for (let c = 0; c < clusters; c++) {
        const at = 0.34 + (c / clusters) * 0.62
        const center = twig.curve.getPointAt(Math.min(0.99, at))
        const radius = (isTerminal ? 0.15 : 0.12) + at * 0.09

        for (let i = 0; i < perCluster; i++) {
          // Distribución en volumen, no en cáscara: la nube se ve llena.
          const theta = rng() * Math.PI * 2
          const phi = Math.acos(2 * rng() - 1)
          const r = radius * Math.cbrt(rng())

          const offset = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.cos(phi) * r * 0.78,
            Math.sin(phi) * Math.sin(theta) * r,
          )

          const normal = offset.clone().normalize()
          if (normal.lengthSq() < 0.01) normal.set(0, 1, 0)

          const position = center.clone().add(offset)

          slots.push({
            position,
            normal,
            scale: randomRange(rng, 0.62, 1.15),
            branch: branchIndex,
            /** Las de adentro del racimo van más oscuras: da profundidad. */
            depth: 1 - r / radius,
            flex: twigFlex(twig, Math.min(0.99, at), position.y),
          })
        }
      }
    })
  })

  /*
   * Barajado determinista, el mismo que buildLeafSlots.
   *
   * Faltaba acá, y se veía. Leaves dibuja los PRIMEROS N slots, con N según
   * la densidad de la etapa de crecimiento. Generados rama por rama, ese
   * prefijo es un orden alfabético de áreas: con la densidad de apertura
   * las tres últimas —Cultura, Urbanismo y Comunidad— quedaban con CERO
   * hojas de ambiente. Y son justo las tres ramas más altas del tronco, así
   * que el árbol abría la feria descabezado, con el vértice de la copa en
   * puro esqueleto y el color de tres áreas ausente.
   *
   * Con el barajado, la densidad hace lo que promete: la copa se llena
   * pareja en las ocho áreas y en toda su altura, y el recorte deja de
   * comerse un área entera.
   */
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }

  return slots
}

// ---------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------

let cached: TreeModel | null = null

export function getTreeModel(): TreeModel {
  if (cached) return cached

  const trunk = buildTrunk()
  const roots = buildRoots()
  const branches = CATEGORIES.map((category) =>
    buildBranch(category.slug, category.color, category.branchSlot, trunk),
  )
  const ambientSlots = buildAmbientSlots(branches)

  cached = { trunk, roots, branches, ambientSlots, height: TRUNK_HEIGHT }
  return cached
}

export function getBranchFor(model: TreeModel, slug: CategorySlug): BranchGeometry {
  return model.branches.find((b) => b.slug === slug) ?? model.branches[0]
}

/**
 * Posición que le toca a la hoja número `index` de una categoría.
 * Si se agotan los slots se reutilizan con un desplazamiento chico, para que
 * la copa se siga densificando sin superponer hojas exactamente.
 */
export function getLeafSlot(branch: BranchGeometry, index: number): LeafSlot {
  const slots = branch.leafSlots
  const base = slots[index % slots.length]
  const wrap = Math.floor(index / slots.length)
  if (wrap === 0) return base

  const rng = seededRandom(`${branch.slug}-wrap-${index}`)
  const jitter = 0.05 + wrap * 0.022
  return {
    ...base,
    position: base.position
      .clone()
      .add(
        new THREE.Vector3(
          randomRange(rng, -jitter, jitter),
          randomRange(rng, -jitter, jitter),
          randomRange(rng, -jitter, jitter),
        ),
      ),
    scale: base.scale * randomRange(rng, 0.88, 1.05),
  }
}

/**
 * Recorrido de la partícula: nace en una raíz, sube el tronco, y después
 * sigue la cadena real de ramas —madre, hija, nieta— hasta la hoja.
 */
export function buildJourneyPath(
  model: TreeModel,
  branch: BranchGeometry,
  slot: LeafSlot,
  seed: string,
): THREE.CatmullRomCurve3 {
  const rng = seededRandom(seed)
  const mains = model.roots.filter((r) => r.level === 1)
  const root = (mains[Math.floor(rng() * mains.length)] ?? model.roots[0]).curve

  const points: THREE.Vector3[] = [
    root.getPointAt(1),
    root.getPointAt(0.6),
    root.getPointAt(0.15),
    model.trunk.getPointAt(0.08),
    model.trunk.getPointAt(0.3),
    model.trunk.getPointAt(Math.min(0.95, branch.originT * 0.75)),
    model.trunk.getPointAt(branch.originT),
  ]

  // Cadena de ramas desde la madre hasta la que sostiene la hoja.
  const chain: Array<{ twig: Twig; until: number }> = []
  let current = slot.twig
  let until = slot.t

  while (current >= 0) {
    const twig = branch.twigs[current]
    chain.unshift({ twig, until })
    until = twig.parentT
    current = twig.parent
  }

  for (const link of chain) {
    const steps = link.twig.level === MAX_LEVEL ? 2 : 3
    for (let i = 1; i <= steps; i++) {
      const t = (link.until * i) / steps
      points.push(link.twig.curve.getPointAt(Math.min(0.999, Math.max(0.001, t))))
    }
  }

  points.push(slot.position.clone())

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3)
}
