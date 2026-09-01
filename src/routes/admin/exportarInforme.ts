/**
 * Abre el informe en una pestaña aparte, listo para revisar y guardar en PDF.
 *
 * Este archivo es fino a propósito: sólo trae la hoja de estilos y abre la
 * ventana. El armado del documento —que es donde estuvieron los bugs— vive en
 * documentoInforme.ts, que no importa nada y por eso se puede probar sin
 * navegador. Ver la nota larga de ese archivo.
 *
 * SOBRE LA DESCARGA DIRECTA. Un navegador no puede escribir un archivo PDF
 * desde HTML sin una librería que lo arme, y las que hay rasterizan los
 * gráficos y empeoran la tipografía. Guardando desde el diálogo, el PDF lo
 * genera el motor del navegador: los gráficos salen vectoriales y el texto
 * sigue siendo texto. Es un clic más y un documento mucho mejor.
 */
import estilosDelInforme from './informe.css?inline'
import { armarDocumento, nombreSugerido } from './documentoInforme'

export { armarDocumento, nombreSugerido }

/** La hoja del informe, tal cual se compila. */
export function estilos(): string {
  return estilosDelInforme
}

/**
 * Abre el informe en una pestaña nueva. Sólo funciona desde un clic.
 *
 * Se manda el elemento .informe con su etiqueta y todo (outerHTML, no
 * innerHTML): esa clase es la que define las variables de color y la
 * tipografía del documento. Sin ella el informe sale sin identidad.
 */
export function abrirInforme(documento: HTMLElement | null): boolean {
  if (!documento) return false

  const ventana = window.open('', '_blank')
  if (!ventana) return false

  ventana.document.write(
    armarDocumento(
      documento.outerHTML,
      estilosDelInforme,
      nombreSugerido(),
      window.location.origin + '/',
    ),
  )
  ventana.document.close()

  return true
}
