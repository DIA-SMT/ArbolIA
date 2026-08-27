import { readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Sirve la carpeta /api durante `vite dev`.
 *
 * En producción esas funciones las corre Vercel. En desarrollo no las
 * servía nadie: /api/moderar devolvía 404, la revisión semántica fallaba
 * abierta y TODA idea entraba como propuesta, así que ninguna crítica caía
 * nunca. Migue directamente no respondía. Y nada de eso fallaba a la
 * vista: la instalación se veía bien y le faltaba la mitad.
 *
 * Con esto el ciclo completo —formulario, clasificación, caída, panel—
 * funciona en local igual que en el stand, sin `vercel dev` ni vincular el
 * proyecto.
 *
 * `apply: 'serve'` es la parte importante: el plugin no existe en el build
 * de producción. Nada de esto se empaqueta ni toca lo que descarga un
 * visitante.
 */
export function apiLocal(): Plugin {
  return {
    name: 'arbolia:api-local',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      cargarEntorno()

      /*
       * Lista blanca de endpoints, leída del disco al arrancar.
       *
       * Antes esto era una lista negra —rechazar lo que tuviera '/' o
       * empezara con guion bajo— y tenía un agujero serio: en Windows la
       * barra invertida también separa rutas, así que un nombre con ".."
       * y barras invertidas pasaba el control y se concatenaba crudo en la
       * ruta del módulo. Con eso se podía cargar y
       * EJECUTAR cualquier .ts del disco, dentro o fuera del proyecto, en
       * un proceso donde process.env ya tiene las claves de IA. Y el server
       * de desarrollo escucha en toda la red (host: true): en el predio de
       * la feria, cualquiera en el mismo wifi.
       *
       * Con lista blanca no hay cadena que inventar: o el nombre es uno de
       * los archivos que existen, o es 404. De paso arregla dos
       * divergencias con Vercel: la comparación es sensible a mayúsculas
       * como en Linux, y un endpoint inexistente da 404 en vez de un 500
       * con rutas internas del proyecto en el cuerpo.
       */
      const endpoints = new Set(
        readdirSync(resolve(server.config.root, 'api'))
          .filter((f) => /^[A-Za-z0-9-]+\.ts$/.test(f))
          .map((f) => f.replace(/\.ts$/, '')),
      )

      const raizApi = resolve(server.config.root, 'api')

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        const ruta = url.split('?')[0].replace(/\/+$/, '')
        const nombre = ruta.slice('/api/'.length)

        // Sólo los endpoints que existen, con el nombre exacto. Los
        // ayudantes de api/_lib no entran: no empiezan con guion bajo por
        // casualidad, es la convención que Vercel también respeta.
        const destino = resolve(raizApi, `${nombre}.ts`)
        if (!endpoints.has(nombre) || !destino.startsWith(raizApi + sep)) {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        try {
          const modulo = await server.ssrLoadModule(`/api/${nombre}.ts`)
          const handler = modulo.default

          if (typeof handler !== 'function') {
            res.statusCode = 500
            res.end(`api/${nombre}.ts no exporta un handler por defecto`)
            return
          }

          await handler(await adaptarPedido(req, url), adaptarRespuesta(res))
        } catch (error) {
          // El stack completo va a la terminal de Vite, donde alguien lo va
          // a leer. Al navegador sólo el mensaje.
          server.config.logger.error(`[api] ${nombre} falló:`)
          console.error(error)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: (error as Error)?.message ?? 'Error en la función' }))
          } else {
            res.end()
          }
        }
      })
    },
  }
}

/**
 * Carga el .env entero en process.env.
 *
 * Vite sólo expone al navegador lo que empieza con VITE_, y está bien: las
 * claves de IA no deben llegar ahí. Pero las funciones de /api corren en
 * Node y sí las necesitan, así que se leen acá, del lado del servidor,
 * exactamente como pasaría en Vercel.
 */
function cargarEntorno(): void {
  for (const archivo of ['.env.local', '.env']) {
    let contenido: string
    try {
      contenido = readFileSync(resolve(process.cwd(), archivo), 'utf8')
    } catch {
      continue
    }

    for (const linea of contenido.split('\n')) {
      const limpia = linea.trim()
      if (!limpia || limpia.startsWith('#')) continue

      const corte = limpia.indexOf('=')
      if (corte < 0) continue

      const clave = limpia.slice(0, corte).trim()
      // El primero que aparece gana, como en Vercel: .env.local pisa a .env.
      if (clave in process.env) continue

      process.env[clave] = limpia
        .slice(corte + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  }
}

/** Agrega a la petición de Node lo que espera un handler de Vercel. */
async function adaptarPedido(req: IncomingMessage, url: string) {
  const query: Record<string, string> = {}
  const interrogante = url.indexOf('?')
  if (interrogante >= 0) {
    for (const [k, v] of new URLSearchParams(url.slice(interrogante + 1))) query[k] = v
  }

  /*
   * Vercel siempre inyecta x-forwarded-for. Acá no existe, así que ipDe()
   * devolvía la misma cadena para todo el mundo y el limitador quedaba con
   * un único cupo global: con cuatro o cinco celulares probando por el QR,
   * a las 20 revisiones del minuto la clasificación se degradaba y ninguna
   * crítica caía más. Se escribe siempre, no sólo si falta: en desarrollo
   * el pedido llega directo del navegador y cualquiera podría elegirse el
   * cubo mandándose su propia cabecera.
   */
  req.headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1'

  const crudo = await leerCuerpo(req)
  let body: unknown = crudo

  const tipo = req.headers['content-type'] ?? ''
  if (crudo && tipo.includes('application/json')) {
    try {
      body = JSON.parse(crudo)
    } catch {
      body = crudo
    }
  }

  return Object.assign(req, { query, body, cookies: {} })
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((listo, falla) => {
    let datos = ''
    req.on('data', (trozo) => {
      datos += trozo
    })
    req.on('end', () => listo(datos))
    req.on('error', falla)
  })
}

/** Agrega a la respuesta de Node los métodos encadenables de Vercel. */
function adaptarRespuesta(res: ServerResponse) {
  const extendida = res as ServerResponse & {
    status: (codigo: number) => typeof extendida
    json: (cuerpo: unknown) => typeof extendida
    send: (cuerpo: unknown) => typeof extendida
  }

  extendida.status = (codigo: number) => {
    res.statusCode = codigo
    return extendida
  }

  extendida.json = (cuerpo: unknown) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(cuerpo))
    return extendida
  }

  extendida.send = (cuerpo: unknown) => {
    if (typeof cuerpo === 'object' && cuerpo !== null) return extendida.json(cuerpo)
    res.end(String(cuerpo ?? ''))
    return extendida
  }

  return extendida
}
