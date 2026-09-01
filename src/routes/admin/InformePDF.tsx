import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import AreasDonut from './AreasDonut'
import TimelineChart from './TimelineChart'
import { BloqueMigue } from './TextoMigue'
import { analizarMarkdown } from '../../lib/formatoMigue'
import {
  bloquesConClave,
  mesYAnio,
  planificarInforme,
  porcentaje,
  type BloquePlan,
  type DatosInforme,
} from '../../lib/informePlan'
import { paginar, type BloqueMedido } from '../../lib/paginarBloques'
import { CATEGORIES } from '../../lib/categories'
import { AGE_RANGES } from '../../lib/types'
import './informe.css'

/**
 * El informe institucional de ExpoCom, repartido en hojas A4 de verdad.
 *
 * QUÉ CAMBIÓ Y POR QUÉ.
 *
 * La versión anterior tenía DOS páginas escritas a mano, con el número de
 * página puesto a dedo —pie(1, 2), pie(2, 2)— y todo el análisis metido en
 * la primera. Como .inf__pagina tenía alto fijo y overflow hidden, cualquier
 * texto que pasara del alto de la hoja desaparecía. El equipo veía el
 * informe cortado y no había forma de saber cuánto faltaba.
 *
 * Ahora el documento se arma así:
 *
 *  1. informePlan.ts decide QUÉ secciones hay, desde los datos de la base.
 *  2. Cada bloque se dibuja una vez en un medidor fuera de pantalla, con el
 *     ancho exacto del papel, y se mide su alto real en milímetros.
 *  3. paginarBloques.ts reparte esos altos en hojas, respetando la capacidad
 *     de la portada (221 mm) y de las interiores (254 mm).
 *  4. Se dibujan las hojas que hicieron falta, con "Página X de Y" contado.
 *
 * Quien mide es el navegador porque es el único que sabe cuánto ocupa un
 * párrafo con esta tipografía y este ancho. Lo que se puede probar sin
 * navegador —qué secciones hay y cómo se reparten los altos— vive en los dos
 * módulos puros, y se prueba en scripts/check-informe.ts.
 */

/*
 * Espacio real de contenido en cada tipo de hoja, en milímetros.
 *
 * Sale de informe.css: la portada gasta 53 mm en la franja y las interiores
 * 20 mm en la banda; las dos gastan 8 mm de padding arriba y 15 mm de pie.
 *   portada:   297 − 53 − 8 − 15 = 221
 *   interior:  297 − 20 − 8 − 15 = 254
 * Si cambian las medidas de la plantilla, cambian estos dos números.
 */
const CAPACIDAD_PORTADA = 221
const CAPACIDAD_INTERIOR = 254

interface Props {
  datos: DatosInforme
  /** Encabezado del documento. */
  titulo?: string
  /**
   * Apunta al elemento .informe, que es lo que se exporta.
   *
   * El medidor queda AFUERA de ese elemento a propósito: si viviera adentro,
   * el documento exportado llevaría cada bloque dos veces.
   */
  refDocumento?: Ref<HTMLDivElement>
}

/** Una pieza dibujable con su clave, para poder medirla y ubicarla. */
interface Pieza {
  clave: string
  nodo: ReactNode
  /** Los títulos no pueden quedar solos al pie de una hoja. */
  esTitulo: boolean
  /** El título de sección que encabeza la hoja donde caiga. */
  titulo?: string
}

export default function InformePDF({ datos, titulo, refDocumento }: Props) {
  const ahora = new Date()
  const fecha = mesYAnio(ahora)

  const piezas = useMemo(() => armarPiezas(datos), [datos])

  const medidorRef = useRef<HTMLDivElement>(null)
  const sondaRef = useRef<HTMLDivElement>(null)
  const [reparto, setReparto] = useState<string[][] | null>(null)

  useLayoutEffect(() => {
    let vigente = true

    const medir = () => {
      const medidor = medidorRef.current
      const sonda = sondaRef.current
      if (!vigente || !medidor || !sonda) return

      // Cuántos píxeles mide un milímetro acá. No se puede asumir: depende
      // del zoom del navegador y de la densidad de la pantalla.
      const pxPorMm = sonda.getBoundingClientRect().height / 100
      if (!pxPorMm) return

      const medidos: BloqueMedido[] = piezas.map((p) => {
        const el = medidor.querySelector(`[data-clave="${p.clave}"]`)
        return {
          clave: p.clave,
          alto: el ? el.getBoundingClientRect().height / pxPorMm : 0,
          pegadoAlSiguiente: p.esTitulo,
        }
      })

      /*
       * Sólo se guarda si el reparto CAMBIÓ.
       *
       * Guardar estado nuevo en cada medición sería un render más, y ese
       * render volvería a disparar la medición: el panel entero se quedaría
       * girando. La comparación por texto alcanza y sobra: son unas pocas
       * listas de claves cortas.
       */
      const nuevo = paginar(medidos, CAPACIDAD_PORTADA, CAPACIDAD_INTERIOR)
      setReparto((previo) =>
        previo && JSON.stringify(previo) === JSON.stringify(nuevo) ? previo : nuevo,
      )
    }

    medir()

    /*
     * Se vuelve a medir cuando terminan de cargar las fuentes.
     *
     * Una primera medición hecha con la tipografía de reemplazo reparte mal:
     * el alto de cada párrafo cambia cuando entra la fuente definitiva, y el
     * documento queda con hojas a medio llenar o pasadas.
     */
    document.fonts?.ready.then(medir).catch(() => {})

    return () => {
      vigente = false
    }
  }, [piezas])

  /*
   * Si la medición todavía no corrió, TODO va en una hoja sola.
   *
   * Es la salida honesta: la hoja tiene min-height y overflow visible, así
   * que crece y el navegador la parte al imprimir. Sale un documento con
   * cortes menos prolijos, pero completo. La alternativa —no dibujar nada
   * hasta tener el reparto— es la que producía el PDF en blanco.
   */
  const hojas = reparto ?? [piezas.map((p) => p.clave)]
  const porClave = new Map(piezas.map((p) => [p.clave, p]))

  return (
    <>
      <div className="informe" ref={refDocumento}>
        {hojas.map((claves, i) => {
          const bloques = claves.map((c) => porClave.get(c)).filter(Boolean) as Pieza[]
          const encabezado = tituloDeLaHoja(hojas, porClave, i)

          return (
            <section className="inf__pagina" key={i}>
              {i === 0 ? (
                <div className="inf__hero">
                  <div className="inf__hero-top">
                    <img className="inf__logo-smt" src="/marca/logo-smt-blanco.png" alt="Ciudad SMT" />
                    <div className="inf__chip-ia">
                      <img src="/marca/logo-ia.png" alt="Dirección de IA" />
                      <span>DESARROLLO</span>
                    </div>
                  </div>
                  <h1 className="inf__titulo">{titulo ?? 'Árbol Virtual de Ideas'}</h1>
                  <p className="inf__bajada">Lo que la ciudad dejó dicho en ExpoCom 2026</p>
                </div>
              ) : (
                <div className="inf__banda">
                  <h2>{encabezado}</h2>
                  <img src="/marca/logo-smt-blanco.png" alt="" />
                </div>
              )}

              <div className={i === 0 ? 'inf__cuerpo' : 'inf__cuerpo inf__cuerpo--interior'}>
                {bloques.map((p) => (
                  <div className="inf__bloque" key={p.clave}>
                    {p.nodo}
                  </div>
                ))}
              </div>

              <Pie pagina={i + 1} total={hojas.length} fecha={fecha} iso={i % 2 === 0} />
            </section>
          )
        })}
      </div>

      {/*
        El medidor: el mismo contenido, con el mismo ancho, dibujado una vez
        para saber cuánto ocupa. Va fuera del documento exportado.
      */}
      <div className="informe inf__medidor" aria-hidden>
        <div className="inf__pagina">
          <div className="inf__cuerpo inf__cuerpo--interior" ref={medidorRef}>
            {piezas.map((p) => (
              <div className="inf__bloque" data-clave={p.clave} key={p.clave}>
                {p.nodo}
              </div>
            ))}
          </div>
        </div>
        {/* Regla de 100 mm: convierte la medición en milímetros de papel. */}
        <div ref={sondaRef} style={{ height: '100mm' }} />
      </div>
    </>
  )
}

/**
 * Qué dice la banda de una hoja interior.
 *
 * Si la hoja arranca una sección, su título. Si viene continuando la
 * anterior, se dice que es continuación: una banda que repite el título
 * completo hace creer que la sección empieza de nuevo.
 */
function tituloDeLaHoja(
  hojas: string[][],
  porClave: Map<string, Pieza>,
  indice: number,
): string {
  const enEsta = hojas[indice]
    .map((c) => porClave.get(c))
    .find((p) => p?.esTitulo && p.titulo)
  if (enEsta?.titulo) return enEsta.titulo

  for (let i = indice - 1; i >= 0; i--) {
    const previo = [...hojas[i]]
      .reverse()
      .map((c) => porClave.get(c))
      .find((p) => p?.esTitulo && p.titulo)
    if (previo?.titulo) return `${previo.titulo} (continuación)`
  }
  return 'Árbol Virtual de Ideas'
}

function Pie({
  pagina,
  total,
  fecha,
  iso,
}: {
  pagina: number
  total: number
  fecha: string
  iso: boolean
}) {
  return (
    <footer className="inf__pie">
      <div className="inf__pie-izq">
        <img src={iso ? '/marca/logo-muni-iso.png' : '/marca/logo-ia.png'} alt="" />
        <div>
          <b>
            {iso ? 'Municipalidad de San Miguel de Tucumán' : 'Dirección de Inteligencia Artificial'}
          </b>
          <span>
            {iso ? 'Dirección de Inteligencia Artificial' : 'Municipalidad de San Miguel de Tucumán'}
          </span>
        </div>
      </div>
      <div className="inf__pie-der">
        Dirección de Inteligencia Artificial · {fecha}
        <br />
        Página {pagina} de {total}
      </div>
    </footer>
  )
}

/**
 * Del plan a las piezas dibujables.
 *
 * El análisis de Migue se abre en un bloque por párrafo, título o lista. Es
 * la diferencia entre poder cortar la hoja donde corresponda y tener un
 * bloque de tres páginas que no entra en ningún lado.
 */
function armarPiezas(datos: DatosInforme): Pieza[] {
  const secciones = planificarInforme(datos)
  const piezas: Pieza[] = []

  for (const aplanado of bloquesConClave(secciones)) {
    if (aplanado.esTitulo) {
      piezas.push({
        clave: aplanado.clave,
        esTitulo: true,
        titulo: aplanado.titulo,
        nodo: <h2 className="inf__sec">{aplanado.titulo}</h2>,
      })
      continue
    }

    const bloque = aplanado.bloque
    if (!bloque) continue

    if (bloque.tipo === 'markdown') {
      analizarMarkdown(bloque.texto).forEach((b, i) => {
        piezas.push({
          clave: `${aplanado.clave}:md${i}`,
          esTitulo: false,
          // Un título dentro del análisis también arrastra lo que titula.
          nodo: <BloqueMigue bloque={b} grafico={(cual) => grafico(cual, datos)} />,
        })
      })
      continue
    }

    piezas.push({
      clave: aplanado.clave,
      esTitulo: false,
      nodo: dibujar(bloque, datos),
    })
  }

  return piezas
}

/** Los gráficos que Migue puede pedir con [grafico:x] dentro de su análisis. */
function grafico(cual: string, datos: DatosInforme): ReactNode {
  if (cual === 'areas' || cual === 'area' || cual === 'anillo') {
    return dibujar({ tipo: 'grafico', cual: 'areas' }, datos)
  }
  if (cual === 'tiempo' || cual === 'linea' || cual === 'ritmo') {
    return dibujar({ tipo: 'grafico', cual: 'tiempo' }, datos)
  }
  // Un modelo puede inventar un nombre de gráfico, y eso no puede romper
  // el informe: el marcador desconocido simplemente no dibuja nada.
  return null
}

function dibujar(bloque: BloquePlan, datos: DatosInforme): ReactNode {
  const { stats, timeline, horas, edades } = datos

  if (bloque.tipo === 'kpis') {
    return (
      <div className="inf__kpis">
        <div className="inf__kpi">
          <b>{stats.ideas.toLocaleString('es-AR')}</b>
          <span>Ideas recibidas</span>
        </div>
        <div className="inf__kpi">
          <b>{stats.participants.toLocaleString('es-AR')}</b>
          <span>Vecinos</span>
        </div>
        <div className="inf__kpi">
          <b>{stats.propuestas.toLocaleString('es-AR')}</b>
          <span>Propuestas</span>
        </div>
        <div className="inf__kpi inf__kpi--criticas">
          <b>{stats.criticas.toLocaleString('es-AR')}</b>
          <span>Críticas</span>
        </div>
      </div>
    )
  }

  if (bloque.tipo === 'parrafo') {
    return <p className="md__p">{bloque.texto}</p>
  }

  if (bloque.tipo === 'nota') {
    return <p className="inf__nota">{bloque.texto}</p>
  }

  if (bloque.tipo === 'cierre') {
    return (
      <div className="inf__cierre">
        <h3>En síntesis</h3>
        <p>{bloque.texto}</p>
      </div>
    )
  }

  if (bloque.tipo === 'grafico') {
    if (bloque.cual === 'areas') {
      return (
        <div className="inf__grafico">
          <p className="inf__grafico-tit">Participación por área</p>
          <AreasDonut areas={stats.byCategory} />
        </div>
      )
    }
    return (
      <div className="inf__grafico">
        <p className="inf__grafico-tit">Ideas recibidas por hora</p>
        <TimelineChart data={timeline} horas={horas} onCambiarRango={() => {}} />
      </div>
    )
  }

  if (bloque.tipo === 'tablaAreas') {
    const filas = [...stats.byCategory].sort((a, b) => b.total - a.total)
    const mayor = filas[0]?.total ?? 0
    return (
      <table className="inf__tabla">
        <thead>
          <tr>
            <th>Área</th>
            <th>Ideas</th>
            <th>%</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => (
            <tr key={a.slug}>
              <td>{a.label}</td>
              <td>{a.total.toLocaleString('es-AR')}</td>
              <td>{porcentaje(a.total, stats.ideas)} %</td>
              <td style={{ width: '28%' }}>
                <span
                  className="inf__barra"
                  style={{
                    width: mayor > 0 ? `${Math.round((a.total / mayor) * 100)}%` : '0%',
                    background: a.color,
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (bloque.tipo === 'tablaEdades') {
    const etiqueta = (slug: string) =>
      AGE_RANGES.find((r) => r.slug === slug)?.label ?? slug
    const areaLabel = (slug: string | null) =>
      slug ? (CATEGORIES.find((c) => c.slug === slug)?.label ?? slug) : '—'
    const totalConEdad = edades.reduce((t, e) => t + e.total, 0)

    return (
      <table className="inf__tabla">
        <thead>
          <tr>
            <th>Rango etario</th>
            <th>Área que más eligió</th>
            <th>Ideas</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {edades
            .filter((e) => e.total > 0)
            .map((e) => (
              <tr key={e.slug}>
                <td>{etiqueta(e.slug)}</td>
                <td>{areaLabel(e.topArea)}</td>
                <td>{e.total.toLocaleString('es-AR')}</td>
                <td>{porcentaje(e.total, totalConEdad)} %</td>
              </tr>
            ))}
        </tbody>
      </table>
    )
  }

  if (bloque.tipo === 'citas') {
    const areaLabel = (slug: string) =>
      CATEGORIES.find((c) => c.slug === slug)?.label ?? slug
    return (
      <div>
        {bloque.items.map((c, i) => (
          <blockquote
            className={c.tipo === 'critica' ? 'inf__cita inf__cita--critica' : 'inf__cita'}
            key={i}
          >
            <p>«{c.texto}»</p>
            <span>
              {areaLabel(c.area)} · {c.tipo === 'critica' ? 'Reclamo' : 'Propuesta'}
            </span>
          </blockquote>
        ))}
      </div>
    )
  }

  return null
}
