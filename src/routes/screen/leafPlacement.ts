import * as THREE from 'three'
import { getBranchFor, getLeafSlot, getTreeModel, type LeafSlot } from './treeGeometry'
import { randomRange, seededRandom } from '../../lib/rng'
import type { CategorySlug, Idea } from '../../lib/types'

export interface PlacedLeaf {
  id: string
  slot: LeafSlot
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: number
  color: THREE.Color
  category: CategorySlug
}

const FACE = new THREE.Vector3(0, 0, 1)

/**
 * Orientación de la hoja: la cara mira hacia la normal del slot y después
 * gira un poco sobre su propio eje. El giro sale del id de la idea, así que
 * es siempre el mismo para la misma hoja.
 */
export function leafQuaternion(
  slot: { normal: THREE.Vector3 },
  seed: string,
): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(FACE, slot.normal.clone().normalize())
  const rng = seededRandom(`${seed}-spin`)
  const spin = new THREE.Quaternion().setFromAxisAngle(
    slot.normal.clone().normalize(),
    rng() * Math.PI * 2,
  )
  return q.premultiply(spin)
}

/**
 * Resuelve dónde va la hoja de una idea, dado cuántas ideas de esa misma
 * categoría ya están plantadas. Determinista: la hoja número 12 de
 * "movilidad" cae siempre en el mismo lugar de la rama de movilidad.
 */
/**
 * Variación de color por hoja.
 *
 * Todas las hojas de una categoría con el mismo hex exacto se leen como un
 * bloque de color plano, y eso es lo que hace que un follaje digital parezca
 * pintado con balde. Un árbol real tiene decenas de verdes conviviendo.
 * El desvío sale del id, así que la hoja de cada persona tiene su tono y lo
 * conserva entre recargas.
 */
function leafColor(base: string, seed: string): THREE.Color {
  const rng = seededRandom(`${seed}-tint`)
  const color = new THREE.Color(base)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)

  return color.setHSL(
    (hsl.h + randomRange(rng, -0.028, 0.028) + 1) % 1,
    Math.min(1, Math.max(0, hsl.s + randomRange(rng, -0.16, 0.1))),
    Math.min(0.92, Math.max(0.22, hsl.l + randomRange(rng, -0.16, 0.14))),
  )
}

export function placeLeaf(idea: Idea, indexInCategory: number): PlacedLeaf {
  const model = getTreeModel()
  const branch = getBranchFor(model, idea.category)
  const slot = getLeafSlot(branch, indexInCategory)

  return {
    id: idea.id,
    slot,
    position: slot.position.clone(),
    quaternion: leafQuaternion(slot, idea.id),
    scale: slot.scale,
    color: leafColor(branch.color, idea.id),
    category: idea.category,
  }
}

/** Recalcula el layout completo de la copa a partir de la lista de ideas. */
export function placeAll(ideas: Idea[]): {
  leaves: PlacedLeaf[]
  counters: Record<string, number>
} {
  const counters: Record<string, number> = {}
  const leaves = ideas.map((idea) => {
    const n = counters[idea.category] ?? 0
    counters[idea.category] = n + 1
    return placeLeaf(idea, n)
  })
  return { leaves, counters }
}
