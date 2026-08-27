import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        const ruta = url.split('?')[0].replace(/\/+$/, '')
        const nombre = ruta.slice('/api/'.length)

        // Lo que Vercel ignora, acá tampoco se sirve: los ayudantes de
        // api/_lib no son endpoints.
        if (!nombre || nombre.startsWith('_') || nombre.includes('/')) {
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
