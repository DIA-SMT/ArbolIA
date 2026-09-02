const STORAGE_KEY = 'arbolia.device_id'
const SENT_KEY = 'arbolia.sent_ideas'

/**
 * Identidad anonima del celular. No es un dato personal: es un identificador
 * aleatorio local que solo sirve para contar participantes unicos y aplicar
 * el limite de envios. No se pide nombre, mail ni telefono en ningun momento.
 */
/*
 * Respaldo en memoria para cuando el almacenamiento está bloqueado.
 *
 * ACÁ HABÍA UN BUG. El catch devolvía generateId() sin guardarlo en ningún
 * lado, y el comentario decía "id efímero por sesión" cuando en realidad era
 * efímero POR LLAMADA: cada vez daba uno distinto. Con el almacenamiento
 * bloqueado —modo incógnito, y el privado de iOS lo bloquea— eso rompía tres
 * cosas a la vez:
 *
 *   · el tope de ideas por persona no se aplicaba nunca, porque para la base
 *     cada envío venía de un dispositivo nuevo;
 *   · el contador de "ciudadanos participando" es count(distinct device_id),
 *     así que una persona sola inflaba el número tanto como ideas mandara;
 *   · y el límite de la revisión con IA, que ahora cuenta por dispositivo,
 *     tampoco la alcanzaba.
 *
 * Se nota justo en el caso que preocupa: mucha gente junta, algunos en
 * incógnito. Con el id en memoria del módulo, la persona conserva su
 * identidad mientras no recargue la página.
 */
let idEnMemoria: string | null = null

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length >= 8) return existing

    const fresh = idEnMemoria ?? generateId()
    idEnMemoria = fresh
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    if (!idEnMemoria) idEnMemoria = generateId()
    return idEnMemoria
  }
}

function generateId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `dev_${uuid.replace(/-/g, '').slice(0, 28)}`
}

/** Ids de ideas que este celular envio, para destacar "tu hoja" al volver. */
export function getSentIdeaIds(): string[] {
  try {
    const raw = localStorage.getItem(SENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function rememberSentIdea(id: string): void {
  try {
    const all = [...getSentIdeaIds(), id].slice(-20)
    localStorage.setItem(SENT_KEY, JSON.stringify(all))
  } catch {
    /* sin storage: se pierde el historial local, no afecta el envio */
  }
}
