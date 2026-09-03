import * as THREE from 'three'

/**
 * Materia de los animales: la misma luz de siempre, pero con volumen.
 *
 * POR QUÉ EXISTE.
 *
 * Los tres animales usaban MeshBasicMaterial, que no tiene sombreado. Una
 * esfera con ese material no se dibuja como una esfera: se dibuja como un
 * CÍRCULO RELLENO. Toda la información de forma se pierde en el camino y
 * sólo sobrevive la silueta. Sumale que el aditivo apila brillo donde dos
 * partes se superponen —la cadera, el cuello, la base de la cola quedaban
 * más claras que el resto— y el resultado es exactamente lo que el equipo
 * describió: un muñeco inflable.
 *
 * No hace falta cambiar un vértice para arreglar eso. La forma estaba;
 * faltaba la luz que la revela.
 *
 * QUÉ NO CAMBIA, y es deliberado.
 *
 * Los animales siguen siendo DE LUZ. El comentario de Pajaro.tsx explica
 * el motivo mejor de lo que se puede resumir: en esta instalación todo lo
 * que brilla es una persona, y meter un animal con textura fotográfica
 * introduce un segundo idioma visual en una pantalla que tiene uno solo.
 * Este material no toca esa decisión. Da volumen, no materia: sombrea el
 * mismo tono que ya tenían, con la MISMA dirección de luz que la corteza
 * del árbol (ver energyMaterial.ts) para que el animal pertenezca a la
 * escena y no parezca pegado encima.
 *
 * LOS DOS TEMAS. En oscuro es luz aditiva y el sombreado modula cuánta luz
 * suma: el lomo se enciende y el vientre se apaga hasta fundirse con la
 * noche. En claro es tinta con mezcla normal y el sombreado hace lo que
 * hace un lápiz: el lomo claro, el vientre cerrado, y un borde oscuro que
 * cierra la silueta contra el papel.
 */

const vertexShader = /* glsl */ `
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vFogDepth;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 viewPos  = viewMatrix * worldPos;

    /*
     * La escala de los grupos de fauna es uniforme (TAMANO con setScalar),
     * así que alcanza con la parte 3x3 de la matriz y una normalización:
     * no hace falta la traspuesta de la inversa. Si algún día un animal
     * lleva escala no uniforme, esto hay que revisarlo o las sombras se
     * van a torcer.
     */
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vFogDepth = -viewPos.z;

    gl_Position = projectionMatrix * viewPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacidad;
  uniform float uClaro;
  uniform float uRimPower;
  uniform float uRimFuerza;

  uniform vec3  fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vFogDepth;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);

    /*
     * La misma luz principal que la corteza del árbol: alta, al frente y
     * un poco a la derecha. Que los dos usen la misma dirección es lo que
     * hace que la ardilla parezca estar EN el árbol y no delante de una
     * foto del árbol.
     */
    vec3  keyDir = normalize(vec3(0.45, 1.0, 0.35));
    float ndl    = dot(n, keyDir);

    /*
     * Luz envolvente en vez de lambert puro.
     *
     * El pelo dispersa: en un animal real la luz se derrama alrededor del
     * terminador en vez de cortarse en seco, y media cara en sombra
     * absoluta se lee como plástico. El exponente vuelve a juntar el
     * contraste que el envolvente afloja — sin él la forma queda lechosa,
     * que es el otro modo de parecer inflable.
     */
    float key = pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 1.7);

    // Relleno frío desde abajo y atrás: da el rebote del suelo y evita que
    // el vientre desaparezca del todo.
    float fill = max(dot(n, normalize(vec3(-0.45, -0.35, -0.6))), 0.0);

    float luz = 0.22 + key * 1.05 + fill * 0.26;

    vec3 col = uColor * luz;

    /*
     * Borde. Sobre negro se enciende: es lo que despega al animal del
     * fondo cuando queda contra una zona oscura de la copa. Sobre papel
     * hace al revés y OSCURECE, que es la línea de contorno del dibujo a
     * tinta: sin ella la silueta clara se derrite en el blanco.
     */
    float rim = pow(1.0 - max(dot(n, v), 0.0), uRimPower);
    col += uColor * rim * uRimFuerza * (1.0 - uClaro);
    col  = mix(col, col * 0.38, rim * 0.85 * uClaro);

    /*
     * Niebla, con el signo que corresponde a cada mezcla.
     *
     * La niebla de three mezcla hacia fogColor, y sobre un material
     * ADITIVO eso no atenúa: suma el color de la niebla, así que un animal
     * lejano brillaría MÁS. Con aditivo la única niebla correcta es
     * multiplicar hacia cero. Con mezcla normal sí corresponde el mix de
     * siempre.
     *
     * Los animales ya recibían niebla antes, porque MeshBasicMaterial la
     * trae encendida por omisión. Se conserva para no cambiar cómo se ven
     * en la mitad lejana de la órbita.
     */
    float bruma = smoothstep(fogNear, fogFar, vFogDepth);
    col = mix(col, fogColor, bruma * uClaro);
    col *= mix(1.0 - bruma, 1.0, uClaro);

    gl_FragColor = vec4(col, uOpacidad);
    #include <colorspace_fragment>
  }
`

export interface FaunaMaterialOptions {
  /** Tono del animal en el tema activo. Sale de su tabla APARIENCIA. */
  color: string
  /** Opacidad base del tema activo. */
  opacidad: number
  tema: 'claro' | 'oscuro'
  /**
   * Cuán angosto es el borde. Alto = filito; bajo = medio animal
   * encendido, que es el aspecto de neón que no se quiere.
   */
  rimPower?: number
  /** Cuánto suma el borde en tema oscuro. */
  rimFuerza?: number
}

export function createFaunaMaterial(options: FaunaMaterialOptions): THREE.ShaderMaterial {
  const claro = options.tema === 'claro'

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: THREE.UniformsUtils.merge([
      // Sin esto three no refresca fogColor/fogNear/fogFar y el shader
      // lee ceros: todo lo lejano se apagaría de golpe.
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(options.color) },
        uOpacidad: { value: options.opacidad },
        uClaro: { value: claro ? 1 : 0 },
        uRimPower: { value: options.rimPower ?? 2.6 },
        uRimFuerza: { value: options.rimFuerza ?? 0.55 },
      },
    ]),
    fog: true,
    transparent: true,
    blending: claro ? THREE.NormalBlending : THREE.AdditiveBlending,
    /*
     * La escritura de profundidad depende del tema, y no es un detalle.
     *
     * EN OSCURO va apagada, como estaba. El animal es luz aditiva: no tapa
     * nada, se suma a lo que hay detrás, y si escribiera profundidad les
     * robaría el z-buffer a las hojas que tiene atrás.
     *
     * EN CLARO va prendida, porque ahí el animal es tinta y sí tapa. Sin
     * esto se veían las cuatro patas A TRAVÉS del cuerpo: nada escribía
     * profundidad, así que las partes de atrás se dibujaban encima de las
     * de adelante según el orden de la malla y no según dónde están. Con el
     * material plano no se notaba —todo era del mismo color liso, así que
     * la superposición era invisible— y apareció recién al haber sombreado,
     * que es cuando cada parte tiene su propio valor.
     */
    depthWrite: claro,
    toneMapped: false,
    /*
     * SÓLO CARA FRONTAL, y esto es una restricción del shader, no una
     * preferencia. La normal se interpola tal como viene del vértice; en
     * una cara trasera apunta al revés, así que una malla a dos caras se
     * sombrearía invertida —iluminada donde debería estar en sombra—.
     *
     * Es exactamente el motivo por el que el pájaro no usa este material:
     * sus alas son triángulos sueltos con side: DoubleSide. Si alguna vez
     * hace falta, la solución es una línea en el fragment —invertir n
     * cuando !gl_FrontFacing— pero no se agrega hasta que haya algo que la
     * use.
     */
    side: THREE.FrontSide,
  })
}
