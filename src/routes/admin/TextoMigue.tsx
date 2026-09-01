import { analizarMarkdown, type Bloque, type Trozo } from '../../lib/formatoMigue'

/**
 * Dibuja el texto de Migue con su formato.
 *
 * Todo sale como nodos de React. No hay dangerouslySetInnerHTML en ningún
 * lado, y no es casualidad: el contenido lo redacta un modelo a partir de lo
 * que escribieron vecinos desde sus celulares, y eso no entra como marcado al
 * panel del municipio.
 */

interface Props {
  texto: string
  /** Los marcadores [grafico:x] se resuelven acá. En el chat no hay gráficos. */
  grafico?: (cual: string) => React.ReactNode
}

export default function TextoMigue({ texto, grafico }: Props) {
  const bloques = analizarMarkdown(texto)

  return (
    <>
      {bloques.map((b, i) => (
        <BloqueMigue key={i} bloque={b} grafico={grafico} />
      ))}
    </>
  )
}

/**
 * Un solo bloque de Migue.
 *
 * Se exporta porque el informe lo necesita suelto: para repartir el
 * documento en hojas A4 hay que medir bloque por bloque, y un análisis
 * entero medido como una pieza no se puede cortar por ningún lado. Ver
 * InformePDF.
 */
export function BloqueMigue({
  bloque,
  grafico,
}: {
  bloque: Bloque
  grafico?: (cual: string) => React.ReactNode
}) {
  if (bloque.tipo === 'grafico') {
    const nodo = grafico?.(bloque.cual)
    // Sin resolvedor de gráficos —el chat— el marcador simplemente no se
    // dibuja. Mostrar "[grafico:areas]" en pantalla sería peor que nada.
    return nodo ? <div className="md__grafico">{nodo}</div> : null
  }

  if (bloque.tipo === 'titulo') {
    const Etiqueta = (`h${Math.min(6, bloque.nivel + 2)}` as unknown) as 'h3'
    return (
      <Etiqueta className={`md__titulo md__titulo--${bloque.nivel}`}>
        <Trozos trozos={bloque.trozos} />
      </Etiqueta>
    )
  }

  if (bloque.tipo === 'lista') {
    const Etiqueta = bloque.ordenada ? 'ol' : 'ul'
    return (
      <Etiqueta className="md__lista">
        {bloque.items.map((item, i) => (
          <li key={i}>
            <Trozos trozos={item} />
          </li>
        ))}
      </Etiqueta>
    )
  }

  return (
    <p className="md__p">
      <Trozos trozos={bloque.trozos} />
    </p>
  )
}

function Trozos({ trozos }: { trozos: Trozo[] }) {
  return (
    <>
      {trozos.map((t, i) => {
        if (t.tipo === 'fuerte') return <strong key={i}>{t.texto}</strong>
        if (t.tipo === 'enfasis') return <em key={i}>{t.texto}</em>
        if (t.tipo === 'codigo') return <code key={i}>{t.texto}</code>
        return <span key={i}>{t.texto}</span>
      })}
    </>
  )
}
