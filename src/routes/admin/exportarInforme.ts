/**
 * Abre el informe en una pestaña aparte, listo para guardar como PDF.
 *
 * POR QUÉ NO SE IMPRIME LA PÁGINA DIRECTAMENTE.
 *
 * La primera versión llamaba a window.print() sobre el panel y ocultaba todo
 * lo demás con @media print. Falló por dos motivos, y los dos importan:
 *
 *  1. Salía en blanco. La regla decía `body > *:not(.informe-raiz)`, pero el
 *     informe vive dentro del panel de Migue, a cuatro niveles de body: la
 *     regla escondía justamente al contenedor que lo tenía adentro.
 *
 *  2. Tiraba al equipo al diálogo de impresión sin haber visto nada. Un
 *     informe que va a la jefatura se mira antes de mandarlo.
 *
 * Ahora el informe se abre en su propia pestaña, ocupando la ventana entera y
 * a tamaño real. Ahí se lee, y el botón de la barra abre el diálogo del
 * navegador para guardarlo como PDF.
 *
 * SOBRE LA DESCARGA DIRECTA. Un navegador no puede escribir un archivo PDF
 * desde HTML sin una librería que lo arme, y las que hay rasterizan los
 * gráficos y empeoran la tipografía. Guardando desde el diálogo, el PDF lo
 * genera el motor del navegador: los gráficos salen vectoriales y el texto
 * sigue siendo texto. Es un clic más y un documento mucho mejor.
 */

/** Nombre sugerido del archivo, con la fecha del día. */
export function nombreSugerido(fecha = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Informe-ArbolDeIdeas-${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`
}

/**
 * Se copian los estilos del documento actual, no se reescriben.
 *
 * Así el informe de la pestaña nueva usa EXACTAMENTE las mismas hojas que se
 * verificaron: en desarrollo Vite inyecta <style>, en producción hay <link>
 * con rutas del mismo origen, y las dos cosas funcionan clonadas tal cual.
 * Cualquier copia manual de reglas se desincronizaría al primer cambio.
 */
export function estilosDelDocumento(): string {
  const partes: string[] = []
  for (const nodo of document.querySelectorAll('link[rel="stylesheet"], style')) {
    partes.push(nodo.outerHTML)
  }
  return partes.join('\n')
}

/**
 * Arma el documento completo del informe.
 *
 * Va separado de abrirInforme a propósito: window.open sólo funciona desde un
 * clic de la persona, así que la apertura no se puede verificar sin gesto. El
 * armado del HTML sí, y es donde estuvo el bug —la versión anterior producía
 * un documento sin el informe adentro y salía en blanco—. Ver check-informe.
 */
export function armarDocumento(
  contenidoDelInforme: string,
  estilos: string,
  titulo = nombreSugerido(),
): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
${estilos}
<style>
  /* En su propia pestaña el informe es TODO el documento. */
  html, body { margin: 0; padding: 0; background: #6b7885; }
  .informe { display: block !important; }
  /* Se anula el escondite que usa el panel para tenerlo fuera de la vista. */
  .informe-raiz { position: static !important; left: auto !important; width: auto !important; }
  .inf__pagina { margin: 0 auto 10mm; box-shadow: 0 4mm 14mm rgba(0,0,0,.35); }

  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px;
    background: #10233d; color: #fff;
    font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px;
  }
  .barra b { font-weight: 700; }
  .barra span { color: #a9c4dd; }
  .barra button {
    margin-left: auto; padding: 8px 16px;
    border: 0; border-radius: 8px; cursor: pointer;
    background: linear-gradient(120deg, #126ff5, #3cb4f0);
    color: #fff; font-weight: 700; font-size: 13px;
  }

  /* La barra no va en el papel. */
  @media print {
    .barra { display: none; }
    html, body { background: #fff; }
    .inf__pagina { margin: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="barra">
  <b>Informe listo.</b>
  <span>Revisalo y guardalo. En el diálogo: destino <b>Guardar como PDF</b>, márgenes <b>Ninguno</b> y <b>Gráficos de fondo</b> activado.</span>
  <button onclick="window.print()">Guardar como PDF</button>
</div>
${contenidoDelInforme}
</body>
</html>`
}

/** Abre el informe en una pestaña nueva. Sólo funciona desde un clic. */
export function abrirInforme(contenedor: HTMLElement | null): boolean {
  if (!contenedor) return false

  const ventana = window.open('', '_blank')
  if (!ventana) return false

  ventana.document.write(armarDocumento(contenedor.innerHTML, estilosDelDocumento()))
  ventana.document.close()

  return true
}
