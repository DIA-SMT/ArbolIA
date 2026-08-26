import { useMemo, useState } from 'react'
import type { CategoryCount } from '../../lib/types'

const SIZE = 200
const R_EXT = 92
const R_INT = 56
/** Separación entre porciones, en grados. */
const GAP = 1.6

interface Props {
  areas: CategoryCount[]
}

/**
 * Participación por área.
 *
 * Es un anillo por pedido explícito. Vale decir qué límite tiene: la forma
 * responde bien "cuánto pesa cada parte del total de un vistazo", pero con
 * ocho porciones comparar dos parecidas a ojo es poco confiable — dos arcos
 * de 12 % y 14 % se ven iguales.
 *
 * Por eso el anillo nunca va solo: al lado está la lista completa con el
 * número exacto y el porcentaje de cada área. El anillo da la proporción, la
 * lista da el dato. Y toda etiqueta lleva emoji y nombre, así que la
 * identidad no depende del color, que con ocho clases es lo que primero se
 * vuelve ambiguo.
 */
export default function AreasDonut({ areas }: Props) {
  const [activo, setActivo] = useState<string | null>(null)

  const { porciones, total } = useMemo(() => {
    const conDatos = areas.filter((a) => a.total > 0)
    const suma = conDatos.reduce((n, a) => n + a.total, 0)

    if (suma === 0) return { porciones: [], total: 0 }

    // De mayor a menor: la lectura arranca por lo que más pesa.
    const ordenadas = [...conDatos].sort((a, b) => b.total - a.total)

    let angulo = -90 // arranca arriba
    const out = ordenadas.map((a) => {
      const fraccion = a.total / suma
      const barrido = fraccion * 360
      const desde = angulo + GAP / 2
      const hasta = angulo + barrido - GAP / 2
      angulo += barrido

      return {
        ...a,
        fraccion,
        pct: Math.round(fraccion * 100),
        d: arco(desde, Math.max(desde + 0.4, hasta)),
      }
    })

    return { porciones: out, total: suma }
  }, [areas])

  if (total === 0) {
    return (
      <div className="donut donut--vacio">
        <p>Todavía no hay ideas para repartir por área.</p>
      </div>
    )
  }

  const marcada = porciones.find((p) => p.slug === activo)

  return (
    <div className="donut">
      <div className="donut__anillo">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
             aria-label="Participación por área de la ciudad">
          {porciones.map((p) => (
            <path
              key={p.slug}
              d={p.d}
              fill={p.color}
              opacity={activo === null || activo === p.slug ? 1 : 0.35}
              onMouseEnter={() => setActivo(p.slug)}
              onMouseLeave={() => setActivo(null)}
              style={{ transition: 'opacity 180ms ease' }}
            />
          ))}

          {/* El centro lleva el dato que el anillo no puede dar de un vistazo. */}
          <text x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle" className="donut__num">
            {marcada ? marcada.total : total}
          </text>
          <text x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle" className="donut__cap">
            {marcada ? `${marcada.pct}%` : 'ideas'}
          </text>
        </svg>
      </div>

      {/*
        La lista no es una leyenda decorativa: es la tabla que la forma
        circular necesita al lado para ser legible con ocho categorías.
      */}
      <ul className="donut__lista">
        {porciones.map((p) => (
          <li
            key={p.slug}
            className={`donut__fila ${activo === p.slug ? 'donut__fila--on' : ''}`}
            onMouseEnter={() => setActivo(p.slug)}
            onMouseLeave={() => setActivo(null)}
          >
            <span className="donut__punto" style={{ background: p.color }} />
            <span className="donut__emoji">{p.emoji}</span>
            <span className="donut__area">{p.label}</span>
            <span className="donut__pct">{p.pct}%</span>
            <span className="donut__total">{p.total}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Path de un sector de anillo entre dos ángulos, en grados. */
function arco(desde: number, hasta: number): string {
  const c = SIZE / 2
  const p = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)]
  }

  const [x1, y1] = p(R_EXT, desde)
  const [x2, y2] = p(R_EXT, hasta)
  const [x3, y3] = p(R_INT, hasta)
  const [x4, y4] = p(R_INT, desde)
  const largo = hasta - desde > 180 ? 1 : 0

  return [
    `M ${x1} ${y1}`,
    `A ${R_EXT} ${R_EXT} 0 ${largo} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${R_INT} ${R_INT} 0 ${largo} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}
