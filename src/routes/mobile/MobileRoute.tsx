import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, DEFAULT_CATEGORY } from '../../lib/categories'
import { DEMO_MODE, IDEA_MAX_LENGTH, IS_SUPABASE_CONFIGURED } from '../../lib/config'
import { checkIdeaText } from '../../lib/moderation'
import { getDeviceId, rememberSentIdea } from '../../lib/device'
import { fetchStats, submitIdea, SubmitError } from '../../lib/api'
import type { CategorySlug } from '../../lib/types'
import './mobile.css'

type Phase = 'form' | 'sending' | 'done' | 'review'

/**
 * Web móvil: lo que abre el vecino al escanear el QR.
 *
 * Sin framer-motion a propósito. Las transiciones van en CSS por dos
 * razones concretas de instalación: son 40 kB gzip menos para alguien que
 * entra con datos móviles en un pabellón saturado, y no dependen del
 * requestAnimationFrame del navegador, así que la confirmación no puede
 * quedar trabada si el celular se bloquea a mitad del envío.
 */
export default function MobileRoute() {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<CategorySlug>(DEFAULT_CATEGORY)
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<number | null>(null)

  const deviceId = useMemo(() => getDeviceId(), [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const chosen = CATEGORIES.find((c) => c.slug === category) ?? CATEGORIES[7]
  const remaining = IDEA_MAX_LENGTH - text.length
  const isForm = phase === 'form' || phase === 'sending'
  const canSend = text.trim().length >= 3 && phase === 'form'

  useEffect(() => {
    document.body.dataset.route = 'mobile'
    return () => {
      delete document.body.dataset.route
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSend) return

    // Filtro local: le damos la chance de corregir, en vez de aceptar en
    // silencio algo que después no va a aparecer en la pantalla.
    const verdict = checkIdeaText(text)
    if (!verdict.ok) {
      setError(verdict.reason ?? 'Revisá el texto de tu idea.')
      textareaRef.current?.focus()
      return
    }

    setError(null)
    setPhase('sending')

    if (!IS_SUPABASE_CONFIGURED) {
      if (!DEMO_MODE) {
        // Sin backend en producción: decirlo. Confirmar un envío que no
        // ocurrió es peor que el error — la persona se va creyendo que su
        // idea está en el árbol y después no la encuentra.
        setError('El sistema no está disponible en este momento. Avisale al equipo del stand.')
        setPhase('form')
        return
      }

      // Modo demo (sólo en desarrollo): se recorre la experiencia completa.
      window.setTimeout(() => {
        setPosition(null)
        setPhase('done')
      }, 900)
      return
    }

    try {
      const idea = await submitIdea({ text, category, deviceId })
      rememberSentIdea(idea.id)

      if (idea.status !== 'visible') {
        // El filtro del servidor la marcó para revisión. No le decimos que
        // ya está en el árbol, porque no lo está.
        setPhase('review')
        return
      }

      // El número de orden es el cierre emocional: "sos la idea 185".
      try {
        const stats = await fetchStats()
        setPosition(stats.ideas)
      } catch {
        setPosition(null)
      }

      setPhase('done')
    } catch (err) {
      const message =
        err instanceof SubmitError
          ? err.message
          : 'No pudimos enviar tu idea. Probá de nuevo en un momento.'
      setError(message)
      setPhase('form')
    }
  }

  function reset() {
    setText('')
    setCategory(DEFAULT_CATEGORY)
    setError(null)
    setPosition(null)
    setPhase('form')
  }

  return (
    <div className="mob" style={{ ['--pick' as string]: chosen.color }}>
      <div className="mob__glow" aria-hidden />

      <header className="mob__head">
        <p className="mob__brand">
          <span className="mob__brand-dot" />
          San Miguel de Tucumán
        </p>
        <p className="mob__kicker">Árbol Virtual de Ideas</p>
      </header>

      {/*
        Las tres fases comparten celda de grilla y se cruzan por opacidad.
        La que no está activa queda con visibility:hidden, así no recibe
        foco ni toques mientras se desvanece.
      */}
      <div className="mob__stage">
        {/* -------------------------------------------------- Formulario */}
        <main className="panel" data-active={isForm}>
          <h1 className="mob__title">
            ¿Qué harías para mejorar <span>Tucumán</span>?
          </h1>

          <form onSubmit={handleSubmit} className="mob__form">
            <div className="field">
              <textarea
                ref={textareaRef}
                className="field__input"
                value={text}
                onChange={(e) => {
                  setText(e.target.value.slice(0, IDEA_MAX_LENGTH))
                  if (error) setError(null)
                }}
                placeholder="Escribí tu idea…"
                rows={4}
                maxLength={IDEA_MAX_LENGTH}
                autoComplete="off"
                disabled={phase === 'sending'}
              />
              <span className={`field__count ${remaining < 25 ? 'field__count--low' : ''}`}>
                {remaining}
              </span>
            </div>

            {error && (
              <p className="mob__error" role="alert">
                {error}
              </p>
            )}

            <div className="cats">
              <p className="cats__label">
                Área <span>(opcional)</span>
              </p>
              <div className="cats__grid">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.slug}
                    type="button"
                    className={`chip ${category === cat.slug ? 'chip--on' : ''}`}
                    style={{ ['--chip' as string]: cat.color }}
                    onClick={() => setCategory(cat.slug)}
                    disabled={phase === 'sending'}
                  >
                    <span className="chip__emoji">{cat.emoji}</span>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" className="send" disabled={!canSend}>
              {phase === 'sending' ? (
                <>
                  <span className="send__spin" />
                  Enviando…
                </>
              ) : (
                'ENVIAR'
              )}
            </button>

            <p className="mob__privacy">
              No pedimos tu nombre, tu mail ni tu teléfono. Tu idea es anónima.
            </p>
          </form>
        </main>

        {/* ------------------------------------------------ Confirmación */}
        <main className="panel panel--center" data-active={phase === 'done'}>
          <LeafMark color={chosen.color} />

          <h2 className="done__title">¡Tu idea ya es parte del árbol!</h2>

          {position !== null && (
            <p className="done__position">
              Sos la idea número <strong>{position.toLocaleString('es-AR')}</strong>
            </p>
          )}

          <p className="done__hint">Mirá la pantalla: tu hoja está brotando ahora.</p>

          <div className="done__tag" style={{ ['--chip' as string]: chosen.color }}>
            <span>{chosen.emoji}</span>
            {chosen.label}
          </div>

          <button type="button" className="again" onClick={reset}>
            Dejar otra idea
          </button>
        </main>

        {/* ------------------------------------- Pendiente de revisión */}
        <main className="panel panel--center" data-active={phase === 'review'}>
          <div className="review__mark">⏳</div>
          <h2 className="done__title">Recibimos tu idea</h2>
          <p className="done__hint">
            La estamos revisando antes de publicarla en la pantalla. Gracias por
            participar.
          </p>
          <button type="button" className="again" onClick={reset}>
            Escribir otra idea
          </button>
        </main>
      </div>
    </div>
  )
}

/** Hoja que brota al confirmar: el pago emocional del recorrido. */
function LeafMark({ color }: { color: string }) {
  return (
    <svg className="leafmark" viewBox="0 0 120 120" aria-hidden>
      <defs>
        <radialGradient id="lm" cx="50%" cy="42%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="60" r="52" fill={color} opacity="0.09" />
      <circle cx="60" cy="60" r="38" fill={color} opacity="0.12" />

      <path d="M60 16 C90 38, 88 82, 60 106 C32 82, 30 38, 60 16 Z" fill="url(#lm)" />
      <path
        d="M60 22 L60 100"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
