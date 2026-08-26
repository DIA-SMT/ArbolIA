import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ipDe, permitir } from './_lib/claude'
import { conversar, hayAlgunProveedor, type Mensaje } from './_lib/proveedor'
import { esDelEquipo } from './_lib/sesion'

/**
 * Migue — asistente del panel de la Dirección de IA.
 *
 * Ayuda al equipo municipal a leer lo que la gente propuso: agrupar temas,
 * detectar patrones por edad o por área, redactar el informe posterior y
 * pensar propuestas a partir de lo recibido.
 *
 * Responde en streaming porque un análisis sobre cientos de propuestas tarda,
 * y ver el texto aparecer es la diferencia entre "está pensando" y "se colgó".
 */

const SISTEMA = `Sos Migue, el asistente del equipo de la Dirección de Inteligencia Artificial de la Municipalidad de San Miguel de Tucumán.

Trabajás junto al equipo que opera el Árbol Virtual de Ideas en ExpoCom: una instalación donde los vecinos dejan propuestas para mejorar la ciudad desde el celular y cada idea brota como una hoja en un árbol digital proyectado en el stand.

QUÉ HACÉS
- Leés las propuestas recibidas y ayudás a entender qué está pidiendo la gente.
- Agrupás por tema, detectás lo que se repite y lo que aparece una sola vez pero vale.
- Cruzás con los datos que hay: área de la ciudad, rango etario, momento del día.
- Ayudás a redactar el informe para la gestión.
- Cuando te lo piden, proponés ideas nuevas a partir de lo que ya llegó.

CÓMO HABLÁS
- Español rioplatense, tuteo, tono de colega de trabajo. Sin marketinese ni palabras infladas.
- Directo. Si te preguntan algo concreto, contestá eso.
- Cuando presentes hallazgos, poné primero lo que más importa.

CRITERIO
- No inventes números. Si no tenés el dato en lo que te pasaron, decilo.
- Distinguí lo que dice la muestra de lo que se puede concluir. Cuarenta propuestas de un stand no son una encuesta representativa de la ciudad, y conviene decirlo cuando alguien esté por sacar una conclusión más grande de lo que los datos aguantan.
- Las propuestas traen a veces el rango etario de quien las dejó. Son datos internos: usalos para el análisis agregado, nunca para señalar a una persona.
- Si el equipo te pide algo que no corresponde —publicar datos personales, redactar algo partidario— decilo y ofrecé la alternativa.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  // Migue ve datos internos: sólo el equipo autenticado.
  if (!(await esDelEquipo(req.headers.authorization))) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión en el panel.' })
  }

  if (!hayAlgunProveedor()) {
    return res.status(503).json({
      error:
        'Migue no está configurado. Falta ANTHROPIC_API_KEY u OPENROUTER_API_KEY en el entorno del servidor.',
    })
  }

  if (!permitir(ipDe(req), 30)) {
    return res.status(429).json({ error: 'Demasiadas consultas seguidas. Esperá un momento.' })
  }

  const { mensajes, contexto } = (req.body ?? {}) as {
    mensajes?: Mensaje[]
    contexto?: string
  }

  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    return res.status(400).json({ error: 'Falta la conversación.' })
  }

  // Sólo los últimos intercambios: una conversación larga del día entero no
  // aporta y multiplica el costo de cada respuesta.
  const historia: Mensaje[] = mensajes.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 8000),
  }))

  try {
    await conversar({
      sistema: SISTEMA,
      contexto: contexto?.slice(0, 60_000),
      mensajes: historia,
      // Las cabeceras se escriben recién cuando el proveedor empezó a
      // responder. Hasta ese momento todavía se puede cambiar de proveedor
      // y devolver un código de estado distinto.
      alEmpezar: () => {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
      },
      onTexto: (fragmento) => {
        res.write(`data: ${JSON.stringify({ texto: fragmento })}\n\n`)
      },
    })

    res.write('data: [DONE]\n\n')
    return res.end()
  } catch (error) {
    console.error('[migue] falló la consulta:', error)

    // Si ya se empezó a transmitir no se puede cambiar el código de estado:
    // el error viaja por el mismo canal para que la interfaz pueda mostrarlo.
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: 'Se cortó la respuesta. Probá de nuevo.' })}\n\n`)
      return res.end()
    }
    return res.status(500).json({ error: 'No pudimos consultar a Migue.' })
  }
}
