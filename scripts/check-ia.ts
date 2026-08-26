/**
 * Verifica las dos promesas de la integración con IA.
 *
 *   1. La clave de Anthropic no puede terminar en el navegador.
 *   2. Sólo la propuesta sale del municipio. Nombre y dispositivo no.
 *
 * La segunda es una condición que puso el equipo y no se puede confiar a
 * que nadie la rompa sin querer: alcanza con agregar un campo al armado
 * del contexto para que el nombre de cada vecino empiece a viajar a un
 * servicio externo, y nada avisaría.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { armarContextoMigue } from '../src/lib/contextoMigue'
import { revisarPropuesta } from '../src/lib/ia'
import type { Idea, Stats } from '../src/lib/types'

let fallas = 0

function ok(titulo: string, condicion: boolean, detalle = '') {
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!condicion) fallas++
}

function archivos(dir: string, ext: string[]): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === 'dist' || nombre.startsWith('.')) continue
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta, ext))
    else if (ext.some((e) => nombre.endsWith(e))) salida.push(ruta)
  }
  return salida
}

/* ------------------------------------------------------------------ */
console.log('\nLA CLAVE NO LLEGA AL NAVEGADOR')

const fuentesCliente = archivos('src', ['.ts', '.tsx'])
const conClave = fuentesCliente.filter((f) => /ANTHROPIC_API_KEY|sk-ant-/.test(readFileSync(f, 'utf8')))
ok('ningún archivo de src/ nombra la clave', conClave.length === 0, conClave.join(', '))

const conSdk = fuentesCliente.filter((f) => /@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8')))
ok('ningún archivo de src/ importa el SDK', conSdk.length === 0, conSdk.join(', '))

const ejemplo = readFileSync('.env.example', 'utf8')
ok('.env.example define la clave sin prefijo VITE_', /^ANTHROPIC_API_KEY=/m.test(ejemplo))
ok('.env.example no define VITE_ANTHROPIC_*', !/VITE_ANTHROPIC/.test(ejemplo))

const env = (() => {
  try {
    return readFileSync('.env', 'utf8')
  } catch {
    return ''
  }
})()
if (env) {
  ok('el .env real no expone la clave con VITE_', !/VITE_ANTHROPIC/.test(env))
}

/* ------------------------------------------------------------------ */
console.log('\nSÓLO LA PROPUESTA SALE DEL MUNICIPIO')

const stats: Stats = {
  participants: 12,
  ideas: 3,
  areas: 2,
  byCategory: [],
} as unknown as Stats

const base = {
  category: 'movilidad',
  archived_at: null,
  created_at: '2026-09-03T14:30:00.000Z',
} as const

const muestra: Idea[] = [
  {
    ...base,
    id: 'a',
    text: 'Más colectivos por la avenida Mate de Luna',
    status: 'visible',
    author_name: 'Rodriguez Pereyra',
    age_range: '30-44',
    device_id: 'dev-abc123456789',
  },
  {
    ...base,
    id: 'b',
    text: 'Una plaza con juegos accesibles en Villa 9 de Julio',
    status: 'flagged',
    author_name: 'Ludmila Q',
    age_range: '18-29',
    device_id: 'dev-zzz987654321',
  },
  {
    ...base,
    id: 'c',
    text: 'Esta idea fue retirada por el equipo',
    status: 'hidden',
    author_name: 'Anónimo',
    age_range: '45-59',
    device_id: 'dev-oculto00000',
  },
]

const contexto = armarContextoMigue(muestra, stats)

ok('no viaja ningún nombre', !/Rodriguez|Ludmila|Anónimo/.test(contexto))
ok('no viaja ningún identificador de dispositivo', !/dev-/.test(contexto))
ok('sí viaja el texto de la propuesta', contexto.includes('Mate de Luna'))
ok('sí viaja el rango etario', contexto.includes('30-44'))
ok('sí viaja el área', contexto.includes('Movilidad'))
ok('una idea retirada no entra al análisis', !contexto.includes('fue retirada'))
ok('una idea en revisión sí entra', contexto.includes('Villa 9 de Julio'))
ok('viajan las 2 no retiradas', contexto.includes('PROPUESTAS (2)'))

/* ------------------------------------------------------------------ */
console.log('\nLA REVISIÓN FALLA ABIERTA')

// El código del navegador usa window.setTimeout; acá no hay window.
;(globalThis as { window?: unknown }).window = globalThis

const fetchOriginal = globalThis.fetch

async function conFetch(
  simulado: typeof globalThis.fetch,
  titulo: string,
) {
  globalThis.fetch = simulado
  try {
    const v = await revisarPropuesta('Poner más luces en el parque')
    ok(titulo, v.publicar === true && v.degradado === true)
  } finally {
    globalThis.fetch = fetchOriginal
  }
}

await conFetch(async () => {
  throw new Error('Failed to fetch')
}, 'sin red, la propuesta sigue viaje')

await conFetch(
  async () => new Response('Not Found', { status: 404 }),
  'con la función caída (404), la propuesta sigue viaje',
)

await conFetch(
  async () => new Response('<html>index</html>', { status: 200 }),
  'si el reenvío devuelve HTML en vez de JSON, la propuesta sigue viaje',
)

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({ publicar: false, motivo: 'Acusa a una persona con nombre.' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
const rechazo = await revisarPropuesta('Fulano de Obras cobra por cada habilitación')
globalThis.fetch = fetchOriginal
ok('un veredicto negativo se transmite con su motivo', !rechazo.publicar && rechazo.motivo.length > 0)

/* ------------------------------------------------------------------ */
console.log('\nEL REENVÍO DE VERCEL NO SE COME /api')

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites: { source: string; destination: string }[]
}
const regla = vercel.rewrites[0]
const patron = new RegExp(`^${regla.source}$`)
ok('/idea va al index del sitio', patron.test('/idea'))
ok('/admin va al index del sitio', patron.test('/admin'))
ok('/api/moderar llega a la función', !patron.test('/api/moderar'))
ok('/api/migue llega a la función', !patron.test('/api/migue'))

/* ------------------------------------------------------------------ */
console.log(
  fallas === 0
    ? '\nLa clave queda en el servidor y sólo la propuesta sale del municipio.\n'
    : `\n${fallas} verificación(es) fallaron.\n`,
)
process.exit(fallas === 0 ? 0 : 1)
