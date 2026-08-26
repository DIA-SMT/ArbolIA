const STORAGE_KEY = 'arbolia.device_id'
const SENT_KEY = 'arbolia.sent_ideas'

/**
 * Identidad anonima del celular. No es un dato personal: es un identificador
 * aleatorio local que solo sirve para contar participantes unicos y aplicar
 * el limite de envios. No se pide nombre, mail ni telefono en ningun momento.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length >= 8) return existing

    const fresh = generateId()
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Modo incognito o storage bloqueado: id efimero por sesion.
    return generateId()
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
