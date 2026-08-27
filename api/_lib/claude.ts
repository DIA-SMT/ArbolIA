import type Anthropic from '@anthropic-ai/sdk'

/**
 * Cliente de Anthropic, para las funciones del servidor.
 *
 * VIVE ACÁ Y NO EN src/ A PROPÓSITO.
 *
 * Todo lo que Vite empaqueta termina dentro del JavaScript que descarga
 * cada visitante. Una clave de API en el frontend es una clave publicada:
 * la lee cualquiera abriendo las herramientas de desarrollo, y el consumo
 * lo paga el municipio. Por eso ANTHROPIC_API_KEY no lleva prefijo VITE_ y
 * sólo existe en el entorno del servidor.
 *
 * EL SDK SE CARGA CUANDO SE USA, no al importar este módulo.
 *
 * La instalación puede correr entera con OpenRouter, que habla por fetch y
 * no necesita este paquete. Cargarlo arriba significaba pagar su arranque
 * en cada invocación —y, peor, que un problema al resolverlo tumbara las
 * dos funciones aunque Anthropic no se estuviera usando. El tipo se
 * importa con `import type`, que TypeScript borra al compilar: no queda
 * ninguna dependencia real en el nivel superior.
 */

export const MODELO_ANTHROPIC = 'claude-opus-5'

let cliente: Anthropic | null = null

export async function getClaude(): Promise<Anthropic> {
  if (cliente) return cliente

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('Falta ANTHROPIC_API_KEY en las variables de entorno del servidor.')
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  cliente = new Anthropic({ apiKey })
  return cliente
}

/** ¿Está configurada la cuenta de Anthropic? Ver también proveedor.ts. */
export function hayClaveAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
