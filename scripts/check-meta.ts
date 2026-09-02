/**
 * Verificación de la meta contra la base real, después de la migración 011.
 *
 * QUÉ PASÓ. La migración 010 redefinió arbolia_set_goal escribiendo
 * `p_goal::text` en settings.value, que es jsonb. Postgres rechaza eso al
 * ejecutar, y plpgsql no resuelve tipos hasta que la función corre: la
 * migración se aplicó sin quejarse y el error apareció recién cuando el
 * equipo quiso mover la meta desde el panel, en plena preparación de la
 * feria. La 011 lo corrige con to_jsonb.
 *
 * QUÉ SE PUEDE PROBAR DESDE ACÁ, Y QUÉ NO.
 *
 * Todo esto corre con la clave anónima, que es la única que tengo. Con ella
 * se puede comprobar que la meta se lee, con qué forma está guardada, que la
 * función existe y resuelve, y que un anónimo no la puede tocar.
 *
 * Lo que NO se puede probar desde afuera es la escritura en sí: la función
 * pide estar en la tabla `equipo` antes que nada, así que cualquier llamada
 * sin sesión del equipo se rechaza antes de llegar al insert. Esa parte la
 * prueba el bloque de verificación de la propia migración —que ejecuta el
 * insert que estaba roto— y el botón Guardar del panel.
 *
 *   npm run check:meta
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

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
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${label}${detalle ? ` — ${detalle}` : ''}`)
}

const env = leerEnv()
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || !key || !url.startsWith('http')) {
  console.error('\n  Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el .env.\n')
  process.exit(1)
}

/*
 * Tiene que ser la clave anónima. Con la service_role estas pruebas
 * pasarían por el motivo equivocado: esa clave saltea RLS y el informe
 * diría "protegido" justo cuando está abierto.
 */
if (key.includes('service_role')) {
  console.error('\n  Esa es la service_role. Estas pruebas van con la anónima.\n')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  console.log('\nLA META SE LEE\n')

  const { data: fila, error: errLeer } = await db
    .from('settings')
    .select('key, value, updated_at')
    .eq('key', 'goal')
    .maybeSingle()

  check(
    'la meta es legible sin sesión',
    !errLeer && !!fila,
    errLeer ? errLeer.message : 'la pantalla y el celular la necesitan para la barra de progreso',
  )

  if (!fila) {
    console.log('\n  Sin fila de meta no se puede seguir.\n')
    process.exit(1)
  }

  const valor = (fila as { value: unknown }).value

  /*
   * La forma del valor, que es exactamente lo que la 010 rompía.
   *
   * La columna es jsonb. La función corregida escribe to_jsonb(int), así que
   * acá tiene que llegar un NÚMERO. Si llegara una cadena, alguien escribió
   * texto adentro del jsonb y fetchGoal quedaría a merced de un Number()
   * sobre algo que no controlamos.
   */
  check(
    'está guardada como número, no como texto',
    typeof valor === 'number',
    `llegó ${typeof valor}: ${JSON.stringify(valor)}`,
  )

  const meta = Number(valor)
  check(
    'es un valor usable',
    Number.isFinite(meta) && meta >= 10 && meta <= 100000,
    `meta vigente: ${meta}`,
  )

  const cuando = (fila as { updated_at?: string }).updated_at
  if (cuando) {
    console.log(`        última modificación: ${new Date(cuando).toLocaleString('es-AR')}`)
  }

  console.log('\nLA FUNCIÓN EXISTE Y RESUELVE\n')

  /*
   * Se llama con 0, que es inválido a propósito: aunque por algún motivo
   * pasara el control de permisos, el rango lo rechaza y no queda escrito
   * nada.
   */
  const { error: errRpc } = await db.rpc('arbolia_set_goal', { p_goal: 0 })

  check('un anónimo no puede cambiar la meta', Boolean(errRpc), errRpc ? '' : 'PASÓ, y no debería')

  /*
   * Acá está la diferencia con la comprobación que ya existía, que aceptaba
   * CUALQUIER error como buena señal.
   *
   * Si la función no existiera, o si el nombre del parámetro no coincidiera,
   * PostgREST devuelve PGRST202 o PGRST203. Eso también es "un error", así
   * que la prueba anterior habría dado OK con la función borrada: habría
   * informado seguridad donde en realidad había una función faltante y un
   * panel roto.
   */
  const codigo = errRpc?.code ?? ''
  check(
    'existe, con el nombre y el parámetro esperados',
    codigo !== 'PGRST202' && codigo !== 'PGRST203',
    codigo === 'PGRST202'
      ? 'PGRST202: PostgREST no la encuentra — falta correr la migración'
      : codigo === 'PGRST203'
        ? 'PGRST203: hay más de una versión y no sabe cuál usar'
        : `rechazada con ${codigo || errRpc?.message}`,
  )

  check(
    'el rechazo es por permisos, no por otra cosa',
    codigo === '42501' || /NOT_AUTHORIZED|permission/i.test(errRpc?.message ?? ''),
    `código ${codigo || '(sin código)'}: ${errRpc?.message ?? ''}`,
  )

  console.log('\nNADA QUEDÓ SUCIO\n')

  const { data: despues } = await db
    .from('settings')
    .select('value')
    .eq('key', 'goal')
    .maybeSingle()

  check(
    'el intento anónimo no movió la meta',
    Number((despues as { value: unknown } | null)?.value) === meta,
    `sigue en ${meta}`,
  )

  const { data: prueba } = await db
    .from('settings')
    .select('key')
    .eq('key', '__prueba_meta')
    .maybeSingle()

  check(
    'la migración no dejó su fila de prueba',
    !prueba,
    prueba ? 'quedó __prueba_meta en settings' : 'la borró al terminar',
  )

  console.log('\n─────────────────────────────────────────────────────────')
  if (fallos === 0) {
    console.log('  La meta se lee, está bien guardada y la función responde.')
    console.log('  Lo único que no se puede probar sin sesión del equipo es')
    console.log('  la escritura: eso lo confirma el botón Guardar del panel.')
  } else {
    console.log(`  ${fallos} verificación(es) fallaron.`)
  }
  console.log('─────────────────────────────────────────────────────────\n')

  process.exit(fallos === 0 ? 0 : 1)
}

void main()
