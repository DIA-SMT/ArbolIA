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
import { conversar, hayAlgunProveedor, proveedores } from '../api/_lib/proveedor'
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
const conClave = fuentesCliente.filter((f) =>
  /ANTHROPIC_API_KEY|OPENROUTER_API_KEY|sk-ant-|sk-or-v1-/.test(readFileSync(f, 'utf8')),
)
ok('ningún archivo de src/ nombra la clave', conClave.length === 0, conClave.join(', '))

const conSdk = fuentesCliente.filter((f) => /@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8')))
ok('ningún archivo de src/ importa el SDK', conSdk.length === 0, conSdk.join(', '))

const ejemplo = readFileSync('.env.example', 'utf8')
ok('.env.example nombra OPENROUTER_API_KEY', /OPENROUTER_API_KEY=/.test(ejemplo))
ok('.env.example nombra ANTHROPIC_API_KEY', /ANTHROPIC_API_KEY=/.test(ejemplo))
// Lo que importa no es que estén, sino que ninguna lleve el prefijo que
// las empaquetaría dentro del JavaScript que descarga cada visitante.
ok(
  'ninguna clave de IA lleva prefijo VITE_ en .env.example',
  !/VITE_(ANTHROPIC|OPENROUTER|IA_)/.test(ejemplo),
)

const env = (() => {
  try {
    return readFileSync('.env', 'utf8')
  } catch {
    return ''
  }
})()
if (env) {
  ok(
    'el .env real no expone ninguna clave de IA con VITE_',
    !/VITE_(ANTHROPIC|OPENROUTER|IA_)/.test(env),
  )
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
console.log('\nELECCIÓN DE PROVEEDOR')

function conEntorno(vars: Record<string, string | undefined>, f: () => void) {
  const previo: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    f()
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const NADA = { ANTHROPIC_API_KEY: undefined, OPENROUTER_API_KEY: undefined, IA_PROVEEDOR: undefined }

conEntorno(NADA, () => {
  ok('sin ninguna clave no hay proveedor', proveedores().length === 0 && !hayAlgunProveedor())
})

conEntorno({ ...NADA, OPENROUTER_API_KEY: 'sk-or-v1-prueba' }, () => {
  ok('sólo con OpenRouter, se usa OpenRouter', proveedores().join() === 'openrouter')
})

conEntorno({ ...NADA, ANTHROPIC_API_KEY: 'sk-ant-prueba' }, () => {
  ok('sólo con Anthropic, se usa Anthropic', proveedores().join() === 'anthropic')
})

conEntorno(
  { ANTHROPIC_API_KEY: 'sk-ant-prueba', OPENROUTER_API_KEY: 'sk-or-v1-prueba', IA_PROVEEDOR: 'auto' },
  () => {
    ok('con las dos, arranca por Anthropic y cae a OpenRouter', proveedores().join() === 'anthropic,openrouter')
  },
)

conEntorno(
  { ANTHROPIC_API_KEY: 'sk-ant-prueba', OPENROUTER_API_KEY: 'sk-or-v1-prueba', IA_PROVEEDOR: 'openrouter' },
  () => {
    ok('IA_PROVEEDOR=openrouter ignora la clave de Anthropic', proveedores().join() === 'openrouter'),
      ok('...y no deja sin proveedor', hayAlgunProveedor())
  },
)

conEntorno({ ...NADA, IA_PROVEEDOR: 'openrouter' }, () => {
  ok('pedir un proveedor sin su clave no lo inventa', proveedores().length === 0)
})

/* ------------------------------------------------------------------ */
console.log('\nREARMADO DEL STREAM DE OPENROUTER')

/**
 * El stream llega partido por la red en trozos arbitrarios, no por evento.
 * Un evento puede quedar cortado al medio entre dos trozos, y OpenRouter
 * intercala comentarios de mantenimiento (": OPENROUTER PROCESSING") para
 * que la conexión no se caiga. Si el rearmado falla, Migue muestra texto
 * mutilado — y eso sólo se ve con red real, nunca en una prueba feliz.
 */
function streamFalso(trozos: string[]): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const t of trozos) controller.enqueue(enc.encode(t))
      controller.close()
    },
  })
  return new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`

const fetchReal = globalThis.fetch

async function juntarTexto(trozos: string[]): Promise<{ texto: string; empezo: boolean }> {
  globalThis.fetch = (async () => streamFalso(trozos)) as typeof globalThis.fetch
  let texto = ''
  let empezo = false
  try {
    await conversar({
      sistema: 'x',
      mensajes: [{ role: 'user', content: 'hola' }],
      alEmpezar: () => {
        empezo = true
      },
      onTexto: (f) => {
        texto += f
      },
    })
  } finally {
    globalThis.fetch = fetchReal
  }
  return { texto, empezo }
}

// Acá no sirve conEntorno: restaura el entorno en su `finally`, que corre
// antes que cualquier await de adentro.
const entornoPrevio = { ...process.env }
delete process.env.ANTHROPIC_API_KEY
process.env.OPENROUTER_API_KEY = 'sk-or-v1-prueba'
process.env.IA_PROVEEDOR = 'openrouter'

try {
  const entero = await juntarTexto([delta('Hola'), delta(' equipo'), 'data: [DONE]\n\n'])
  ok('junta los fragmentos en orden', entero.texto === 'Hola equipo', `"${entero.texto}"`)
  ok('avisa que empezó antes del primer fragmento', entero.empezo)

  // El mismo contenido, pero cortado en lugares hostiles: al medio de la
  // palabra "data", al medio del JSON y al medio del separador.
  const completo = delta('Hola') + delta(' equipo') + 'data: [DONE]\n\n'
  const partido = await juntarTexto([
    completo.slice(0, 7),
    completo.slice(7, 31),
    completo.slice(31, 60),
    completo.slice(60),
  ])
  ok(
    'sobrevive a que la red corte los eventos al medio',
    partido.texto === 'Hola equipo',
    `"${partido.texto}"`,
  )

  const conRuido = await juntarTexto([
    ': OPENROUTER PROCESSING\n\n',
    delta('Che'),
    ': OPENROUTER PROCESSING\n\n',
    delta(', mirá'),
    'data: [DONE]\n\n',
  ])
  ok('ignora los comentarios de mantenimiento', conRuido.texto === 'Che, mirá', `"${conRuido.texto}"`)

  const cortado = await juntarTexto([delta('Empieza'), delta(' y se corta')])
  ok('sin [DONE] igual entrega lo que llegó', cortado.texto === 'Empieza y se corta')
} finally {
  process.env = entornoPrevio
}

/* ------------------------------------------------------------------ */
console.log(
  fallas === 0
    ? '\nLas claves quedan en el servidor y sólo la propuesta sale del municipio.\n'
    : `\n${fallas} verificación(es) fallaron.\n`,
)
process.exit(fallas === 0 ? 0 : 1)
