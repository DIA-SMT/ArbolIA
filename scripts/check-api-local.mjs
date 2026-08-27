/**
 * Verifica que el servidor de desarrollo no sirva más que sus endpoints.
 *
 * El plugin que sirve /api en local tuvo un agujero real: el filtro
 * rechazaba la barra normal pero no la invertida, que en Windows también
 * separa rutas. Con eso se podía cargar y EJECUTAR cualquier .ts del
 * disco en un proceso donde process.env ya tiene las claves de IA — y el
 * servidor escucha en toda la red, así que en el predio de la feria
 * cualquiera en el mismo wifi llegaba a la notebook.
 *
 * Las peticiones van por socket crudo a propósito: fetch y curl normalizan
 * la ruta antes de mandarla y el ataque no se reproduce.
 *
 *   node scripts/check-api-local.mjs        (con `npm run dev` levantado)
 */
import { connect } from 'node:net'

const PUERTO = Number(process.argv[2] ?? 5173)

function pedir(rutaCruda, metodo = 'GET') {
  return new Promise((listo) => {
    const socket = connect(PUERTO, '127.0.0.1', () => {
      socket.write(
        `${metodo} ${rutaCruda} HTTP/1.1\r\nHost: localhost:${PUERTO}\r\nConnection: close\r\n\r\n`,
      )
    })
    let datos = ''
    socket.on('data', (t) => (datos += t))
    socket.on('end', () => {
      const estado = Number(/^HTTP\/1\.\d (\d{3})/.exec(datos)?.[1] ?? 0)
      const cuerpo = datos.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      listo({ estado, cuerpo: cuerpo.slice(0, 200) })
    })
    socket.on('error', () => listo({ estado: 0, cuerpo: 'sin conexión' }))
  })
}

let fallas = 0
const ok = (titulo, condicion, detalle = '') => {
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!condicion) fallas++
}

const vivo = await pedir('/api/moderar', 'POST')
if (vivo.estado === 0) {
  console.error('\n  El servidor de desarrollo no está levantado. Corré `npm run dev`.\n')
  process.exit(1)
}

console.log('\nNO SE SALE DE api/')

// Las tres que la auditoría reprodujo contra el plugin anterior.
for (const ruta of [
  '/api/..\\api\\_lib\\claude',
  '/api/..\\api\\_lib\\sesion',
  '/api/..\\src\\lib\\ia',
  '/api/..\\..\\package',
  '/api/../api/_lib/claude',
  '/api/_lib/claude',
  '/api/_lib',
]) {
  const r = await pedir(ruta)
  ok(`${ruta.padEnd(30)} rechazado`, r.estado === 404, `dio ${r.estado}`)
}

console.log('\nNO FILTRA RUTAS INTERNAS')
const inexistente = await pedir('/api/nada')
ok('un endpoint inexistente da 404, no 500', inexistente.estado === 404, `dio ${inexistente.estado}`)
ok(
  'y no revela rutas del proyecto',
  !/Failed to load url|resolved id|[A-Za-z]:\\/.test(inexistente.cuerpo),
  inexistente.cuerpo.slice(0, 60),
)

console.log('\nSENSIBLE A MAYÚSCULAS, COMO VERCEL')
const gritado = await pedir('/api/MODERAR', 'POST')
ok('/api/MODERAR da 404 igual que en Linux', gritado.estado === 404, `dio ${gritado.estado}`)

console.log('\nLOS ENDPOINTS REALES SIGUEN ANDANDO')
ok('/api/moderar responde', vivo.estado === 200 || vivo.estado === 400, `dio ${vivo.estado}`)
const migue = await pedir('/api/migue', 'POST')
ok('/api/migue exige sesión', migue.estado === 401, `dio ${migue.estado}`)

console.log(
  fallas === 0
    ? '\nEl servidor de desarrollo sólo sirve sus endpoints.\n'
    : `\n${fallas} verificación(es) fallaron.\n`,
)
process.exit(fallas === 0 ? 0 : 1)
