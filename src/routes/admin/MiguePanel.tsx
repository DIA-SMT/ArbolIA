import { useEffect, useRef, useState } from 'react'
import { preguntarAMigue, type MensajeMigue } from '../../lib/ia'
import { supabase } from '../../lib/supabase'
import { armarContextoMigue } from '../../lib/contextoMigue'
import TextoMigue from './TextoMigue'
import InformePDF from './InformePDF'
import { abrirInforme } from './exportarInforme'
import type { TimelinePoint } from '../../lib/api'
import type { Idea, Stats } from '../../lib/types'

/**
 * Migue — el asistente del panel.
 *
 * Lee las propuestas recibidas y ayuda al equipo a entender qué está
 * pidiendo la gente: qué se repite, qué pide cada generación, qué se puede
 * llevar al informe posterior.
 */

const SUGERENCIAS = [
  '¿Cuáles son los tres temas que más se repiten?',
  '¿Qué pide cada rango de edad?',
  'Armá un resumen para el informe de la gestión',
  'Proponé cinco acciones concretas a partir de lo que llegó',
]

interface Props {
  ideas: Idea[]
  stats: Stats
  /** Para el informe: la serie y el rango que el panel tiene a la vista. */
  timeline: TimelinePoint[]
  horas: number
}

export default function MiguePanel({ ideas, stats, timeline, horas }: Props) {
  const [mensajes, setMensajes] = useState<MensajeMigue[]>([])
  const [entrada, setEntrada] = useState('')
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hiloRef = useRef<HTMLDivElement>(null)
  const cancelarRef = useRef<AbortController | null>(null)

  /** La última respuesta de Migue: es lo que se exporta como informe. */
  const ultimaDeMigue = [...mensajes].reverse().find(
    (m) => m.role === 'assistant' && m.content.trim().length > 0,
  )?.content

  /** El informe armado en el DOM, oculto. De acá lo toma la exportación. */
  const informeRef = useRef<HTMLDivElement>(null)

  /*
   * Exportar abre el informe en una pestaña aparte para verlo, y desde ahí se
   * guarda como PDF. Ver la nota larga en exportarInforme.ts.
   */
  function exportar() {
    if (!abrirInforme(informeRef.current)) {
      setError(
        'El navegador bloqueó la ventana del informe. Permitile abrir ventanas ' +
          'a este sitio y volvé a intentar.',
      )
    }
  }

  // Se sigue la conversación desde abajo, como cualquier chat.
  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes])

  // Si el equipo cierra el panel a mitad de una respuesta, se corta el
  // pedido en vez de dejarlo consumiendo tokens contra un componente muerto.
  useEffect(() => () => cancelarRef.current?.abort(), [])

  async function enviar(pregunta: string) {
    const texto = pregunta.trim()
    if (!texto || pensando) return

    setError(null)
    setEntrada('')

    const historia: MensajeMigue[] = [...mensajes, { role: 'user', content: texto }]
    // El turno del asistente se agrega vacío y se va llenando con el stream.
    setMensajes([...historia, { role: 'assistant', content: '' }])
    setPensando(true)

    const corte = new AbortController()
    cancelarRef.current = corte

    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
      const token = data.session?.access_token
      if (!token) throw new Error('Se cerró tu sesión. Volvé a entrar al panel.')

      await preguntarAMigue({
        mensajes: historia,
        contexto: armarContextoMigue(ideas, stats),
        token,
        signal: corte.signal,
        onTexto: (fragmento) => {
          setMensajes((prev) => {
            const copia = [...prev]
            const ultimo = copia[copia.length - 1]
            if (ultimo?.role === 'assistant') {
              copia[copia.length - 1] = { ...ultimo, content: ultimo.content + fragmento }
            }
            return copia
          })
        },
      })
    } catch (e) {
      if (corte.signal.aborted) return
      setError(e instanceof Error ? e.message : 'No pudimos consultar a Migue.')
      // Se descarta el turno vacío: una burbuja en blanco parece un error
      // del panel y no dice nada.
      setMensajes((prev) => {
        const ultimo = prev[prev.length - 1]
        return ultimo?.role === 'assistant' && !ultimo.content ? prev.slice(0, -1) : prev
      })
    } finally {
      setPensando(false)
      cancelarRef.current = null
    }
  }

  return (
    <section className="migue">
      <header className="migue__head">
        {/*
          El retrato va junto al nombre, no arriba ni de fondo.

          Migue es un asistente al que se le pregunta, así que conviene que
          tenga cara: leer "Migue" a secas obliga a recordar qué es esto cada
          vez que se entra al panel. Pero es una herramienta de trabajo, no un
          personaje: por eso va del tamaño de un avatar y no ocupando media
          columna.

          El onError es a propósito. Si el archivo falta, el elemento se retira
          y la cabecera queda como antes, en vez de mostrar el ícono de imagen
          rota justo arriba del panel que el equipo usa para trabajar.
        */}
        <div className="migue__ident">
          <span className="migue__avatar" aria-hidden>
            <img
              src="/marca/migue.jpg"
              alt=""
              loading="lazy"
              onError={(e) => {
                const cont = e.currentTarget.parentElement
                if (cont) cont.style.display = 'none'
              }}
            />
          </span>
          <div>
            <h2 className="migue__title">
              <span className="migue__dot" aria-hidden />
              Migue
            </h2>
            <p className="migue__sub">
              Analiza las {ideas.length} propuestas cargadas en el panel
            </p>
          </div>
        </div>
        {ultimaDeMigue && (
          <div className="migue__acciones">
            {/*
              Exporta la ÚLTIMA respuesta, no toda la conversación.
              Un informe no es un chat: si se volcara el ida y vuelta entero,
              el PDF empezaría con "¿cuáles son los tres temas que más se
              repiten?" y eso no se le presenta a nadie. El equipo pregunta
              hasta que Migue da la respuesta que sirve, y esa es la que
              exporta.
            */}
            <button
              className="btn btn--ok"
              onClick={exportar}
              disabled={pensando}
              title="Abre el informe institucional en una pestaña para revisarlo y guardarlo como PDF"
            >
              Exportar PDF
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                cancelarRef.current?.abort()
                setMensajes([])
                setError(null)
              }}
            >
              Limpiar
            </button>
          </div>
        )}
      </header>

      <div className="migue__hilo" ref={hiloRef}>
        {mensajes.length === 0 ? (
          <div className="migue__vacio">
            <p>Preguntale sobre lo que dejaron los vecinos.</p>
            <div className="migue__sugs">
              {SUGERENCIAS.map((s) => (
                <button key={s} className="migue__sug" onClick={() => void enviar(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          mensajes.map((m, i) => (
            <div key={i} className={`burbuja burbuja--${m.role}`}>
              {/*
                Sólo se interpreta el formato de Migue. Lo que escribió la
                persona se muestra tal cual: si alguien tipea asteriscos, los
                puso a propósito y no hay por qué convertirlos en negrita.
              */}
              {m.content ? (
                m.role === 'assistant' ? (
                  <TextoMigue texto={m.content} />
                ) : (
                  m.content
                )
              ) : (
                <span className="burbuja__puntos" aria-label="Pensando" />
              )}
            </div>
          ))
        )}
      </div>

      {error && <p className="migue__error">{error}</p>}

      <form
        className="migue__form"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(entrada)
        }}
      >
        <input
          className="migue__input"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder="Preguntale a Migue…"
          disabled={pensando}
        />
        <button className="btn btn--ok" type="submit" disabled={pensando || !entrada.trim()}>
          {pensando ? 'Pensando…' : 'Enviar'}
        </button>
      </form>

      {/*
        El informe vive en el DOM pero no se ve: informe.css lo muestra
        únicamente dentro de @media print. Montarlo sólo al apretar el botón
        obligaría a esperar un ciclo de React antes de imprimir, y ahí el
        diálogo se abre con la página a medio armar.
      */}
      {ultimaDeMigue && (
        <div className="informe-raiz" ref={informeRef}>
          <InformePDF
            texto={ultimaDeMigue}
            stats={stats}
            timeline={timeline}
            horas={horas}
          />
        </div>
      )}
    </section>
  )
}
