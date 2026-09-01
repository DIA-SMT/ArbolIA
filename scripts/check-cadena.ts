/* Ensayo de la cadena, por el mismo camino que el celular del vecino:
   clave anónima -> /api/moderar -> arbolia_submit_idea -> tiempo real. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env: Record<string, string> = {}
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i < 0) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

let fallos = 0
const check = (etiqueta: string, ok: boolean, detalle = '') => {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${etiqueta}${detalle ? ` — ${detalle}` : ''}`)
}

const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const MARCA = 'ensayo-cadena'
const device = `dev_${Date.now()}_${MARCA}`

console.log('\n1. REVISIÓN SEMÁNTICA (lo que hace /idea antes de enviar)')
const rev = await fetch('http://localhost:5173/api/moderar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ texto: 'Poner luminarias LED en el pasaje Belgrano', nombre: 'Ensayo' }),
}).then((r) => r.json())
check('la revisión responde', typeof rev.publicar === 'boolean', JSON.stringify(rev).slice(0, 90))
check('clasifica como propuesta', rev.tipo === 'propuesta')
check('la deja publicar', rev.publicar === true)

console.log('\n2. TIEMPO REAL (lo que escucha la pantalla)')
let avisada: string | null = null
const canal = db
  .channel('ensayo-cadena')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ideas' }, (p) => {
    avisada = (p.new as { id?: string }).id ?? 'sin-id'
  })
const suscripta = await new Promise<boolean>((res) => {
  canal.subscribe((estado) => { if (estado === 'SUBSCRIBED') res(true) })
  setTimeout(() => res(false), 9000)
})
check('el canal conecta', suscripta)

console.log('\n3. ENVÍO (lo que hace el celular al tocar Enviar)')
const { data, error } = await db.rpc('arbolia_submit_idea', {
  p_text: 'Poner luminarias LED en el pasaje Belgrano',
  p_category: 'espacios',
  p_device_id: device,
  p_author_name: 'Ensayo',
  p_age_range: '30-44',
  p_revisar: rev.publicar === false,
  p_motivo: rev.motivo ?? null,
  p_tipo: rev.tipo ?? 'propuesta',
})
check('la idea entra', !error, error ? `${error.code ?? ''} ${error.message}` : 'sin error')
const fila = Array.isArray(data) ? data[0] : data
check('devuelve la idea guardada', Boolean(fila?.id), fila?.id ?? '')
check('con el tipo correcto', fila?.tipo === 'propuesta', `tipo: ${fila?.tipo}`)

console.log('\n4. LLEGA A LA PANTALLA')
await new Promise((r) => setTimeout(r, 3500))
check('el tiempo real avisó', avisada !== null, avisada ? `id ${String(avisada).slice(0, 8)}…` : 'no llegó aviso en 3,5 s')

const { data: publicas } = await db
  .from('ideas')
  .select('id, text, category, status, tipo')
  .eq('id', fila?.id)
check('la pantalla puede leerla', (publicas?.length ?? 0) === 1, `${publicas?.length ?? 0} fila(s)`)

console.log('\n5. LO INTERNO SIGUE OCULTO')
for (const col of ['author_name', 'age_range', 'device_id']) {
  const { error: e } = await db.from('ideas').select(col).limit(1)
  check(`"${col}" no se puede leer`, e?.code === '42501')
}

console.log('\n6. EL CAMINO DE LA CRÍTICA (la fruta que cae a las raíces)')
const revC = await fetch('http://localhost:5173/api/moderar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ texto: 'La recoleccion de residuos en el barrio no pasa desde hace semanas' }),
}).then((r) => r.json())
check('la revisión la reconoce como crítica', revC.tipo === 'critica', `tipo: ${revC.tipo}`)
check('y la deja publicar', revC.publicar === true)

const { data: dC, error: eC } = await db.rpc('arbolia_submit_idea', {
  p_text: 'La recoleccion de residuos en el barrio no pasa desde hace semanas',
  p_category: 'ambiente',
  p_device_id: device + '-critica',
  p_author_name: null,
  p_age_range: null,
  p_revisar: revC.publicar === false,
  p_motivo: revC.motivo ?? null,
  p_tipo: revC.tipo ?? 'propuesta',
})
const filaC = Array.isArray(dC) ? dC[0] : dC
check('la crítica entra', !eC, eC ? eC.message : 'sin error')
check('se guarda con tipo critica', filaC?.tipo === 'critica', `tipo: ${filaC?.tipo}`)

const { data: st } = await db.rpc('arbolia_stats')
check('el contador de críticas la suma', (st?.criticas ?? 0) > 0, `criticas: ${st?.criticas}`)
check(
  'y NO cuenta como propuesta',
  (st?.propuestas ?? 0) + (st?.criticas ?? 0) === (st?.ideas ?? 0),
  `propuestas ${st?.propuestas} + criticas ${st?.criticas} = ideas ${st?.ideas}`,
)

await db.removeChannel(canal)

console.log(
  fallos === 0
    ? '\n  La cadena completa funciona de punta a punta.'
    : `\n  ${fallos} verificación(es) fallaron.`,
)
console.log(`\n  Quedó 1 idea de ensayo. Se borra con /admin -> Reiniciar estadísticas,`)
console.log(`  o con:  delete from ideas where device_id = '${device}';\n`)
process.exit(fallos === 0 ? 0 : 1)
