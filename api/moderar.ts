import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ipDe, permitir } from './_lib/limite.js'
import { clasificar, hayAlgunProveedor } from './_lib/proveedor.js'

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
- CUALQUIER texto cuyo tema sea una persona pública, funcionario, intendente, concejal o candidato: da igual si lo ataca o si lo elogia. Los dos se rechazan, y la simetría es deliberada. Un ataque no es asunto de una pantalla municipal, y un elogio la convierte en propaganda: "el intendente es un ladrón" y "la intendenta es una crack" se rechazan igual. Incluye denuncias de corrupción, ciertas o no, y también los elogios firmados con cariño. Lo que se proyecta son ideas para la ciudad, no opiniones sobre quién la gobierna.
- Discriminación por origen, género, religión, orientación, discapacidad o condición social.
- Amenazas, incitación a la violencia o a actividades ilegales.
- Apología o promoción del consumo de drogas, alcohol, contenido sexual o apuestas. La pantalla del stand la miran chicos con sus familias. "Droga para todos", "birra gratis en las plazas" o similares NO se publican, ni siquiera leídos como chiste: en la pantalla no va a estar el tono con que se escribieron. Esto NO alcanza a la política pública sobre esos temas, que sí es una propuesta legítima de ciudad: "un centro de prevención de adicciones en cada barrio" o "más campañas contra el alcohol al volante" se ACEPTAN.
- Datos personales de terceros: teléfonos, domicilios, documentos.
- Propaganda político-partidaria o de campaña.
- Publicidad comercial, spam o texto sin ningún sentido.

ACEPTÁ todo lo demás, y con criterio amplio. En particular:
- La CRÍTICA A LA GESTIÓN es legítima y se acepta. "Faltan colectivos", "las calles están rotas", "el municipio no limpia el barrio", "el transporte es un desastre" son reclamos válidos de un vecino y tienen que publicarse.
  El límite es el SUJETO del texto, no su tono. Si habla de la ciudad, de un servicio o de una institución —"el municipio", "la muni", "el transporte", "Obras Públicas"— se acepta, aunque sea duro. Si habla de una PERSONA —el intendente, la intendenta, un concejal, un funcionario por su nombre o su cargo— se rechaza, sea elogio o crítica. "El municipio no limpia" se publica; "el intendente no limpia nada" no. No es censurar el reclamo: es que el reclamo se puede escribir sin nombrar a nadie, y la pantalla del municipio no puede opinar sobre personas.
- Errores de ortografía, mayúsculas, informalidad y modismos tucumanos son normales. No son motivo de rechazo.
- Una propuesta breve o poco desarrollada igual vale.

Ante la duda SOBRE EL CONTENIDO, ACEPTÁ. Rechazar la propuesta legítima de un vecino es un daño peor que dejar pasar algo discutible: la persona se va del stand sintiendo que el municipio la censuró.

Eso vale para juzgar contenido, no para decidir si el texto es una propuesta. Un texto sin significado no entra por la duda: se rechaza.

---

Además, si se publica, clasificá de qué tipo es. Esto NO decide si se publica: las dos se publican, y sólo cambia dónde aparecen en el árbol.

- "propuesta": pide o imagina algo CONCRETO para hacer en la ciudad.
  "Más colectivos por Mate de Luna", "Plantar árboles en la avenida",
  "Wifi en las plazas", "Que el 118 tenga rampa", "Bicisendas en Mate de Luna".
  Brota como una hoja en las ramas.

- "critica": señala algo que está mal, que falta o que no funciona, sin pedir
  una acción concreta. Es un reclamo.
  "El municipio no limpia el barrio hace meses", "Las calles están rotas y nadie
  hace nada", "El transporte es carísimo y funciona pésimo", "Hace dos años que
  reclamo y no me responden".
  Cae desde la copa y fortalece las raíces del árbol, que son la comunidad.

LO QUE DECIDE ES SI HAY ALGO CONCRETO, no la forma del verbo. Un verbo de
mejora sin nada concreto atrás está diciendo que algo está mal, y eso es un
reclamo:
  "Mejoraría las calles"                    → critica   (no dice qué hacer)
  "Repavimentaría la calle San Juan"        → propuesta (sí lo dice)
  "Arreglaría las veredas"                  → critica
  "Veredas anchas y con rampa en el centro" → propuesta

Si el texto hace las dos cosas —señala un problema Y pide algo concreto— es
"propuesta". Ante la duda, "propuesta".

Respondé únicamente con el JSON pedido, sin texto alrededor.`

interface Veredicto {
  publicar: boolean
  motivo: string
  categoria: string
  tipo: 'propuesta' | 'critica'
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
        'sobre_funcionario',
        'discriminacion',
        'amenaza',
        'inapropiado_para_chicos',
        'datos_personales',
        'propaganda',
        'spam',
      ],
    },
    motivo: {
      type: 'string',
      description: 'Una oración breve para el equipo de moderación. En español rioplatense.',
    },
    tipo: {
      type: 'string',
      enum: ['propuesta', 'critica'],
      description:
        'propuesta = nombra una acción para la ciudad, brota como hoja. critica = sólo describe un problema, cae y alimenta las raíces.',
    },
  },
  required: ['publicar', 'categoria', 'motivo', 'tipo'],
  additionalProperties: false,
}

/** Se deja pasar y decide el filtro determinista de la base. */
function sinRevision(res: VercelResponse, motivo: string) {
  // 'propuesta' es el degradado seguro: la idea brota como hoja, que es lo
  // que pasaba antes de que existiera esta clasificacion. Si el degradado
  // fuera 'critica', un corte de red dejaria la copa vacia y las raices
  // creciendo solas — la instalacion se veria rota.
  return res
    .status(200)
    .json({ publicar: true, categoria: 'ok', tipo: 'propuesta', motivo, degradado: true })
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

  const { texto, nombre, dispositivo } = (req.body ?? {}) as {
    texto?: string
    nombre?: string
    dispositivo?: string
  }

  /*
   * EL LÍMITE SE CUENTA POR DISPOSITIVO, NO POR CONEXIÓN.
   *
   * Antes era permitir(ip, 20): veinte revisiones por minuto y por IP. Suena
   * generoso hasta que se piensa dónde corre esto. En un stand la gente se
   * conecta al WiFi del predio, o sale por el NAT de una misma operadora, así
   * que decenas de vecinos comparten UNA dirección: los veinte por minuto no
   * eran veinte por persona, eran veinte entre todos. Con cola en el stand
   * eso se alcanza, y pasado el límite este endpoint FALLA ABIERTO —deja
   * pasar sin revisar— justo en el momento de mayor tránsito, que es cuando
   * más falta hace.
   *
   * Ahora el techo principal es por dispositivo, igual que los límites de la
   * base: 6 por minuto contra el 1-cada-12-segundos del trigger, así que un
   * celular legítimo nunca lo toca. Y se conserva un techo por IP, alto, para
   * el caso que el límite existía para frenar: alguien que encuentra la URL y
   * la llama en bucle inventando identificadores.
   */
  const porDispositivo =
    typeof dispositivo === 'string' && /^dev_[a-z0-9]{8,40}$/i.test(dispositivo)
      ? permitir(`dev:${dispositivo}`, 6)
      : true

  const porConexion = permitir(`ip:${ipDe(req)}`, 240)

  if (!porDispositivo || !porConexion) {
    return sinRevision(res, 'Demasiadas revisiones seguidas desde esta conexión.')
  }

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
      tipo: veredicto.tipo === 'critica' ? 'critica' : 'propuesta',
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
