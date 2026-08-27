/**
 * Empaqueta y ejecuta un script de verificación.
 *
 *   node scripts/correr.mjs scripts/check-criticas.ts
 *
 * Existe por una razón chica y molesta: algunos checks importan módulos de
 * src/ que leen `import.meta.env`, y eso en Node no existe. Pasarle el
 * reemplazo a esbuild por línea de comandos funciona en una terminal, pero
 * `npm run` en Windows se come las comillas del JSON y el bundle falla con
 * un error que no dice nada. Acá el valor va como objeto, sin shell de por
 * medio.
 */
import { build } from 'esbuild'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const entrada = process.argv[2]
if (!entrada) {
  console.error('Falta el script a correr. Ej: node scripts/correr.mjs scripts/check-criticas.ts')
  process.exit(1)
}

const salida = resolve(`node_modules/.cache/${basename(entrada, '.ts')}.mjs`)

await build({
  entryPoints: [entrada],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: salida,
  logLevel: 'error',
  define: {
    // Lo mínimo para que config.ts cargue fuera del navegador. Sin
    // credenciales: ningún check habla con Supabase.
    'import.meta.env': JSON.stringify({ DEV: false, VITE_PUBLIC_URL: 'http://localhost' }),
  },
})

await import(pathToFileURL(salida).href)
