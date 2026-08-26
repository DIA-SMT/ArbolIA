import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  milestone: number | null
  goal: number
  onDismiss: () => void
}

const HOLD_MS = 7000

/**
 * Momento de celebración colectiva al alcanzar un hito.
 *
 * El texto cambia según la magnitud: los hitos intermedios reconocen, el
 * de la meta corona. Se va solo a los 7 segundos, porque en un stand nadie
 * queda disponible para cerrar un cartel a mano.
 */
export default function CelebrationOverlay({ milestone, goal, onDismiss }: Props) {
  useEffect(() => {
    if (milestone === null) return
    const timer = window.setTimeout(onDismiss, HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [milestone, onDismiss])

  const isGoal = milestone !== null && milestone >= goal

  return (
    <AnimatePresence>
      {milestone !== null && (
        <motion.div
          className="celebration"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
        >
          <motion.div
            className={`celebration__card ${isGoal ? 'celebration__card--goal' : ''}`}
            initial={{ scale: 0.86, y: 28, filter: 'blur(10px)' }}
            animate={{ scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ scale: 0.96, y: -14, filter: 'blur(6px)' }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          >
            {isGoal ? (
              <>
                <p className="celebration__eyebrow">Meta ExpoCom 2026 alcanzada</p>
                <h2 className="celebration__headline">
                  ¡{milestone} IDEAS PARA CONSTRUIR EL FUTURO DE TUCUMÁN!
                </h2>
                <p className="celebration__sub">
                  Gracias a cada vecina y cada vecino que dejó su idea.
                </p>
              </>
            ) : (
              <>
                <p className="celebration__eyebrow">Hito alcanzado</p>
                <h2 className="celebration__headline">{milestone} IDEAS</h2>
                <p className="celebration__sub">La ciudad sigue creciendo con vos.</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
