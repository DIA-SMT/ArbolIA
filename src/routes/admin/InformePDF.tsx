import TextoMigue from './TextoMigue'
import AreasDonut from './AreasDonut'
import TimelineChart from './TimelineChart'
import type { TimelinePoint } from '../../lib/api'
import type { Stats } from '../../lib/types'
import './informe.css'

/**
 * El informe de ExpoCom en PDF, con la identidad de la Dirección de IA.
 *
 * Lo exporta el navegador: el documento se arma como HTML con @page A4 y se
 * llama a window.print(). Ver la nota larga en informe.css sobre por qué no
 * hay librería de PDF.
 *
 * El contenido lo escribe Migue. Este componente sólo lo enmarca: portada,
 * cifras, gráficos donde Migue los pidió, y el bloque de cierre. La identidad
 * —franja de 53 mm, bandas de 20 mm, pie de 15 mm, degradé en 112°— sale de
 * la plantilla oficial y no se negocia con el contenido.
 */

interface Props {
  /** Lo que respondió Migue, en markdown. Puede traer [grafico:x]. */
  texto: string
  stats: Stats
  timeline: TimelinePoint[]
  /** Rango de horas que el panel tiene elegido. */
  horas: number
  /** Encabezado del documento. */
  titulo?: string
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export default function InformePDF({ texto, stats, timeline, horas, titulo }: Props) {
  const ahora = new Date()
  const fecha = `${MESES[ahora.getMonth()]} ${ahora.getFullYear()}`

  /*
   * Los gráficos que Migue puede pedir.
   *
   * Migue decide si van y dónde, escribiendo [grafico:areas] o
   * [grafico:tiempo] en su respuesta. Es lo que hace que el informe sea SUYO
   * y no una plantilla con un texto adentro: si el análisis habla del reparto
   * por área, el anillo va justo ahí; si habla del ritmo de participación,
   * va la línea de tiempo.
   *
   * Si pide uno que no existe, no se dibuja nada. Un modelo puede inventar un
   * nombre de gráfico, y eso no puede romper el informe.
   */
  const grafico = (cual: string) => {
    if (cual === 'areas' || cual === 'area' || cual === 'anillo') {
      return (
        <div className="inf__grafico">
          <p className="inf__grafico-tit">Participación por área</p>
          <AreasDonut areas={stats.byCategory} />
        </div>
      )
    }
    if (cual === 'tiempo' || cual === 'linea' || cual === 'ritmo') {
      return (
        <div className="inf__grafico">
          <p className="inf__grafico-tit">Ideas recibidas por hora</p>
          <TimelineChart data={timeline} horas={horas} onCambiarRango={() => {}} />
        </div>
      )
    }
    return null
  }

  const pie = (pagina: number, total: number, iso: boolean) => (
    <footer className="inf__pie">
      <div className="inf__pie-izq">
        <img src={iso ? '/marca/logo-muni-iso.png' : '/marca/logo-ia.png'} alt="" />
        <div>
          <b>{iso ? 'Municipalidad de San Miguel de Tucumán' : 'Dirección de Inteligencia Artificial'}</b>
          <span>{iso ? 'Dirección de Inteligencia Artificial' : 'Municipalidad de San Miguel de Tucumán'}</span>
        </div>
      </div>
      <div className="inf__pie-der">
        Dirección de Inteligencia Artificial · {fecha}
        <br />
        Página {pagina} de {total}
      </div>
    </footer>
  )

  return (
    <div className="informe">
      {/* ---------- Página 1: portada y análisis ---------- */}
      <section className="inf__pagina">
        <div className="inf__hero">
          <div className="inf__hero-top">
            <img className="inf__logo-smt" src="/marca/logo-smt-blanco.png" alt="Ciudad SMT" />
            <div className="inf__chip-ia">
              <img src="/marca/logo-ia.png" alt="Dirección de IA" />
              <span>DESARROLLO</span>
            </div>
          </div>
          <h1 className="inf__titulo">{titulo ?? 'Árbol Virtual de Ideas'}</h1>
          <p className="inf__bajada">
            Lo que la ciudad dejó dicho en ExpoCom 2026
          </p>
        </div>

        <div className="inf__cuerpo">
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

          <h2 className="inf__sec">Análisis de lo recibido</h2>
          <div className="inf__texto">
            <TextoMigue texto={texto} grafico={grafico} />
          </div>
        </div>

        {pie(1, 2, true)}
      </section>

      {/* ---------- Página 2: los datos y el cierre ---------- */}
      <section className="inf__pagina">
        <div className="inf__banda">
          <h2>Los datos</h2>
          <img src="/marca/logo-smt-blanco.png" alt="" />
        </div>

        <div className="inf__cuerpo inf__cuerpo--interior">
          <div className="inf__grafico">
            <p className="inf__grafico-tit">Participación por área</p>
            <AreasDonut areas={stats.byCategory} />
          </div>

          <div className="inf__grafico">
            <p className="inf__grafico-tit">Ideas recibidas por hora</p>
            <TimelineChart data={timeline} horas={horas} onCambiarRango={() => {}} />
          </div>

          <div className="inf__cierre">
            <h3>En síntesis</h3>
            <p>
              {stats.ideas.toLocaleString('es-AR')} ideas de{' '}
              {stats.participants.toLocaleString('es-AR')} vecinos, repartidas en las ocho
              áreas de la ciudad. Cada una quedó registrada con su categoría y su
              momento, y el conjunto está disponible para el análisis posterior de la
              gestión.
            </p>
          </div>
        </div>

        {pie(2, 2, false)}
      </section>
    </div>
  )
}
