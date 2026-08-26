/**
 * Verificación de la rotación de etiquetas flotantes.
 *
 * Corre sin navegador. Comprueba las dos propiedades que importan en el
 * stand: que nunca se muestre la misma idea en dos etiquetas a la vez, y
 * que con el tiempo aparezcan todas —que nadie quede sin ver la suya
 * porque llegó temprano.
 *
 *   npm run check:labels
 */
import { pickNextIdea } from '../src/routes/screen/labelRotation'
import type { Idea } from '../src/lib/types'

const SLOT_COUNT = 3
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'OK  ' : 'FALLA'
  if (!ok) failures++
  console.log(`  ${mark}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function makeIdeas(n: number): Idea[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `idea-${i}`,
    text: `Propuesta ${i}`,
    category: 'comunidad' as const,
    device_id: `dev-${i}`,
    status: 'visible' as const,
    archived_at: null,
    created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  }))
}

/** Simula N rotaciones sobre un pool y devuelve lo que fue apareciendo. */
function simulate(pool: Idea[], rounds: number) {
  const slots: (Idea | null)[] = Array.from({ length: SLOT_COUNT }, () => null)
  let cursor = 0
  let nextSlot = 0

  const seen = new Set<string>()
  let collisions = 0
  let stalls = 0

  // Carga inicial, igual que el componente.
  const recent = pool.slice(-SLOT_COUNT)
  recent.forEach((idea, i) => {
    slots[SLOT_COUNT - 1 - i] = idea
    seen.add(idea.id)
  })
  cursor = recent.length

  for (let r = 0; r < rounds; r++) {
    const slotIndex = nextSlot % SLOT_COUNT
    nextSlot = slotIndex + 1

    const visible = new Set(
      slots.map((s) => s?.id).filter((id): id is string => Boolean(id)),
    )
    const outgoing = slots[slotIndex]
    if (outgoing) visible.delete(outgoing.id)

    const picked = pickNextIdea(pool, visible, cursor)
    if (!picked) {
      stalls++
      continue
    }

    cursor = picked.cursor
    slots[slotIndex] = picked.idea
    seen.add(picked.idea.id)

    // ¿Quedó duplicada en pantalla?
    const ids = slots.map((s) => s?.id).filter(Boolean)
    if (new Set(ids).size !== ids.length) collisions++
  }

  return { seen, collisions, stalls, slots }
}

console.log('\nROTACIÓN DE ETIQUETAS')

// --- Caso normal: histórico grande ------------------------------------
{
  const pool = makeIdeas(120)
  const { seen, collisions } = simulate(pool, 400)

  check('nunca muestra la misma idea en dos etiquetas', collisions === 0, `${collisions} choques`)
  check(
    'con el tiempo aparecen todas las ideas',
    seen.size === pool.length,
    `${seen.size}/${pool.length} vistas en 400 rotaciones`,
  )
}

// --- Histórico chico: apenas más ideas que slots ----------------------
{
  const pool = makeIdeas(4)
  const { collisions, stalls } = simulate(pool, 50)
  check('con 4 ideas y 3 slots sigue rotando sin repetir', collisions === 0, `${collisions} choques`)
  check('no se traba', stalls === 0, `${stalls} rondas sin candidata`)
}

// --- Caso límite: exactamente tantas ideas como slots -----------------
{
  const pool = makeIdeas(3)
  const { collisions } = simulate(pool, 20)
  check('con 3 ideas y 3 slots no rompe', collisions === 0, 'se queda quieto, que es lo correcto')
}

// --- Caso límite: una sola idea ---------------------------------------
{
  const pool = makeIdeas(1)
  const { collisions } = simulate(pool, 10)
  check('con una sola idea no duplica', collisions === 0)
}

// --- Sin ideas --------------------------------------------------------
{
  const result = pickNextIdea([], new Set(), 0)
  check('sin ideas devuelve null en vez de romper', result === null)
}

// --- El cursor recorre el histórico de nueva a vieja -------------------
{
  const pool = makeIdeas(10)
  const first = pickNextIdea(pool, new Set(), 0)
  check(
    'la primera candidata es la idea más reciente',
    first?.idea.id === 'idea-9',
    first?.idea.id,
  )

  const second = pickNextIdea(pool, new Set([first!.idea.id]), first!.cursor)
  check(
    'la siguiente es la anterior en el tiempo',
    second?.idea.id === 'idea-8',
    second?.idea.id,
  )
}

console.log(
  failures === 0
    ? '\nLa rotación de etiquetas se comporta como se espera.\n'
    : `\n${failures} verificación(es) fallaron.\n`,
)

process.exit(failures === 0 ? 0 : 1)
