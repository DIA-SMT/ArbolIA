import * as THREE from 'three'

/**
 * Herramientas de forma para la fauna.
 *
 * Los tres animales estaban armados con el mismo procedimiento: apilar
 * esferas escaladas y cilindros, y fusionarlos. Eso da siluetas correctas
 * de lejos y, de cerca, un muñeco de nieve con palitos —que es exactamente
 * lo que se ve en el banco de pruebas—. El problema no es el detalle que
 * falta sino la CONTINUIDAD que falta: en un animal real el cuello sale
 * del pecho, el pecho se estrecha en la cintura y la cintura se abre en la
 * grupa, todo como una sola superficie. Dos esferas pegadas tienen una
 * garganta en el medio, y esa garganta es la firma visual de lo inflable.
 *
 * Acá vive lo que hace falta para construirlos como superficies continuas:
 * un tubo de radio variable a lo largo de una curva, y un miembro con
 * quiebre en la articulación. Nada de esto es nuevo en el proyecto —el
 * tronco del árbol se construye así desde el principio, ver tubeBuilder—;
 * lo nuevo es que la fauna lo use.
 */

/**
 * Une varias geometrías en una sola malla, recalculando normales.
 *
 * Acepta geometrías CON y SIN índice, y esa segunda mitad no estaba.
 *
 * La versión que había —copiada igual en Ardilla y en Perrito— hacía
 * `if (i) for (...) idx.push(...)`: si una geometría no traía índice, sus
 * vértices se copiaban al buffer pero NINGÚN triángulo suyo entraba en la
 * malla final. Desaparecía sin avisar, dejando sus vértices adentro como
 * peso muerto.
 *
 * Con esferas y conos de three no se notaba nunca, porque todos vienen
 * indexados. Apareció al sumar las tapas de tuboPerfilado, que se arman a
 * mano como triángulos sueltos: los tubos quedaban abiertos por las puntas
 * y encima pagaban los vértices de una tapa que no se dibujaba. No saltó a
 * la vista porque los materiales son de una sola cara y casi ninguna punta
 * queda mirando a la cámara — o sea, el peor tipo de error: el que
 * funciona hasta que un día no.
 */
export function fusionar(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = geos.reduce(
    (n, g) => n + (g.attributes.position as THREE.BufferAttribute).count,
    0,
  )
  const pos = new Float32Array(total * 3)
  const idx: number[] = []
  let off = 0
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute
    pos.set(p.array as Float32Array, off * 3)
    const i = g.getIndex()
    if (i) {
      for (let k = 0; k < i.count; k++) idx.push(i.getX(k) + off)
    } else {
      // Sin índice, los vértices YA están en orden de triángulo: alcanza
      // con numerarlos corridos por el desplazamiento de esta geometría.
      for (let k = 0; k < p.count; k++) idx.push(k + off)
    }
    off += p.count
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

export interface TuboOpciones {
  /** Anillos a lo largo del recorrido. Manda la suavidad de la curva. */
  segmentos?: number
  /** Vértices por anillo. Manda lo redondo que se ve el corte. */
  lados?: number
  /** Radio de referencia; el perfil lo multiplica. */
  radio?: number
  /** Cierra los extremos con una tapa. */
  tapas?: boolean
  /**
   * Aplastado lateral, punto por punto del recorrido. 1 deja la sección
   * redonda; 0.4 la deja tres veces más alta que ancha.
   *
   * Va acá y no como un scale() al final por un motivo anatómico: casi
   * ninguna parte de un animal es igual de chata en todo su largo. La cola
   * de la ardilla es el caso claro —arranca siendo un rabo REDONDO y recién
   * después se abre en una pluma plana— y aplastando la malla entera al
   * final, el rabo quedaba tan chato como el pelo y la unión con la grupa
   * se veía como una cinta.
   *
   * Sólo tiene sentido cuando la curva vive en el plano YZ, que es el caso
   * de todo lo que se construye acá: ahí los anillos son perpendiculares a
   * ese plano y escalar X aplasta exactamente de lado a lado.
   */
  aplanarX?: (t: number) => number
}

/**
 * Ondulación fina para romper un contorno.
 *
 * Una curva perfectamente suave se lee como una pieza torneada, y ese es
 * el último resto de "juguete" que queda una vez que la forma general está
 * bien. Un poco de ondulación de alta frecuencia sobre el perfil no se
 * distingue como ondas: a la distancia de la instalación se lee como pelo,
 * que es de lo que están hechos estos bichos.
 *
 * Determinista a propósito —un seno, no ruido al azar— así el animal es
 * idéntico en cada carga y en cada máquina del stand.
 */
export function pelaje(t: number, ciclos: number, amplitud: number): number {
  return 1 + Math.sin(t * Math.PI * ciclos) * amplitud
}

/**
 * Un tubo de radio variable a lo largo de una curva.
 *
 * Es el ladrillo con el que se arman los torsos y los miembros. La curva
 * da el EJE —la línea que recorre el animal por dentro— y el perfil da el
 * bulto en cada punto de ese eje. Un torso deja de ser una suma de bultos
 * y pasa a ser un solo volumen con cintura.
 *
 * El perfil recibe t de 0 a 1 y devuelve un multiplicador del radio.
 * Devolver 0 en los extremos cierra la forma en punta.
 */
export function tuboPerfilado(
  puntos: THREE.Vector3[],
  perfil: (t: number) => number,
  opciones: TuboOpciones = {},
): THREE.BufferGeometry {
  const segmentos = opciones.segmentos ?? 20
  const lados = opciones.lados ?? 10
  const radio = opciones.radio ?? 1

  const curva = new THREE.CatmullRomCurve3(puntos)
  const geo = new THREE.TubeGeometry(curva, segmentos, radio, lados, false)

  /*
   * TubeGeometry deja los vértices en anillos consecutivos de (lados + 1)
   * puntos, uno por cada uno de los (segmentos + 1) pasos. Cada anillo se
   * escala respecto de su punto de la curva, así el perfil deforma el
   * grosor sin mover el eje.
   */
  const pos = geo.attributes.position as THREE.BufferAttribute
  const centro = new THREE.Vector3()
  const v = new THREE.Vector3()

  for (let i = 0; i <= segmentos; i++) {
    const t = i / segmentos
    const k = perfil(t)
    const chato = opciones.aplanarX ? opciones.aplanarX(t) : 1
    curva.getPointAt(t, centro)
    for (let j = 0; j <= lados; j++) {
      const idx = i * (lados + 1) + j
      v.fromBufferAttribute(pos, idx)
      // Se opera sobre el desvío respecto del eje, no sobre la posición
      // absoluta: así el aplastado no arrastra el recorrido de la curva.
      v.sub(centro)
      v.multiplyScalar(k)
      v.x *= chato
      v.add(centro)
      pos.setXYZ(idx, v.x, v.y, v.z)
    }
  }

  pos.needsUpdate = true

  if (opciones.tapas) {
    /*
     * Tapas planas en los extremos.
     *
     * Sin material aditivo no harían falta —un tubo abierto se ve cerrado
     * si nunca se le mira la boca— pero acá el animal no escribe
     * profundidad y se lo ve desde todos lados en la órbita: un extremo
     * abierto deja ver el interior del tubo y se lee como un agujero. Es
     * un abanico de triángulos alrededor del punto del eje.
     */
    return fusionar([geo, tapa(geo, 0, lados), tapa(geo, segmentos, lados)])
  }

  geo.computeVertexNormals()
  return geo
}

/** Abanico de triángulos que cierra el anillo `anillo` del tubo. */
function tapa(geo: THREE.BufferGeometry, anillo: number, lados: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const base = anillo * (lados + 1)

  const centro = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let j = 0; j < lados; j++) {
    v.fromBufferAttribute(pos, base + j)
    centro.add(v)
  }
  centro.divideScalar(lados)

  const vertices: number[] = []
  for (let j = 0; j < lados; j++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, base + j)
    const b = new THREE.Vector3().fromBufferAttribute(pos, base + ((j + 1) % lados))
    vertices.push(centro.x, centro.y, centro.z, a.x, a.y, a.z, b.x, b.y, b.z)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  g.computeVertexNormals()
  return g
}

export interface MiembroOpciones {
  /** Largo del segmento de arriba: fémur o húmero. */
  alto: number
  /** Largo del segmento de abajo: tibia o antebrazo. */
  bajo: number
  /**
   * Cuánto se adelanta la articulación respecto de la vertical, en
   * unidades. Es LO que convierte un palo en una pata: sin quiebre no hay
   * rodilla, y sin rodilla el animal camina como una mesa.
   *
   * Positivo lleva la articulación hacia +Z (atrás en el espacio de estos
   * animales, que miran a -Z): es el corvejón de una pata trasera. En
   * negativo queda el codo de una delantera.
   */
  quiebre: number
  /** Radio en la cadera, en la articulación y en el tobillo. */
  radioCadera: number
  radioMedio: number
  radioTobillo: number
  /** Largo del pie hacia adelante. 0 lo deja sin pie. */
  pie?: number
}

/**
 * Un miembro con quiebre en la articulación y pie apoyado.
 *
 * Reemplaza al cilindro recto, que es el otro gran responsable del aspecto
 * de juguete: ningún animal tiene las patas rectas ni terminadas en un
 * corte plano. El eje va cadera → articulación → tobillo → punta del pie,
 * y el perfil adelgaza hacia abajo, que es como se ve una pata de verdad
 * —masa arriba, hueso abajo—.
 *
 * El origen queda en la CADERA, igual que los cilindros que reemplaza, así
 * que las rotaciones del galope y del trote siguen funcionando igual.
 */
export function miembro(o: MiembroOpciones): THREE.BufferGeometry {
  const pie = o.pie ?? 0

  const puntos = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -o.alto, o.quiebre),
    new THREE.Vector3(0, -o.alto - o.bajo, 0),
  ]

  if (pie > 0) {
    // El pie sale hacia adelante desde el tobillo, apenas por encima del
    // suelo: es lo que da el apoyo y cierra la silueta abajo.
    puntos.push(new THREE.Vector3(0, -o.alto - o.bajo - 0.012, -pie))
  }

  const conPie = pie > 0
  /*
   * Perfil a lo largo del miembro. Los tramos están medidos sobre el
   * recorrido completo, así que con pie el reparto cambia: el tobillo deja
   * de estar en 1.0 y pasa a estar alrededor de 0.72.
   */
  const tobillo = conPie ? 0.72 : 1

  return tuboPerfilado(
    puntos,
    (t) => {
      if (t <= 0.5) {
        // Cadera → articulación: la masa del muslo, que se afina al bajar.
        return THREE.MathUtils.lerp(o.radioCadera, o.radioMedio, t / 0.5)
      }
      if (t <= tobillo) {
        const k = (t - 0.5) / (tobillo - 0.5)
        return THREE.MathUtils.lerp(o.radioMedio, o.radioTobillo, k)
      }
      // El pie: se afina hacia la punta pero no llega a cero, porque una
      // pata terminada en aguja se lee como insecto.
      const k = (t - tobillo) / (1 - tobillo)
      return THREE.MathUtils.lerp(o.radioTobillo, o.radioTobillo * 0.55, k)
    },
    { segmentos: conPie ? 16 : 12, lados: 8, radio: 1, tapas: true },
  )
}
