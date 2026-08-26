import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ipDe, permitir } from './_lib/claude'
import { clasificar, hayAlgunProveedor } from './_lib/proveedor'

/**
 * Moderación semántica de propuestas ciudadanas.
 *
 * Es una CAPA ADICIONAL, no un reemplazo del filtro de palabras. Cada uno
 * cubre lo que el otro no puede:
 *
 *   · La lista de términos es instantánea, gratis y no falla nunca, pero sólo
 *     atrapa lo que alguien anotó. Un vecino escribió "gestion de m1erd4" y
 *     pasó entero hasta que agregamos la reversión de leet.
 *   · El modelo entiende lo que la lista no puede anotar: una difamación sin
 *     una sola grosería ("Fulano de Obras cobra por cada habilitación"), una
 *     amenaza velada, un dato personal de un tercero. Pero cuesta, tarda, y
 *     depende de que haya red.
 *
 * Por eso el filtro determinista sigue siendo la última palabra en el
 * servidor de base de datos: si esta función no responde, la instalación
 * sigue funcionando con la protección que ya tenía.
 */

const SISTEMA = `Sos el moderador de una instalación pública de la Municipalidad de San Miguel de Tucumán, en la feria ExpoCom.

Los vecinos dejan propuestas para mejorar la ciudad desde su celular. Cada propuesta aprobada se PROYECTA EN UNA PANTALLA GIGANTE en el stand municipal, delante de familias, chicos y autoridades.

Si el vecino firmó, LA FIRMA SE PROYECTA JUNTO A LA PROPUESTA. Se juzga con el mismo criterio que el texto: una propuesta impecable firmada "andate a la mierda" no se puede publicar, porque el insulto va a quedar en la pantalla igual. Cuando el problema esté en la firma y no en la propuesta, decilo en el motivo.

Tu tarea es decidir si esto puede publicarse.

Primero, ¿es una propuesta? Un texto sin ningún significado —teclas al azar como "asdkjh qwe zxc", letras sueltas, símbolos sueltos— no es una propuesta y se rechaza como spam. Esto no es un juicio de contenido y no admite duda: o el texto quiere decir algo o no. Una idea mal escrita, corta o vaga SÍ quiere decir algo y se acepta.

Después, si es una propuesta, decidí si su contenido puede proyectarse.

RECHAZÁ únicamente si contiene:
- Insultos, agresiones o lenguaje obsceno.
- Ataques o acusaciones contra personas identificables (por nombre, cargo o descripción), incluidas denuncias de corrupción. No importa si son ciertas: una pantalla municipal no es el canal para eso.
- Discriminación por origen, género, religión, orientación, discapacidad o condición social.
- Amenazas, incitación a la violencia o a actividades ilegales.
- Datos personales de terceros: teléfonos, domicilios, documentos.
- Propaganda político-partidaria o de campaña.
- Publicidad comercial, spam o texto sin ningún sentido.

ACEPTÁ todo lo demás, y con criterio amplio. En particular:
- La CRÍTICA A LA GESTIÓN es legítima y se acepta. "Faltan colectivos", "las calles están rotas", "el municipio no limpia el barrio" son reclamos válidos de un vecino y tienen que publicarse. Sólo se rechaza cuando ataca a una persona concreta o usa agresiones.
- Errores de ortografía, mayúsculas, informalidad y modismos tucumanos son normales. No son motivo de rechazo.
- Una propuesta breve o poco desarrollada igual vale.

Ante la duda SOBRE EL CONTENIDO, ACEPTÁ. Rechazar la propuesta legítima de un vecino es un daño peor que dejar pasar algo discutible: la persona se va del stand sintiendo que el municipio la censuró.

Eso vale para juzgar contenido, no para decidir si el texto es una propuesta. Un texto sin significado no entra por la duda: se rechaza.

Respondé únicamente con el JSON pedido, sin texto alrededor.`

interface Veredicto {
  publicar: boolean
  motivo: string
  categoria: string
}

/*
 * El esquema cumple las dos condiciones del modo estricto de OpenAI, que
 * es el que usa OpenRouter: additionalProperties en false y todas las
 * propiedades listadas en required. Si se agrega un campo, tiene que ir a
 * los dos lados o la llamada falla.
 */
const ESQUEMA = {
  type: 'object' as const,
  properties: {
    publicar: {
      type: 'boolean',
      description: 'true si la propuesta puede proyectarse en la pantalla del stand',
    },
    categoria: {
      type: 'string',
      enum: [
        'ok',
        'insulto',
        'ataque_personal',
        'discriminacion',
        'amenaza',
        'datos_personales',
        'propaganda',
        'spam',
      ],
    },
    motivo: {
      type: 'string',
      description: 'Una oración breve para el equipo de moderación. En español rioplatense.',
    },
  },
  required: ['publicar', 'categoria', 'motivo'],
  additionalProperties: false,
}

/** Se deja pasar y decide el filtro determinista de la base. */
function sinRevision(res: VercelResponse, motivo: string) {
  return res.status(200).json({ publicar: true, categoria: 'ok', motivo, degradado: true })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  // Si no hay ningún proveedor configurado, la decisión queda en manos del
  // filtro de palabras. Bloquear todo porque falta una variable de entorno
  // dejaría el stand sin poder recibir ideas.
  if (!hayAlgunProveedor()) {
    return sinRevision(res, 'Revisión automática no configurada.')
  }

  // El endpoint es público: lo llama el celular de cada vecino.
  if (!permitir(ipDe(req), 20)) {
    return sinRevision(res, 'Demasiadas revisiones seguidas desde esta conexión.')
  }

  const { texto, nombre } = (req.body ?? {}) as { texto?: string; nombre?: string }

  if (typeof texto !== 'string' || texto.trim().length < 3) {
    return res.status(400).json({ error: 'Falta el texto de la propuesta.' })
  }

  // Tope defensivo: el formulario limita a 180, pero esta ruta es pública.
  const propuesta = texto.trim().slice(0, 400)
  const firma = typeof nombre === 'string' ? nombre.trim().slice(0, 60) : ''

  try {
    const { datos } = await clasificar({
      sistema: SISTEMA,
      usuario: firma
        ? `Propuesta: "${propuesta}"\nFirma que se proyecta junto a ella: "${firma}"`
        : `Propuesta: "${propuesta}"\n(sin firma)`,
      esquema: ESQUEMA,
      nombreEsquema: 'veredicto_moderacion',
      // Un stand no puede esperar: si tarda más que esto, decide el filtro
      // determinista y la persona no se queda mirando la pantalla.
      timeoutMs: 8_000,
    })

    const veredicto = datos as Partial<Veredicto>

    return res.status(200).json({
      publicar: veredicto.publicar !== false,
      categoria: veredicto.categoria ?? 'ok',
      motivo: typeof veredicto.motivo === 'string' ? veredicto.motivo : '',
    })
  } catch (error) {
    /*
     * Falla abierta, a propósito.
     *
     * Si ningún proveedor responde —red del predio, límite de tasa, crédito
     * agotado— la alternativa sería rechazar la propuesta, y eso deja al
     * vecino sin poder participar por un problema que no es suyo. La
     * propuesta sigue pasando por el filtro de palabras del servidor y por
     * la cola de revisión del panel, así que no queda sin control.
     */
    console.error('[moderar] falló la revisión semántica:', error)
    return sinRevision(res, 'No se pudo completar la revisión automática.')
  }
}
