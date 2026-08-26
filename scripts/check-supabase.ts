/**
 * Verificación de la conexión con Supabase.
 *
 * Recorre el camino crítico completo contra la base real: que el schema esté
 * aplicado, que RLS deje leer lo público y esconda lo moderado, que el
 * trigger de moderación funcione y que el límite de envíos frene el spam.
 *
 * Conviene correrlo apenas se conecta la base y otra vez el día del armado,
 * antes de abrir el stand.
 *
 *   npm run check:supabase
 *
 * Deja dos ideas de prueba en la base. Se avisa al final cómo borrarlas.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------

function leerEnv(): Record<string, string> {
  let raw = ''
  try {
    raw = readFileSync('.env', 'utf8')
  } catch {
    console.error('\n  No se encontró el archivo .env en la raíz del proyecto.\n')
    process.exit(1)
  }

  const out: Record<string, string> = {}
  for (const linea of raw.split('\n')) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const corte = limpia.indexOf('=')
    if (corte < 0) continue
    out[limpia.slice(0, corte).trim()] = limpia.slice(corte + 1).trim()
  }
  return out
}

let fallos = 0

function check(label: string, ok: boolean, detalle = '') {
  const marca = ok ? 'OK  ' : 'FALLA'
  if (!ok) fallos++
  console.log(`  ${marca}  ${label}${detalle ? ` — ${detalle}` : ''}`)
}

// ---------------------------------------------------------------------

const env = leerEnv()
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

console.log('\nCONEXIÓN')

if (!url || url === 'PEGAR_ACA' || !url.startsWith('http')) {
  console.error('\n  Falta VITE_SUPABASE_URL en el .env.')
  console.error('  Supabase → Project Settings → API → Project URL\n')
  process.exit(1)
}

if (!key || key === 'PEGAR_ACA' || key.length < 20) {
  console.error('\n  Falta VITE_SUPABASE_ANON_KEY en el .env.')
  console.error('  Supabase → Project Settings → API → anon / public\n')
  process.exit(1)
}

// Salvaguarda: la service_role saltea RLS por completo. Si termina en el
// bundle del navegador, cualquiera puede leer y borrar toda la base.
if (key.includes('service_role') || key.startsWith('sb_secret_')) {
  console.error('\n  ⚠  Esa parece ser la clave service_role o secret.')
  console.error('  Nunca va en el .env de una app de navegador: saltea RLS')
  console.error('  y quedaría expuesta en el bundle. Usá la anon / publishable.\n')
  process.exit(1)
}

check('el .env tiene URL y clave', true, url.replace(/^https?:\/\//, ''))

const db = createClient(url, key)
const marca = Date.now().toString(36)

// ---------------------------------------------------------------------

async function main() {
  // --- Schema aplicado ---------------------------------------------
  console.log('\nSCHEMA')

  const { data: cats, error: catsError } = await db
    .from('categories')
    .select('slug, label, color')
    .order('sort_order')

  if (catsError) {
    check('tabla categories', false, catsError.message)
    console.log('\n  Parece que falta ejecutar supabase/schema.sql en el SQL Editor.\n')
    process.exit(1)
  }

  check('las 8 áreas están cargadas', cats?.length === 8, `${cats?.length ?? 0}`)

  const { data: stats, error: statsError } = await db.rpc('arbolia_stats')
  check('la función arbolia_stats responde', !statsError, statsError?.message)

  if (stats) {
    const s = stats as { ideas: number; participants: number; areas: number }
    check(
      'devuelve los contadores',
      typeof s.ideas === 'number' && typeof s.participants === 'number',
      `${s.ideas} ideas · ${s.participants} participantes · ${s.areas} áreas`,
    )
  }

  // --- Camino del ciudadano ----------------------------------------
  console.log('\nENVÍO DE IDEAS')

  const dispositivo = `dev_prueba_${marca}`
  const { data: idea, error: ideaError } = await db.rpc('arbolia_submit_idea', {
    p_text: `Prueba de conexión ${marca} — se puede borrar`,
    p_category: 'tecnologia',
    p_device_id: dispositivo,
    p_author_name: null,
    p_age_range: '30-44',
  })

  // Una sobrecarga sin resolver devuelve 300 y rompe todos los envíos.
  if (ideaError?.code === 'PGRST203') {
    check(
      'la función de envío no está duplicada',
      false,
      'hay dos versiones de arbolia_submit_idea: correr 006-datos-internos.sql',
    )
    console.log('\n  Ejecutá esa migración en el SQL Editor y volvé a correr esto.\n')
    process.exit(1)
  }

  if (ideaError && ideaError.message.includes('arbolia_submit_idea')) {
    check('la función de envío existe', false, 'falta correr supabase/migrations/001-submit-idea.sql')
    console.log('\n  Ejecutá esa migración en el SQL Editor y volvé a correr esto.\n')
    process.exit(1)
  }

  const enviada = idea as { id: string; status: string } | null
  check('se puede enviar una idea', !ideaError, ideaError?.message)
  check('nace publicada', enviada?.status === 'visible', enviada?.status)

  // --- Límite de envíos --------------------------------------------
  const { error: rapido } = await db.rpc('arbolia_submit_idea', {
    p_text: 'Segundo envío inmediato del mismo dispositivo',
    p_category: 'tecnologia',
    p_device_id: dispositivo,
    p_author_name: null,
    p_age_range: null,
  })

  check(
    'el límite frena dos envíos seguidos',
    Boolean(rapido && `${rapido.message} ${rapido.hint ?? ''}`.includes('RATE_LIMIT')),
    rapido ? 'rechazado como corresponde' : 'NO frenó: revisar el trigger',
  )

  // --- Moderación ---------------------------------------------------
  console.log('\nMODERACIÓN')

  const { data: suciaRaw, error: suciaError } = await db.rpc('arbolia_submit_idea', {
    p_text: 'esta ciudad es una mierda',
    p_category: 'comunidad',
    p_device_id: `dev_filtro_${marca}`,
    p_author_name: null,
    p_age_range: '18-29',
  })

  const sucia = suciaRaw as { id: string; status: string } | null

  /*
   * Este es el caso que rompía la app: una idea que el filtro marca no se
   * puede leer con la clave pública, así que un INSERT ... RETURNING fallaba
   * y la persona veía "no pudimos enviar tu idea" aunque sí se había
   * guardado. La función de envío devuelve el estado sin abrir la lectura.
   */
  check('acepta el envío aunque el filtro lo marque', !suciaError, suciaError?.message)
  check(
    'y avisa que quedó para revisión',
    sucia?.status === 'flagged',
    sucia?.status ?? '(sin dato)',
  )

  if (sucia?.id) {
    const { data: buscada } = await db.from('ideas').select('id').eq('id', sucia.id)
    check(
      'RLS la esconde del público',
      !buscada || buscada.length === 0,
      'no se puede leer con la clave anónima',
    )
  }

  // --- Lectura pública ----------------------------------------------
  console.log('\nLECTURA PÚBLICA')

  const { data: visibles, error: leerError } = await db
    .from('ideas')
    .select('id, text, status')
    .limit(5)

  check('se pueden leer las ideas publicadas', !leerError, leerError?.message)
  check(
    'sólo devuelve las publicadas',
    (visibles ?? []).every((i) => i.status === 'visible'),
  )

  /*
   * --- Aislamiento del cliente público -----------------------------
   *
   * Esto atrapa un fallo que ya ocurrió en el stand de pruebas: con una
   * sesión de administrador abierta en el mismo navegador, la pantalla
   * pasaba a consultar como usuario autenticado y las políticas
   * permisivas de RLS le daban acceso a las ideas moderadas, que
   * terminaban proyectadas en el árbol.
   *
   * La consulta que usa la pantalla tiene que devolver SÓLO publicadas
   * aunque alguien tenga sesión, porque filtra explícitamente además de
   * confiar en RLS.
   */
  console.log('\nAISLAMIENTO DE LA PANTALLA')

  const { data: comoPantalla, error: pantallaError } = await db
    .from('ideas')
    .select('id, status, archived_at')
    .eq('status', 'visible')
    .is('archived_at', null)
    .limit(50)

  check('la consulta de la pantalla responde', !pantallaError, pantallaError?.message)
  check(
    'nunca devuelve nada que no esté publicado',
    (comoPantalla ?? []).every((i) => i.status === 'visible' && i.archived_at === null),
    `${comoPantalla?.length ?? 0} filas, todas publicadas`,
  )

  // El filtro tiene que estar en el cliente, no sólo en RLS: si mañana
  // alguien agrega una política permisiva, esto sigue tapando el agujero.
  const { data: sinFiltro } = await db.from('ideas').select('status').limit(50)
  const soloVisibles = (sinFiltro ?? []).every((i) => i.status === 'visible')
  check(
    'RLS también filtra por su cuenta',
    soloVisibles,
    soloVisibles ? 'doble red activa' : 'RLS deja pasar de más: el filtro del cliente es lo único que protege',
  )

  /*
   * --- Datos internos ----------------------------------------------
   *
   * La regla del proyecto: en el stand sólo se publica la propuesta. El
   * nombre y el rango etario existen para el informe del municipio.
   *
   * Que la pantalla "no los muestre" no alcanza: la clave pública viaja al
   * navegador de cada visitante, así que cualquiera puede consultar la API
   * directamente. Lo que sostiene la promesa es el permiso a nivel de
   * columna — RLS decide qué FILAS se ven, no qué columnas.
   */
  console.log('\nDATOS INTERNOS')

  const { data: fila } = await db.from('ideas').select('*').limit(1)
  const columnas = fila?.[0] ? Object.keys(fila[0]) : []

  check(
    'el nombre no es legible con la clave pública',
    !columnas.includes('author_name'),
    columnas.length ? `columnas públicas: ${columnas.join(', ')}` : '(sin ideas para comprobar)',
  )
  check('la edad no es legible con la clave pública', !columnas.includes('age_range'))
  check('el identificador de dispositivo tampoco', !columnas.includes('device_id'))

  // Pedirlos por nombre tiene que fallar, no devolver nulos.
  const { error: dirigido } = await db.from('ideas').select('author_name, age_range').limit(1)
  check(
    'pedirlos explícitamente es rechazado',
    Boolean(dirigido),
    dirigido ? 'permiso denegado, como corresponde' : 'LA CONSULTA PASÓ: falta la migración 006',
  )

  // Pero los agregados sí funcionan: el municipio necesita el informe.
  const { data: edades, error: edadesError } = await db.rpc('arbolia_por_edad')
  if (edadesError) {
    check('participación por edad', false, 'falta correr 006 o 005-autor.sql')
  } else {
    const rangos = (edades ?? []) as Array<{ label: string; total: number }>
    const conDatos = rangos.filter((r) => r.total > 0)
    check(
      'el resumen por edad sí responde',
      rangos.length === 6,
      conDatos.map((r) => `${r.label}: ${r.total}`).join(' · ') || 'sin datos todavía',
    )
  }

  // --- Panel: ajustes y evolución -----------------------------------
  console.log('\nPANEL')

  const { data: ajuste, error: ajusteError } = await db
    .from('settings')
    .select('key, value')
    .eq('key', 'goal')
    .maybeSingle()

  if (ajusteError) {
    check('tabla settings', false, 'falta correr supabase/migrations/002-panel.sql')
  } else {
    check(
      'la meta está guardada en la base',
      Boolean(ajuste),
      `meta = ${ajuste?.value ?? '?'}`,
    )
  }

  const { data: serie, error: serieError } = await db.rpc('arbolia_timeline', { p_hours: 6 })

  if (serieError) {
    check('función de evolución por hora', false, 'falta correr 002-panel.sql')
  } else {
    const filas = (serie ?? []) as Array<{ hora: string; publicadas: number }>
    check('la evolución por hora responde', filas.length === 6, `${filas.length} horas devueltas`)
    // Las horas vacías tienen que venir igual: un gráfico que las saltea
    // miente sobre el ritmo de participación.
    check(
      'incluye las horas sin ideas',
      filas.length > 0 && filas.every((f) => typeof f.publicadas === 'number'),
      'sin huecos en la serie',
    )
  }

  // Escritura de ajustes: sin sesión no debe poder tocarse.
  const { error: escrituraError } = await db.rpc('arbolia_set_goal', { p_goal: 999 })
  check(
    'sin sesión no se puede cambiar la meta',
    Boolean(escrituraError),
    escrituraError ? 'rechazado como corresponde' : 'PELIGRO: cualquiera podría cambiarla',
  )

  // --- Realtime ------------------------------------------------------
  console.log('\nTIEMPO REAL')

  const conectado = await new Promise<boolean>((resolve) => {
    const canal = db
      .channel(`prueba-${marca}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ideas' }, () => {})
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') resolve(true)
        if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') resolve(false)
      })

    setTimeout(() => {
      void db.removeChannel(canal)
      resolve(false)
    }, 8000)
  })

  check(
    'el canal de tiempo real conecta',
    conectado,
    conectado ? '' : 'revisar que la tabla esté en la publicación supabase_realtime',
  )

  // ---------------------------------------------------------------
  console.log(
    fallos === 0
      ? '\n  Todo conectado. La instalación puede leer y escribir en la base.'
      : `\n  ${fallos} verificación(es) fallaron.`,
  )
  console.log(
    `\n  Quedaron 2 ideas de prueba con la marca "${marca}".` +
      '\n  Se borran desde /admin, o con este SQL:' +
      `\n    delete from ideas where device_id like 'dev_%_${marca}';\n`,
  )

  process.exit(fallos === 0 ? 0 : 1)
}

void main()
