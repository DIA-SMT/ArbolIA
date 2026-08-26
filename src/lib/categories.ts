import type { CategoryDef, CategorySlug } from './types'

/**
 * Las 8 areas de la ciudad.
 *
 * Los colores no son decorativos: identifican el área en la copa del árbol
 * y en el panel. Están verificados con el validador de paleta comparando
 * TODOS los pares —en un gráfico circular el orden cambia con los datos, así
 * que no alcanza con que se distingan los vecinos de una lista.
 *
 * La versión anterior tenía dos problemas reales: Comunidad y Movilidad se
 * confundían con visión normal (ΔE 6.9) y Urbanismo con Espacios públicos
 * eran indistinguibles para daltonismo (ΔE 0.3). Ahora son 13.8 y 5.4.
 *
 * Ocho clases de color es más de lo que el ojo separa con comodidad, así que
 * el color nunca va solo: en el árbol cada área ocupa un sector angular fijo,
 * y en el panel toda etiqueta lleva emoji y nombre. El orden define la posicion angular de cada
 * rama en el arbol, asi que es estable: no reordenar sin revisar el 3D.
 */
export const CATEGORIES: CategoryDef[] = [
  { slug: 'ambiente',   label: 'Ambiente',          emoji: '🌳', color: '#4ade80', branchSlot: 0 },
  { slug: 'movilidad',  label: 'Movilidad',         emoji: '🚲', color: '#67e8f9', branchSlot: 1 },
  { slug: 'espacios',   label: 'Espacios públicos', emoji: '🏙️', color: '#8b5cf6', branchSlot: 2 },
  { slug: 'tecnologia', label: 'Tecnología',        emoji: '💡', color: '#facc15', branchSlot: 3 },
  { slug: 'transporte', label: 'Transporte',        emoji: '🚌', color: '#f97316', branchSlot: 4 },
  { slug: 'cultura',    label: 'Cultura',           emoji: '🎭', color: '#f9a8d4', branchSlot: 5 },
  { slug: 'urbanismo',  label: 'Urbanismo',         emoji: '🏘️', color: '#60a5fa', branchSlot: 6 },
  { slug: 'comunidad',  label: 'Comunidad',         emoji: '🤝', color: '#14b8a6', branchSlot: 7 },
]

export const CATEGORY_MAP: Record<CategorySlug, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
) as Record<CategorySlug, CategoryDef>

export const DEFAULT_CATEGORY: CategorySlug = 'comunidad'

export function getCategory(slug: string | null | undefined): CategoryDef {
  if (slug && slug in CATEGORY_MAP) return CATEGORY_MAP[slug as CategorySlug]
  return CATEGORY_MAP[DEFAULT_CATEGORY]
}
