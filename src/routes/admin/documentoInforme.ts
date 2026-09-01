/**
 * El documento HTML del informe, armado como texto.
 *
 * Está separado de exportarInforme.ts a propósito, y por dos razones:
 *
 *  1. `window.open` sólo funciona desde un clic de la persona, así que la
 *     apertura no se puede verificar sin gesto. El armado del HTML sí, y es
 *     donde estuvieron los dos bugs que llegaron al equipo: un documento sin
 *     el informe adentro —salía en blanco— y después un documento que no
 *     scrolleaba y se veía cortado.
 *
 *  2. exportarInforme.ts importa la hoja de estilos con `?inline`, que es
 *     magia de Vite y no se resuelve fuera de un build. Este módulo no
 *     importa nada, así que se puede probar desde la línea de comandos.
 *
 * Ver scripts/check-informe.ts.
 */

/** Nombre sugerido del archivo, con la fecha del día. */
export function nombreSugerido(fecha = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    'Informe-ArbolDeIdeas-' +
    fecha.getFullYear() +
    '-' +
    p(fecha.getMonth() + 1) +
    '-' +
    p(fecha.getDate())
  )
}

/**
 * Arma el documento completo del informe.
 *
 * POR QUÉ NO SE CLONAN LAS HOJAS DE ESTILO DE LA APP.
 *
 * La versión anterior copiaba al documento nuevo TODOS los <link> y <style>
 * de la página. Parecía lo más seguro —usar exactamente los estilos que ya se
 * veían— y fue justamente lo que rompió el informe: global.css define
 *
 *     html, body, #root { height: 100% }
 *     body { overflow: hidden }
 *
 * y libera el scroll sólo con `body[data-route='admin']`. La pestaña del
 * informe no tiene ese atributo, así que heredaba `overflow: hidden` y
 * `height: 100%`: el documento no se podía scrollear y todo lo que pasaba del
 * primer alto de pantalla quedaba tapado. Eso era "el informe está cortado".
 *
 * Ahora el documento lleva SOLO la hoja del informe, que define sus propias
 * variables de color y su propio box-sizing y se basta sola. Y como no
 * depende de la app, no puede volver a romperse porque alguien cambie una
 * regla global.
 *
 * `origen` es la base para resolver las imágenes de marca: el documento se
 * escribe sobre una pestaña en blanco, y sin <base> las rutas /marca/... no
 * apuntan a ningún lado.
 */
export function armarDocumento(
  contenidoDelInforme: string,
  hoja: string,
  titulo = nombreSugerido(),
  origen = '/',
): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${origen}">
<title>${titulo}</title>
<style>
${hoja}
</style>
<style>
  /*
   * Estilos de la PESTAÑA, no del papel.
   *
   * El alto automático y el scroll se declaran explícitos porque el bug
   * anterior fue exactamente ése: heredar un overflow:hidden ajeno. Acá ya no
   * se hereda nada de la app, pero igual se dice en voz alta.
   */
  html, body {
    height: auto;
    min-height: 100%;
    overflow: auto;
    margin: 0;
    padding: 0;
    background: #6b7885;
  }

  /*
   * En su propia pestaña el informe es TODO el documento.
   *
   * No hace falta anular ningún escondite: lo que se copia es el elemento
   * .informe solo, y quien lo mantenía fuera de pantalla en el panel es su
   * contenedor, que no viaja.
   */
  .informe { display: block; }

  /* Cada hoja se ve como una hoja, separada y con sombra. */
  .inf__pagina {
    margin: 8mm auto;
    box-shadow: 0 3mm 12mm rgba(0, 0, 0, 0.34);
  }

  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 14px;
    padding: 11px 18px;
    background: #10233d; color: #fff;
    font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  }
  .barra b { font-weight: 700; }
  .barra span { color: #a9c4dd; }
  .barra button {
    margin-left: auto; padding: 9px 18px; flex: none;
    border: 0; border-radius: 8px; cursor: pointer;
    background: linear-gradient(120deg, #126ff5, #3cb4f0);
    color: #fff; font-weight: 700; font-size: 13px;
  }
  .barra button:hover { filter: brightness(1.08); }

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
