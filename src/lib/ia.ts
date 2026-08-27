import type { TipoIdea } from './types'

/**
 * Cliente de las funciones de IA que corren en el servidor.
 *
 * Acá no hay ninguna clave. Las funciones viven en /api y la clave de
 * Anthropic sólo existe en el entorno de Vercel: cualquier cosa que Vite
 * empaquete termina descargándose al celular de cada visitante.
 */

export interface Veredicto {
  publicar: boolean
  motivo: string
  /**
   * Qué gesto es. 'propuesta' brota como hoja en su rama; 'critica' cae
   * desde la copa y extiende las raíces. No decide si se publica: las dos
   * se publican, y sólo cambia dónde aparecen en el árbol.
   */
  tipo: TipoIdea
  /** true si no hubo revisión real (sin configurar, sin red, o demorada). */
  degradado?: boolean
}

/*
 * Sin revisión, todo es propuesta.
 *
 * Es el degradado seguro: la idea brota como hoja, que es como se comportaba
 * la instalación antes de que existiera esta distinción. Si el degradado
 * fuera 'critica', un corte de red dejaría la copa vacía y las raíces
 * creciendo solas — se vería rota delante del público.
 */
const SIN_REVISION: Veredicto = { publicar: true, motivo: '', tipo: 'propuesta', degradado: true }

/**
 * Revisión semántica previa al envío.
 *
 * Falla abierta a propósito. Si la función no responde —la red del predio,
 * un límite de tasa, un despliegue a medias— la propuesta sigue viaje y la
 * decide el filtro de palabras del servidor, que no depende de nadie. La
 * alternativa sería dejar al vecino sin participar por un problema que no
 * es suyo.
 */
export async function revisarPropuesta(
  texto: string,
  nombre?: string | null,
): Promise<Veredicto> {
  // Alguien de pie en el stand no espera más que esto. Pasado el corte,
  // decide el filtro determinista.
  const corte = new AbortController()
  const reloj = window.setTimeout(() => corte.abort(), 6000)

  try {
    const res = await fetch('/api/moderar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, nombre: nombre || undefined }),
      signal: corte.signal,
    })

    if (!res.ok) return SIN_REVISION

    const datos = (await res.json()) as Partial<Veredicto>
    return {
      publicar: datos.publicar !== false,
      motivo: typeof datos.motivo === 'string' ? datos.motivo : '',
      tipo: datos.tipo === 'critica' ? 'critica' : 'propuesta',
      degradado: datos.degradado === true,
    }
  } catch {
    return SIN_REVISION
  } finally {
    window.clearTimeout(reloj)
  }
}

/* ------------------------------------------------------------------ */
/*  Migue — asistente del panel                                        */
/* ------------------------------------------------------------------ */

export interface MensajeMigue {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Consulta a Migue en streaming.
 *
 * Un análisis sobre cientos de propuestas tarda; ver el texto aparecer es la
 * diferencia entre "está pensando" y "se colgó". `onTexto` se llama con cada
 * fragmento a medida que llega.
 */
export async function preguntarAMigue(opciones: {
  mensajes: MensajeMigue[]
  contexto?: string
  token: string
  signal?: AbortSignal
  onTexto: (fragmento: string) => void
}): Promise<void> {
  const res = await fetch('/api/migue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opciones.token}`,
    },
    body: JSON.stringify({ mensajes: opciones.mensajes, contexto: opciones.contexto }),
    signal: opciones.signal,
  })

  if (!res.ok || !res.body) {
    const detalle = await res.json().catch(() => null)
    throw new Error(
      (detalle as { error?: string } | null)?.error ?? 'No pudimos consultar a Migue.',
    )
  }

  const lector = res.body.getReader()
  const decoder = new TextDecoder()
  let resto = ''

  while (true) {
    const { done, value } = await lector.read()
    if (done) break

    resto += decoder.decode(value, { stream: true })

    // Un fragmento de red puede cortar un evento por la mitad: se procesan
    // los completos y lo que sobra espera al próximo trozo.
    const eventos = resto.split('\n\n')
    resto = eventos.pop() ?? ''

    for (const evento of eventos) {
      const linea = evento.trim()
      if (!linea.startsWith('data:')) continue

      const carga = linea.slice(5).trim()
      if (carga === '[DONE]') return

      try {
        const dato = JSON.parse(carga) as { texto?: string; error?: string }
        if (dato.error) throw new Error(dato.error)
        if (dato.texto) opciones.onTexto(dato.texto)
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
      }
    }
  }
}
