/**
 * Verificación de la migración 010 contra la base real.
 *
 * Comprueba lo único que importa de esa migración: que el panel dejó de
 * estar al alcance de cualquiera que se registre, y que al cerrarlo no se
 * rompió lo que el stand necesita leer.
 *
 * Todas las pruebas se hacen con la clave anónima, que es la que tendría
 * en la mano alguien de afuera. Ninguna escribe ni borra nada: la que
 * podría cambiar la meta se llama con un valor inválido a propósito, así
 * que aun pasando el control de permisos no dejaría rastro.
 *
 *   npm run check:equipo
 *
 * Conviene correrlo justo después de aplicar la 010, y otra vez el día
 * del armado antes de abrir.
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
 * La clave tiene que ser la anónima. Con la service_role todas estas
 * pruebas pasarían por el motivo equivocado: esa clave saltea RLS, así
 * que el informe diría "cerrado" justamente cuando está abierto de par
 * en par.
 */
function rolDelToken(jwt: string): string {
  try {
    const cuerpo = jwt.split('.')[1]
    return JSON.parse(Buffer.from(cuerpo, 'base64').toString('utf8')).role ?? '?'
  } catch {
    return '?'
  }
}

const rol = rolDelToken(key)
if (rol !== 'anon') {
  console.error(
    `\n  La clave del .env es "${rol}", no "anon". Con service_role esta ` +
      'verificación no prueba nada: saltea RLS.\n',
  )
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  console.log('\nLA PUERTA DEL PANEL (con la clave que tendría cualquiera)\n')

  // 1. La función de control existe y, sin sesión, dice que no.
  const { data: esDelEquipo, error: errFn } = await db.rpc('es_del_equipo')
  check(
    'existe la comprobación de equipo',
    !errFn,
    errFn ? `${errFn.code ?? ''} ${errFn.message}`.trim() : '',
  )
  check(
    'sin sesión, la comprobación dice que no',
    !errFn && esDelEquipo === false,
    errFn ? 'no se pudo llamar' : `devolvió ${JSON.stringify(esDelEquipo)}`,
  )

  // 2. La lista de quién tiene acceso no se puede enumerar.
  const { data: equipo, error: errEquipo } = await db.from('equipo').select('email')
  check(
    'la lista del equipo no se puede leer desde afuera',
    Boolean(errEquipo) || (equipo?.length ?? 0) === 0,
    errEquipo ? `rechazado: ${errEquipo.code ?? errEquipo.message}` : `devolvió ${equipo?.length} fila(s)`,
  )

  // 3. Reiniciar estadísticas: fuera del alcance de un anónimo.
  //    El permiso de ejecución es sólo para cuentas con sesión, así que
  //    esto se corta antes de tocar una sola fila.
  const { error: errReset } = await db.rpc('arbolia_reset_stats')
  check(
    'reiniciar estadísticas está fuera del alcance de un anónimo',
    Boolean(errReset),
    errReset ? `rechazado: ${errReset.code ?? errReset.message}` : 'PASÓ — archivó las ideas',
  )

  // 4. Cambiar la meta: idem. Se llama con 0, que es inválido, para que
  //    ni siquiera en el peor caso quede escrito algo.
  const { error: errMeta } = await db.rpc('arbolia_set_goal', { p_goal: 0 })
  check(
    'cambiar la meta está fuera del alcance de un anónimo',
    Boolean(errMeta),
    errMeta ? `rechazado: ${errMeta.code ?? errMeta.message}` : 'PASÓ',
  )
  /*
   * Y que el rechazo sea por el guardia, no porque la función no está.
   *
   * La comprobación de arriba aceptaba CUALQUIER error como buena señal. Si
   * alguien borrara arbolia_set_goal, o cambiara el nombre del parámetro,
   * PostgREST devolvería PGRST202 o PGRST203 —que también son errores— y
   * esto habría informado "protegido" con el panel roto. Es la misma
   * confusión que ya nos pasó una vez con una columna que no existía.
   */
  const codMeta = errMeta?.code ?? ''
  check(
    'y la función sigue existiendo, con su parámetro',
    codMeta !== 'PGRST202' && codMeta !== 'PGRST203',
    codMeta === 'PGRST202'
      ? 'PGRST202: PostgREST no la encuentra'
      : codMeta === 'PGRST203'
        ? 'PGRST203: hay más de una versión'
        : `rechazo legítimo: ${codMeta || errMeta?.message}`,
  )

  console.log('\nLO QUE EL STAND SIGUE NECESITANDO\n')

  /*
   * La 010 reescribió cuatro políticas. Si de paso hubiera roto la
   * lectura pública, el árbol abriría la feria en blanco: por eso esto
   * se verifica acá y no se deja para el día del armado.
   */
  const { data: publicas, error: errPub } = await db
    .from('ideas')
    .select('id, text, category, status, archived_at, created_at, tipo')
    .eq('status', 'approved')
    .is('archived_at', null)
    .limit(3)

  check(
    'la pantalla sigue pudiendo leer las ideas aprobadas',
    !errPub,
    errPub ? `${errPub.code ?? ''} ${errPub.message}`.trim() : `${publicas?.length ?? 0} fila(s)`,
  )

  /*
   * Y lo interno sigue interno: es la promesa que se le hizo al vecino.
   *
   * Los nombres tienen que ser los REALES de la tabla. Con uno inventado
   * Postgres contesta 42703 ("no existe esa columna") y la prueba pasa
   * sin haber probado nada: verde por el motivo equivocado. Por eso acá
   * sólo se acepta 42501, que es "existe y no te la doy".
   */
  for (const columna of ['author_name', 'age_range', 'device_id', 'revision_motivo']) {
    const { error } = await db.from('ideas').select(columna).limit(1)
    const negado = error?.code === '42501'
    check(
      `"${columna}" existe y sigue oculto para el público`,
      negado,
      negado
        ? 'rechazado: 42501'
        : error
          ? `rechazado por otra razón: ${error.code ?? ''} ${error.message}`.trim()
          : 'SE PUDO LEER',
    )
  }

  console.log(
    fallos === 0
      ? '\n  El panel quedó cerrado y el stand sigue leyendo lo suyo.\n'
      : `\n  ${fallos} verificación(es) fallaron. Revisar antes de abrir.\n`,
  )

  process.exit(fallos === 0 ? 0 : 1)
}

void main()
