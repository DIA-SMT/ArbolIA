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

// --- Una vuelta y listo ----------------------------------------------
{
  /*
   * Con pocas propuestas cargadas, las mismas tres cards giraban entre
   * ellas para siempre y la pantalla se leía como congelada. Ahora cada
   * idea hace UN turno por ronda: cuando se agotan, los slots se vacían y
   * la copa queda limpia hasta que empiece la ronda siguiente.
   */
  const pool = makeIdeas(3)
  const mostradas = new Set<string>()
  let cursor = 0
  const salieron: string[] = []

  for (let i = 0; i < 12; i++) {
    const elegida = pickNextIdea(pool, new Set(), cursor, mostradas)
    if (!elegida) break
    cursor = elegida.cursor
    mostradas.add(elegida.idea.id)
    salieron.push(elegida.idea.id)
  }

  check(
    'con 3 ideas salen 3 y se termina la ronda',
    salieron.length === 3,
    `salieron ${salieron.length}`,
  )
  check(
    'ninguna repite dentro de la ronda',
    new Set(salieron).size === salieron.length,
    salieron.join(', '),
  )
  check(
    'agotada la ronda devuelve null: el slot se vacía',
    pickNextIdea(pool, new Set(), cursor, mostradas) === null,
  )
}

{
  // Empezar una ronda nueva es vaciar la memoria. Después vuelven todas.
  const pool = makeIdeas(4)
  const mostradas = new Set(pool.map((i) => i.id))
  check(
    'con la ronda agotada no hay candidata',
    pickNextIdea(pool, new Set(), 0, mostradas) === null,
  )

  mostradas.clear()
  check(
    'tras el descanso vuelve a haber candidatas',
    pickNextIdea(pool, new Set(), 0, mostradas) !== null,
  )
}

{
  // Una idea nueva que llega con la ronda agotada sí tiene que poder salir.
  const pool = makeIdeas(3)
  const mostradas = new Set(pool.map((i) => i.id))
  const nueva = { ...pool[0], id: 'idea-nueva', text: 'recién llegada' }
  const conNueva = [...pool, nueva]

  const elegida = pickNextIdea(conNueva, new Set(), 0, mostradas)
  check(
    'una propuesta nueva sale aunque la ronda esté agotada',
    elegida?.idea.id === 'idea-nueva',
    elegida?.idea.id ?? 'ninguna',
  )
}

{
  // La memoria de la ronda no puede tapar el otro invariante: nunca dos
  // etiquetas con la misma idea al mismo tiempo.
  const pool = makeIdeas(10)
  const mostradas = new Set<string>()
  const visibles = new Set<string>()
  let cursor = 0
  let choques = 0

  for (let i = 0; i < 10; i++) {
    const elegida = pickNextIdea(pool, visibles, cursor, mostradas)
    if (!elegida) break
    if (visibles.has(elegida.idea.id)) choques++
    visibles.add(elegida.idea.id)
    mostradas.add(elegida.idea.id)
    cursor = elegida.cursor
  }
  check('sigue sin repetir entre slots visibles', choques === 0, `${choques} choques`)
}

console.log(
  failures === 0
    ? '\nLa rotación de etiquetas se comporta como se espera.\n'
    : `\n${failures} verificación(es) fallaron.\n`,
)

process.exit(failures === 0 ? 0 : 1)
