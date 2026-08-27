import { CATEGORIES } from './categories'
import type { CategorySlug, Idea } from './types'

/**
 * Modo demo: ideas simuladas para trabajar el 3D sin backend y para tener
 * algo digno en pantalla si en ExpoCom se corta la conexion antes de abrir.
 */
const SAMPLES: Array<{ text: string; category: CategorySlug; tipo?: 'critica' }> = [
  { text: 'Más espacios verdes en cada barrio', category: 'ambiente' },
  { text: 'Ciclovías seguras que conecten el centro con Yerba Buena', category: 'movilidad' },
  { text: 'Recuperar la Plaza Independencia para eventos de noche', category: 'espacios' },
  { text: 'WiFi libre en todas las plazas', category: 'tecnologia' },
  { text: 'Colectivos con horarios en tiempo real en la app', category: 'transporte' },
  { text: 'Ferias de artistas tucumanos los fines de semana', category: 'cultura' },
  { text: 'Veredas accesibles para sillas de ruedas', category: 'urbanismo' },
  { text: 'Talleres gratuitos de oficios en los CCB', category: 'comunidad' },
  { text: 'Más árboles nativos en avenidas principales', category: 'ambiente' },
  { text: 'Estacionamiento de bicis en escuelas y facultades', category: 'movilidad' },
  { text: 'Iluminación LED en pasajes oscuros', category: 'espacios' },
  { text: 'Trámites municipales 100% digitales', category: 'tecnologia' },
  { text: 'Carriles exclusivos para el transporte público', category: 'transporte' },
  { text: 'Murales de historia tucumana en el casco histórico', category: 'cultura' },
  { text: 'Plan de veredas parejas en el microcentro', category: 'urbanismo' },
  { text: 'Puntos verdes de reciclaje en cada barrio', category: 'ambiente' },
  { text: 'Juegos inclusivos en las plazas', category: 'espacios' },
  { text: 'Alertas de la ciudad por WhatsApp', category: 'tecnologia' },
  { text: 'Espacios para ensayar música y danza', category: 'cultura' },
  { text: 'Huertas comunitarias en terrenos vacíos', category: 'comunidad' },
  { text: 'Sombra natural en las paradas de colectivo', category: 'transporte' },
  { text: 'Peatonalizar más cuadras del centro los domingos', category: 'urbanismo' },
  { text: 'Sensores de calidad del aire abiertos al público', category: 'tecnologia' },
  { text: 'Más canchas y espacios deportivos abiertos', category: 'espacios' },

  /*
   * Reclamos.
   *
   * Sin estos, el modo demo no muestra nunca la mitad de la instalación:
   * las propuestas brotan como hojas y las raíces crecen solas, pero no se
   * ve caer un solo fruto. Y eso es justo lo que hay que poder calibrar
   * antes del armado, porque es el gesto nuevo.
   *
   * Uno de cada seis, más o menos como se espera que llegue en el stand:
   * la gente propone más de lo que reclama, pero reclama.
   */
  { text: 'El municipio no limpia el barrio hace meses', category: 'ambiente', tipo: 'critica' },
  { text: 'Las calles están rotas y nadie hace nada', category: 'urbanismo', tipo: 'critica' },
  { text: 'El colectivo pasa cada cuarenta minutos y viene lleno', category: 'transporte', tipo: 'critica' },
  { text: 'Hace dos años que reclamo por el alumbrado y no me responden', category: 'espacios', tipo: 'critica' },
  { text: 'La app del municipio no anda nunca', category: 'tecnologia', tipo: 'critica' },
]

let demoCounter = 0

export function makeDemoIdea(index = demoCounter++): Idea {
  const sample = SAMPLES[index % SAMPLES.length]
  const jitter = Math.floor(index / SAMPLES.length)
  return {
    id: `demo-${index}-${sample.category}-${jitter}`,
    text: sample.text,
    category: sample.category,
    device_id: `demo_device_${index % 37}`,
    status: 'visible',
    archived_at: null,
    created_at: new Date(Date.now() - (500 - index) * 1000).toISOString(),
    tipo: sample.tipo ?? 'propuesta',
  }
}

export function makeDemoHistory(count: number): Idea[] {
  return Array.from({ length: count }, (_, i) => makeDemoIdea(i))
}

export function demoCategoryCounts(ideas: Idea[]) {
  return CATEGORIES.map((c) => ({
    slug: c.slug,
    label: c.label,
    emoji: c.emoji,
    color: c.color,
    total: ideas.filter((i) => i.category === c.slug).length,
  }))
}
