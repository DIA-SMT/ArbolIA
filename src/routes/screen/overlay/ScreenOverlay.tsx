import { useEffect, useState } from 'react'
import AnimatedNumber from '../../../components/AnimatedNumber'
import CelebrationOverlay from './CelebrationOverlay'
import { getGoalProgress } from '../../../lib/growth'
import { CATEGORIES } from '../../../lib/categories'
import type { ConnectionStatus } from '../../../hooks/useLiveTree'
import type { GrowthProfile, Idea, Stats } from '../../../lib/types'
import './overlay.css'

interface Props {
  stats: Stats
  growth: GrowthProfile
  goal: number
  celebration: number | null
  onDismissCelebration: () => void
  status: ConnectionStatus
  recentIdeas: Idea[]
  /** Silencio de emergencia activo: se avisa al operador. */
  silenciado: boolean
}

const PHRASES = [
  'La ciudad está creciendo gracias a vos.',
  'Cada idea hace crecer nuestra ciudad.',
  'Una ciudad también se construye escuchando.',
  'Tu idea ya forma parte del árbol.',
  'Lo que imaginás hoy, la ciudad lo escucha.',
]

export default function ScreenOverlay({
  stats,
  growth,
  goal,
  celebration,
  onDismissCelebration,
  status,
  recentIdeas,
  silenciado,
}: Props) {
  const phrase = useRotating(PHRASES, 9000)
  const progress = getGoalProgress(stats.ideas, goal)

  return (
    <div className="overlay">
      {/* ---------- Barra institucional ---------- */}
      <header className="overlay__top">
        <img
          className="overlay__logo"
          src="/marca/logo-smt-blanco.png"
          alt="Municipalidad de San Miguel de Tucumán"
        />

        <div className="overlay__event">
          <span className="overlay__rule" />
          <span className="overlay__event-name">ExpoCom 2026</span>
          <span className="overlay__rule" />
        </div>

        {/*
          El logo de la Dirección de IA va sobre pastilla clara, igual que en
          las piezas impresas: está pensado para fondo blanco y sobre el
          negro de la instalación se perdería.
        */}
        <div className="overlay__ia">
          <img src="/marca/logo-ia.png" alt="Dirección de Inteligencia Artificial" />
        </div>
      </header>

      {/* ---------- Columna izquierda: pregunta y participación ---------- */}
      <aside className="overlay__left">
        {/*
          La pregunta se corrió del centro a la columna. Centrada arriba, la
          copa del árbol le llegaba encima; acá manda igual por tamaño y deja
          el centro entero libre para la instalación.
        */}
        <div className="ask">
          <h1 className="ask__title">
            ¿Qué harías para mejorar <span>San Miguel de Tucumán</span>?
          </h1>
          <p className="ask__phrase" key={phrase}>
            {phrase}
          </p>
        </div>

        <div className="panel">
          <p className="panel__label">Ciudadanos participando</p>
          <p className="panel__value">
            <AnimatedNumber value={stats.participants} />
          </p>
        </div>

        <div className="panel panel--hero">
          <p className="panel__label">Ideas recibidas</p>
          <p className="panel__value panel__value--hero">
            <AnimatedNumber value={stats.ideas} />
          </p>
        </div>

        <div className="panel">
          <p className="panel__label">Áreas de la ciudad</p>
          <p className="panel__value">
            <AnimatedNumber value={stats.areas} />
          </p>
        </div>

        {/* ---------- Meta ---------- */}
        <div className="goal">
          <div className="goal__head">
            <span className="goal__title">Meta ExpoCom 2026</span>
            <span className="goal__stage">{growth.label}</span>
          </div>

          <p className="goal__count">
            <AnimatedNumber value={stats.ideas} className="goal__now" />
            <span className="goal__of"> / {goal.toLocaleString('es-AR')} ideas</span>
          </p>

          <div className="goal__track">
            <div
              className="goal__fill"
              style={{ width: `${Math.max(1.5, progress * 100)}%` }}
            >
              <span className="goal__spark" />
            </div>
          </div>

          <p className="goal__pct">{Math.round(progress * 100)}% del objetivo</p>
        </div>
      </aside>

      {/* ---------- Columna derecha: áreas + últimas ideas ---------- */}
      <aside className="overlay__right">
        <div className="areas">
          <p className="areas__title">Participación por área</p>
          <ul className="areas__list">
            {rankCategories(stats).map((cat) => (
              <li key={cat.slug} className="areas__item">
                <span className="areas__emoji">{cat.emoji}</span>
                <span className="areas__label">{cat.label}</span>
                <span className="areas__bar">
                  <span
                    className="areas__bar-fill"
                    style={{
                      width: `${cat.share * 100}%`,
                      background: `linear-gradient(90deg, ${cat.color}22, ${cat.color})`,
                    }}
                  />
                </span>
                <span className="areas__total">{cat.total}</span>
              </li>
            ))}
          </ul>
        </div>

        {recentIdeas.length > 0 && (
          <div className="recent">
            <p className="recent__title">Últimas ideas</p>
            <ul className="recent__list">
              {recentIdeas.map((idea) => (
                <li key={idea.id} className="recent__item">
                  <span
                    className="recent__dot"
                    style={{ background: colorFor(idea.category) }}
                  />
                  <span className="recent__text">{idea.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/*
        El QR va cuando la app esté publicada y tenga URL real.
        El componente queda listo en ./QRPanel: para reponerlo alcanza con
        volver a montar <QRPanel /> acá y reactivar la fila 'bottom' y la
        banda inferior del encuadre de cámara (ver TreeScene).
      */}

      {/*
        La burbuja central se retiro: mostraba una idea por vez y tapaba el
        arbol justo en el momento en que habia algo para mirar. Ahora las
        ideas van en etiquetas ancladas a su hoja (ver FloatingLabels).
      */}

      <CelebrationOverlay milestone={celebration} goal={goal} onDismiss={onDismissCelebration} />

      {/*
        Aviso del silencio. Discreto pero presente: sin esto el operador no
        tiene forma de saber si lo dejó puesto, y la pantalla se quedaría
        sin mostrar ideas el resto de la jornada.
      */}
      {silenciado && (
        <div className="status status--silencio">
          <span className="status__dot" />
          Texto silenciado · Ctrl+H para reanudar
        </div>
      )}

      {status !== 'live' && !silenciado && (
        <div className={`status status--${status}`}>
          <span className="status__dot" />
          {status === 'connecting' && 'Conectando'}
          {status === 'reconnecting' && 'Reconectando'}
          {status === 'demo' && 'Modo demostración'}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------

function useRotating<T>(items: T[], intervalMs: number): T {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      intervalMs,
    )
    return () => window.clearInterval(timer)
  }, [items.length, intervalMs])

  return items[index]
}

interface RankedCategory {
  slug: string
  label: string
  emoji: string
  color: string
  total: number
  share: number
}

/** Áreas ordenadas por participación, con la barra normalizada al líder. */
function rankCategories(stats: Stats): RankedCategory[] {
  const source =
    stats.byCategory.length > 0
      ? stats.byCategory
      : CATEGORIES.map((c) => ({
          slug: c.slug,
          label: c.label,
          emoji: c.emoji,
          color: c.color,
          total: 0,
        }))

  const max = Math.max(1, ...source.map((c) => c.total))

  return [...source]
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c, share: c.total / max }))
}

function colorFor(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.color ?? '#22d3ee'
}
