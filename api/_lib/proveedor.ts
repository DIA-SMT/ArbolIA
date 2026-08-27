import { getClaude, hayClaveAnthropic, MODELO_ANTHROPIC } from './claude'

/**
 * De qué proveedor sale la inteligencia de la instalación.
 *
 * Hay dos caminos y se eligen por variable de entorno, sin tocar código:
 *
 *   · Anthropic directo, con el SDK oficial.
 *   · OpenRouter, que es una pasarela con API compatible con OpenAI y da
 *     acceso a muchos modelos con una sola cuenta.
 *
 * Por qué los dos: el stand funciona ocho horas seguidas, un día fijo, sin
 * posibilidad de reprogramar. Si el proveedor de turno tiene un problema o
 * se acaba el crédito a mitad de la tarde, poder cambiar de camino con una
 * variable de entorno es la diferencia entre un redeploy de dos minutos y
 * quedarse sin revisión semántica hasta que termine la feria.
 *
 * Ninguna clave vive acá ni en src/: sólo en el entorno del servidor.
 */

export type Proveedor = 'anthropic' | 'openrouter'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Modelo por defecto en OpenRouter. Se puede cambiar sin tocar código. */
const OPENROUTER_MODELO_DEFECTO = 'openai/gpt-4o-mini'

export function hayClaveOpenRouter(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/**
 * Qué proveedor se usa, en orden de preferencia.
 *
 * IA_PROVEEDOR acepta 'anthropic', 'openrouter' o 'auto' (por defecto).
 * En 'auto' manda el que tenga clave; si están los dos, arranca por
 * Anthropic y cae a OpenRouter si falla.
 */
export function proveedores(): Proveedor[] {
  const elegido = (process.env.IA_PROVEEDOR ?? 'auto').trim().toLowerCase()

  if (elegido === 'anthropic') return hayClaveAnthropic() ? ['anthropic'] : []
  if (elegido === 'openrouter') return hayClaveOpenRouter() ? ['openrouter'] : []

  const orden: Proveedor[] = []
  if (hayClaveAnthropic()) orden.push('anthropic')
  if (hayClaveOpenRouter()) orden.push('openrouter')
  return orden
}

export function hayAlgunProveedor(): boolean {
  return proveedores().length > 0
}

/* ------------------------------------------------------------------ */
/*  Cabeceras de OpenRouter                                            */
/* ------------------------------------------------------------------ */

function cabecerasOpenRouter(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    // Identifican la aplicación en el panel de OpenRouter. Son opcionales,
    // pero sin esto el consumo del municipio aparece sin nombre.
    'HTTP-Referer': process.env.PUBLIC_URL ?? 'https://arbolia.vercel.app',
    'X-Title': 'Arbol Virtual de Ideas - Municipalidad de San Miguel de Tucuman',
  }
}

function modeloOpenRouter(cual: 'moderacion' | 'migue'): string {
  const especifico =
    cual === 'migue' ? process.env.OPENROUTER_MODELO_MIGUE : process.env.OPENROUTER_MODELO_MODERACION
  return (
    especifico?.trim() ||
    process.env.OPENROUTER_MODELO?.trim() ||
    OPENROUTER_MODELO_DEFECTO
  )
}

/* ------------------------------------------------------------------ */
/*  Clasificación con salida estructurada (moderación)                 */
/* ------------------------------------------------------------------ */

export interface Clasificacion {
  datos: unknown
  proveedor: Proveedor
}

/**
 * Una sola pregunta, respuesta en JSON con la forma del esquema.
 *
 * Lanza si ningún proveedor pudo responder. Quien llama decide qué hacer
 * con eso — en la moderación, dejar pasar la propuesta.
 */
export async function clasificar(opciones: {
  sistema: string
  usuario: string
  esquema: Record<string, unknown>
  nombreEsquema: string
  timeoutMs: number
}): Promise<Clasificacion> {
  const orden = proveedores()
  if (orden.length === 0) throw new Error('No hay ningún proveedor de IA configurado.')

  let ultimo: unknown = null

  for (const proveedor of orden) {
    try {
      const datos =
        proveedor === 'anthropic'
          ? await clasificarAnthropic(opciones)
          : await clasificarOpenRouter(opciones)
      return { datos, proveedor }
    } catch (error) {
      // Se prueba el siguiente. Si era el último, el error sale afuera.
      console.error(`[ia] ${proveedor} no pudo clasificar:`, error)
      ultimo = error
    }
  }

  throw ultimo instanceof Error ? ultimo : new Error('Ningún proveedor pudo clasificar.')
}

async function clasificarAnthropic(o: {
  sistema: string
  usuario: string
  esquema: Record<string, unknown>
  timeoutMs: number
}): Promise<unknown> {
  const claude = await getClaude()
  const respuesta = await claude.messages.create(
    {
      model: MODELO_ANTHROPIC,
      max_tokens: 512,
      system: o.sistema,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: o.esquema },
      },
      messages: [{ role: 'user', content: o.usuario }],
    },
    { timeout: o.timeoutMs },
  )

  const bloque = respuesta.content.find((b) => b.type === 'text')
  return JSON.parse(bloque && 'text' in bloque ? bloque.text : '{}')
}

async function clasificarOpenRouter(o: {
  sistema: string
  usuario: string
  esquema: Record<string, unknown>
  nombreEsquema: string
  timeoutMs: number
}): Promise<unknown> {
  const corte = AbortSignal.timeout(o.timeoutMs)

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: cabecerasOpenRouter(),
    signal: corte,
    body: JSON.stringify({
      model: modeloOpenRouter('moderacion'),
      max_tokens: 512,
      messages: [
        { role: 'system', content: o.sistema },
        { role: 'user', content: o.usuario },
      ],
      // El modo estricto obliga a que la respuesta tenga exactamente la
      // forma del esquema. Requiere additionalProperties:false y que todas
      // las propiedades estén en required — el esquema ya cumple las dos.
      response_format: {
        type: 'json_schema',
        json_schema: { name: o.nombreEsquema, strict: true, schema: o.esquema },
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenRouter respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const cuerpo = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }

  if (cuerpo.error) throw new Error(`OpenRouter: ${cuerpo.error.message ?? 'error sin detalle'}`)

  const texto = cuerpo.choices?.[0]?.message?.content
  if (!texto) throw new Error('OpenRouter devolvió una respuesta vacía.')

  return JSON.parse(texto)
}

/* ------------------------------------------------------------------ */
/*  Conversación en streaming (Migue)                                  */
/* ------------------------------------------------------------------ */

export interface Mensaje {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Conversación en streaming. `onTexto` recibe cada fragmento al llegar.
 *
 * `alEmpezar` se llama una sola vez, justo antes del primer fragmento: es
 * la señal para escribir las cabeceras de la respuesta. Se separa porque
 * hasta ese momento todavía se puede cambiar de proveedor, y una vez
 * escrita la cabecera ya no se puede devolver otro código de estado.
 */
export async function conversar(opciones: {
  sistema: string
  contexto?: string
  mensajes: Mensaje[]
  alEmpezar: () => void
  onTexto: (fragmento: string) => void
}): Promise<Proveedor> {
  const orden = proveedores()
  if (orden.length === 0) throw new Error('No hay ningún proveedor de IA configurado.')

  let ultimo: unknown = null

  for (const proveedor of orden) {
    let empezo = false
    const alEmpezar = () => {
      empezo = true
      opciones.alEmpezar()
    }

    try {
      if (proveedor === 'anthropic') await conversarAnthropic({ ...opciones, alEmpezar })
      else await conversarOpenRouter({ ...opciones, alEmpezar })
      return proveedor
    } catch (error) {
      console.error(`[ia] ${proveedor} no pudo conversar:`, error)
      ultimo = error
      // Si ya salió texto al navegador no se puede reintentar con otro
      // proveedor: la respuesta quedaría con dos mitades de conversaciones
      // distintas pegadas.
      if (empezo) throw error
    }
  }

  throw ultimo instanceof Error ? ultimo : new Error('Ningún proveedor pudo responder.')
}

async function conversarAnthropic(o: {
  sistema: string
  contexto?: string
  mensajes: Mensaje[]
  alEmpezar: () => void
  onTexto: (fragmento: string) => void
}): Promise<void> {
  const claude = await getClaude()
  const stream = claude.messages.stream({
    model: MODELO_ANTHROPIC,
    max_tokens: 8000,
    // El contexto va en un bloque aparte y marcado para caché: es la parte
    // estable del prompt y se reaprovecha entre preguntas sucesivas sobre
    // el mismo conjunto de propuestas.
    system: o.contexto
      ? [
          { type: 'text' as const, text: o.sistema },
          {
            type: 'text' as const,
            text: `\n\nDATOS DE LA INSTALACIÓN EN ESTE MOMENTO:\n${o.contexto}`,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : o.sistema,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    messages: o.mensajes,
  })

  o.alEmpezar()
  stream.on('text', o.onTexto)
  await stream.finalMessage()
}

async function conversarOpenRouter(o: {
  sistema: string
  contexto?: string
  mensajes: Mensaje[]
  alEmpezar: () => void
  onTexto: (fragmento: string) => void
}): Promise<void> {
  const sistema = o.contexto
    ? `${o.sistema}\n\nDATOS DE LA INSTALACIÓN EN ESTE MOMENTO:\n${o.contexto}`
    : o.sistema

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: cabecerasOpenRouter(),
    body: JSON.stringify({
      model: modeloOpenRouter('migue'),
      max_tokens: 8000,
      stream: true,
      messages: [{ role: 'system', content: sistema }, ...o.mensajes],
    }),
  })

  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  o.alEmpezar()

  const lector = res.body.getReader()
  const decoder = new TextDecoder()
  let resto = ''

  while (true) {
    const { done, value } = await lector.read()
    if (done) break

    resto += decoder.decode(value, { stream: true })

    // Un trozo de red puede cortar un evento por la mitad: se procesan los
    // completos y lo que sobra espera al siguiente.
    const partes = resto.split('\n')
    resto = partes.pop() ?? ''

    for (const cruda of partes) {
      const linea = cruda.trim()
      // OpenRouter intercala comentarios de mantenimiento (": OPENROUTER
      // PROCESSING") para que la conexión no se caiga. Se ignoran.
      if (!linea || linea.startsWith(':')) continue
      if (!linea.startsWith('data:')) continue

      const carga = linea.slice(5).trim()
      if (carga === '[DONE]') return

      try {
        const dato = JSON.parse(carga) as {
          choices?: { delta?: { content?: string } }[]
          error?: { message?: string }
        }
        if (dato.error) throw new Error(`OpenRouter: ${dato.error.message ?? 'error en el stream'}`)
        const fragmento = dato.choices?.[0]?.delta?.content
        if (fragmento) o.onTexto(fragmento)
      } catch (e) {
        // Un JSON incompleto se descarta; un error real del proveedor sube.
        if (e instanceof Error && e.message.startsWith('OpenRouter:')) throw e
      }
    }
  }
}
