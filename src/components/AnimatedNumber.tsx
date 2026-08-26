import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  className?: string
  /** Duración del conteo, en ms. */
  duration?: number
}

/**
 * Contador que cuenta hacia el nuevo valor y da un destello al subir.
 *
 * El salto 184 → 185 es el momento en que alguien confirma que su idea entró.
 * Tiene que ser imposible de no ver desde varios metros, pero sin sacudir
 * el layout: por eso el destello va en color y escala, no en posición.
 */
export default function AnimatedNumber({ value, className = '', duration = 900 }: Props) {
  const [display, setDisplay] = useState(value)
  const [pulsing, setPulsing] = useState(false)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    // En el primer render mostramos el valor sin animar.
    if (!mountedRef.current) {
      mountedRef.current = true
      fromRef.current = value
      setDisplay(value)
      return
    }

    const from = fromRef.current
    if (from === value) return

    if (value > from) {
      setPulsing(true)
      window.setTimeout(() => setPulsing(false), 780)
    }

    const start = performance.now()
    const delta = value - from

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOutExpo: arranca rápido y frena, se lee el número final enseguida.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setDisplay(Math.round(from + delta * eased))

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }

    rafRef.current = requestAnimationFrame(step)

    /*
     * Red de seguridad.
     *
     * El conteo va por requestAnimationFrame, que el navegador congela
     * cuando la pestaña deja de estar al frente. Si el operador del stand
     * cambia de pestaña justo mientras entran ideas, al volver los números
     * se habrían quedado en el valor viejo hasta el siguiente cambio: la
     * pantalla mostraría menos ideas de las que hay.
     *
     * setTimeout sí corre en segundo plano —lo limita, no lo suspende—, así
     * que garantiza que el número llegue a destino aunque no se haya
     * animado un solo cuadro.
     */
    const seguro = window.setTimeout(() => {
      setDisplay(value)
      fromRef.current = value
    }, duration + 400)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      window.clearTimeout(seguro)
      fromRef.current = value
    }
  }, [value, duration])

  return (
    <span className={`animnum ${pulsing ? 'animnum--pulse' : ''} ${className}`}>
      {display.toLocaleString('es-AR')}
      <style>{`
        .animnum {
          display: inline-block;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
          transition: transform 260ms var(--ease-out), color 260ms ease, text-shadow 260ms ease;
          will-change: transform;
        }
        .animnum--pulse {
          animation: animnum-pop 780ms var(--ease-out);
        }
        @keyframes animnum-pop {
          0%   { transform: scale(1);    color: var(--text-hi);     text-shadow: none; }
          22%  { transform: scale(1.13); color: var(--accent-warm);
                 text-shadow: 0 0 34px rgba(37, 211, 102, 0.85); }
          100% { transform: scale(1);    color: var(--text-hi);     text-shadow: none; }
        }
      `}</style>
    </span>
  )
}
