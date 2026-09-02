import { useEffect, useState } from 'react'
import AnimatedNumber from '../../../components/AnimatedNumber'
import CelebrationOverlay from './CelebrationOverlay'
import QRPanel from './QRPanel'
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
  /** Ideas esperando su viaje al árbol. Ver la nota en el bloque hero. */
  enCamino: number
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
  enCamino,
}: Props) {
  const phrase = useRotating(PHRASES, 9000)
  const progress = getGoalProgress(stats.ideas, goal)

  return (
    <div className="overlay">
      {/* ---------- Barra institucional ---------- */}
      <header className="overlay__top">
        {/*
          El logo va como caja enmascarada y no como <img>: es monocromo y
          tiene que salir blanco sobre el LED y en tinta sobre papel, y del
          logo completo sólo existe el archivo blanco. El detalle está en
          .overlay__logo. El role/aria-label sostienen lo que daba el alt.
        */}
        <span
          className="overlay__logo"
          role="img"
          aria-label="Municipalidad de San Miguel de Tucumán"
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

        {/*
          Las cifras van agrupadas, y no es decorativo.

          En el LED VERTICAL del stand la columna izquierda tiene que dejar de
          ser una columna alta: la pregunta se va arriba del árbol y las
          cifras quedan en una franja abajo. Para poder mandarlas a dos zonas
          distintas del grid hacen falta dos cajas, y sin este contenedor los
          cuatro bloques se ubicarían de a uno por auto-placement, que es
          justamente lo que llenaría la franja del árbol. Ver overlay.css.
        */}
        <div className="overlay__cifras">
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
          {/*
            Las que todavía no llegaron al árbol.

            El número grande YA las cuenta: el contador es optimista y suma en
            cuanto la idea entra a la cola, para que el vecino que acaba de
            enviar vea moverse la cifra. Pero su hoja tarda unos segundos más
            en brotar, y con mucho tránsito la cola planta el excedente sin
            animarlo. Sin este aviso, esa diferencia entre el número y lo que
            se ve en la copa no tiene explicación para nadie.
          */}
          {enCamino > 0 && (
            <p className="panel__camino">
              <span className="panel__camino-punto" aria-hidden />
              {enCamino === 1 ? "1 en camino" : enCamino + " en camino"}
            </p>
          )}
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
        </div>
      </aside>

      {/* ---------- Columna derecha: QR + últimas ideas ---------- */}
      <aside className="overlay__right">
        {/*
          El QR ocupa el lugar que tenía el ranking por área.

          El ranking era lindo y no servía para nada en el stand: nadie mira
          una pantalla para enterarse de que Espacios Públicos va 5 a 2. La
          información de las áreas ya está en el árbol, que es lo que la gente
          mira — cada rama tiene su color y su masa de follaje.

          En cambio, sin QR visible no hay forma de participar. Es la única
          cosa de esta pantalla que el vecino NECESITA, y estaba faltando.
        */}
        <QRPanel />

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


function colorFor(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.color ?? '#22d3ee'
}
