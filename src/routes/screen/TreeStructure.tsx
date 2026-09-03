import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createEnergyMaterial } from './energyMaterial'
import {
  addTube,
  branchRadiusFor,
  createAccumulator,
  createTaperedTube,
  finalize,
  rootRadiusFor,
  trunkRadius,
} from './tubeBuilder'
import { getTreeModel } from './treeGeometry'
import type { Tema } from './temaEscena'
import type { GrowthProfile } from '../../lib/types'

/** Cuánto dura el resplandor de las raíces tras una crítica, en segundos. */
const PULSO_SEG = 2.8

/**
 * La corteza, en sus dos soportes.
 *
 * Los valores de `oscuro` son EXACTAMENTE los que había: el modo oscuro no
 * cambia un píxel, y los motivos de cada uno están en los comentarios de
 * abajo, donde se decidieron.
 *
 * Los de `claro` no son "los mismos más oscuros": son el mismo rol de
 * valor invertido, igual que hace la paleta institucional al pasar de LED
 * a papel. En oscuro la corteza tiene que ser lo bastante clara para no
 * leerse como una silueta recortada contra el fondo; en claro tiene que
 * ser lo bastante oscura para no leerse como una mancha lavada sobre el
 * papel. El TONO azulado se mantiene en los dos: es lo que hace que la
 * madera pertenezca a la misma familia que el resto de la marca.
 *
 * Los colores de energía —celeste del tronco, verde de las raíces, el
 * color de cada área— NO se tocan: son identidad y significan algo.
 */
const CORTEZA = {
  oscuro: { tronco: '#26485f', raices: '#0e1a24', ramas: '#1e3a4d' },
  claro: { tronco: '#1c3446', raices: '#1b2c3a', ramas: '#203a4d' },
} as const

interface Props {
  growth: GrowthProfile
  /** Fondo sobre el que va el árbol. Cambia la corteza, no la energía. */
  tema?: Tema
  /** Categoría que está recibiendo una idea ahora mismo: su rama se enciende. */
  highlightSlug: string | null
  /**
   * Sube de a uno cada vez que una crítica toca la tierra.
   *
   * El efecto se dispara acá adentro y no desde afuera por una razón
   * concreta: este useFrame reescribe uIntensity y uReveal de las raíces en
   * CADA cuadro. Cualquier componente que intentara encenderlas desde fuera
   * vería su valor borrado al cuadro siguiente.
   */
  pulsoRaices: number
}

/**
 * Raíces (comunidad) → tronco (ciudad) → ramas (áreas).
 *
 * Cada categoría ramifica en unas 25 ramitas, así que son ~200 tubos en
 * total. Se fusionan en 10 mallas (tronco + raíces + 8 áreas) para no
 * gastar doscientas llamadas de dibujo en una PC de stand.
 */
export default function TreeStructure({
  growth,
  highlightSlug,
  pulsoRaices,
  tema = 'oscuro',
}: Props) {
  const model = useMemo(() => getTreeModel(), [])
  const corteza = CORTEZA[tema]

  const trunkGeo = useMemo(
    () => createTaperedTube(model.trunk, trunkRadius, 40, 14),
    [model],
  )

  /*
   * Detalle de dibujo por nivel de raíz.
   *
   * Con cuatro niveles hay unas quinientas raíces y la mitad son cabellera
   * fina. Darles a todas la resolución de una madre —26 tramos y 8 lados—
   * sería gastar treinta mil vértices en tubos de dos píxeles de ancho,
   * donde ningún lado extra se puede llegar a ver. Bajando el detalle con
   * el nivel, la maraña entera cuesta parecido a lo que costaban las
   * dieciséis madres solas.
   *
   * `thickness` no es geometría: es el atributo que el shader usa para
   * decidir cuánto brilla cada tramo. Baja con el nivel porque las raíces
   * finas son las que llevan la energía, igual que las ramitas nuevas
   * arriba.
   */
  const rootsGeo = useMemo(() => {
    const detalle = [
      { segmentos: 26, lados: 8, grosor: 0.95 },
      { segmentos: 14, lados: 6, grosor: 0.62 },
      { segmentos: 9, lados: 5, grosor: 0.4 },
      { segmentos: 6, lados: 4, grosor: 0.22 },
    ]

    const acc = createAccumulator()
    model.roots.forEach((root) => {
      const d = detalle[Math.min(detalle.length, Math.max(1, root.level)) - 1]
      // uvStart/uvEnd encadenan cada tramo con su madre en un solo
      // recorrido, así el frente de crecimiento avanza continuo por toda
      // la maraña en vez de saltar de un nivel al siguiente.
      addTube(acc, root.curve, (t) => rootRadiusFor(root.level, t), {
        segments: d.segmentos,
        radialSegments: d.lados,
        thickness: d.grosor,
        uvStart: root.uvStart,
        uvEnd: root.uvEnd,
      })
    })
    return finalize(acc)
  }, [model])

  const branchGeos = useMemo(
    () =>
      model.branches.map((branch) => {
        const acc = createAccumulator()

        branch.twigs.forEach((twig) => {
          // El grosor relativo baja con el nivel: el shader lo usa para que
          // las ramitas finas brillen más que la madera gruesa.
          const thickness = 1 - (twig.level - 1) / 4

          addTube(acc, twig.curve, branchRadiusFor(twig.level, twig.radius), {
            segments: twig.segments,
            radialSegments: Math.max(4, 8 - twig.level),
            thickness,
            // Encadena los niveles: el frente de crecimiento avanza del
            // tronco a la punta pasando de una rama a su hija sin saltos.
            uvStart: twig.uvStart,
            uvEnd: twig.uvEnd,
            // El voladizo va aparte y encadenado por axila, no por nivel:
            // es lo que mantiene pegada la hija a la madre bajo el viento.
            spanStart: twig.spanStart,
            spanEnd: twig.spanEnd,
          })
        })

        return finalize(acc)
      }),
    [model],
  )

  const trunkMaterial = useMemo(
    () =>
      createEnergyMaterial({
        energyColor: '#3cb4f0',
        /*
         * La corteza del tronco.
         *
         * Era #12212e, que sobre el fondo #050a12 de la instalación se lee
         * negro: el tronco quedaba como una silueta recortada, sin volumen,
         * y era lo primero que saltaba mirando el render a resolución de LED.
         * El shader además lo oscurece por grosor —a propósito, las ramitas
         * finas van más claras— así que el tronco es la parte que más
         * necesita el valor de partida alto.
         *
         * En claro el razonamiento es el mismo con el signo cambiado: ver
         * la tabla CORTEZA arriba.
         */
        barkColor: corteza.tronco,
        speed: 0.1,
        pulseCount: 1.7,
        direction: 1,
        rimPower: 3.6,
        // El tronco cede muy poco: es la parte gruesa del árbol.
        windStrength: 0,
        tema,
      }),
    [corteza, tema],
  )

  const rootMaterial = useMemo(
    () =>
      createEnergyMaterial({
        energyColor: '#25d366',
        barkColor: corteza.raices,
        speed: 0.09,
        pulseCount: 1.4,
        // Las raíces empujan energía HACIA el tronco: la comunidad alimenta.
        direction: -1,
        rimPower: 3.9,
        // Las raices se revelan al crecer: el corte deja el tubo abierto.
        doubleSided: true,
        reveal: 0.4,
        // Bajo tierra no hay viento.
        windStrength: 0,
        tema,
      }),
    [corteza, tema],
  )

  const branchMaterials = useMemo(
    () =>
      model.branches.map((branch) =>
        createEnergyMaterial({
          energyColor: branch.color,
          /*
           * Se aclaró de #111f2b, que sobre el fondo #050a12 era casi el
           * fondo mismo.
           *
           * Antes no se notaba porque la copa arrancaba con miles de hojas
           * encima: las ramas eran una sombra debajo del follaje y estaba
           * bien que lo fueran. Ahora el árbol arranca pelado y el esqueleto
           * es TODO lo que hay en pantalla el primer día, así que tiene que
           * leerse solo. El shader oscurece por grosor, así que las ramitas
           * finas siguen siendo las más claras y la copa vacía se lee como
           * una trama y no como una masa.
           */
          barkColor: corteza.ramas,
          speed: 0.15,
          pulseCount: 1.2,
          direction: 1,
          rimPower: 3.4,
          // Las ramas son las que se mecen de verdad.
          windStrength: 0.1,
          tema,
        }),
      ),
    [model, corteza, tema],
  )

  const allMaterials = useRef<THREE.ShaderMaterial[]>([])
  allMaterials.current = [trunkMaterial, rootMaterial, ...branchMaterials]

  /*
   * Cuánto de las raíces está revelado ahora mismo.
   *
   * Existe por el cambio de tema. Los materiales se rehacen cuando cambia,
   * y uno recién creado arranca en reveal 0.4 mientras el bucle lo lleva de
   * vuelta a growth.rootReach a 0.015 por cuadro: con la feria avanzada eso
   * son varios segundos de raíces encogiéndose y volviendo a crecer, que se
   * lee como un error de render justo cuando el operador toca Ctrl+L
   * delante del público. Guardado acá, el material nuevo empieza donde
   * estaba el viejo y el cambio de fondo no toca el crecimiento.
   */
  const revelado = useRef(0.4)
  useLayoutEffect(() => {
    rootMaterial.uniforms.uReveal.value = revelado.current
  }, [rootMaterial])

  /*
   * Estado del pulso de las raíces.
   *
   * En segundos y no en cuadros: los demás lerps de la escena usan factor
   * por cuadro, así que su duración real cambia con el framerate. Este
   * efecto tiene que durar lo mismo en la máquina de desarrollo y en la PC
   * del stand a 30 fps, porque es lo que la gente va a estar mirando.
   */
  const pulso = useRef({ visto: 0, restante: 0 })

  /*
   * Sin dispose() manual, a propósito.
   *
   * Geometrías y materiales viven en useMemo, así que sobreviven a un
   * remontaje. Un efecto de limpieza que los destruya deja objetos ya
   * liberados en el segundo montaje y el árbol desaparece sin ningún error.
   * Cuando el <Canvas> se desmonta de verdad, R3F descarta el renderer y
   * libera todo lo de la GPU igual.
   */

  useFrame((_, delta) => {
    // Una crítica acaba de tocar la tierra.
    if (pulsoRaices !== pulso.current.visto) {
      pulso.current.visto = pulsoRaices
      pulso.current.restante = PULSO_SEG
    }
    if (pulso.current.restante > 0) {
      pulso.current.restante = Math.max(0, pulso.current.restante - delta)
    }
    // Sube de golpe y se apaga despacio: el reclamo llega y queda resonando.
    const p = pulso.current.restante / PULSO_SEG
    const brilloExtra = p * p * 2.6

    for (const mat of allMaterials.current) {
      mat.uniforms.uTime.value += delta
      mat.uniforms.uWindTime.value += delta
    }

    trunkMaterial.uniforms.uIntensity.value = growth.glowIntensity * (1 + brilloExtra * 0.25)
    rootMaterial.uniforms.uIntensity.value = growth.glowIntensity * 0.85 + brilloExtra

    // Mientras dura el pulso la energía circula más rápido hacia el tronco:
    // se ve que las raíces le están mandando algo al árbol.
    rootMaterial.uniforms.uSpeed.value = 0.09 + brilloExtra * 0.22

    // Las raices se extienden con la participacion. Interpolado y lento:
    // tienen que verse avanzar, no aparecer de un salto al cruzar un umbral.
    revelado.current = THREE.MathUtils.lerp(
      rootMaterial.uniforms.uReveal.value,
      growth.rootReach,
      0.015,
    )
    rootMaterial.uniforms.uReveal.value = revelado.current

    // La rama de la categoría entrante se enciende mientras dura el viaje.
    model.branches.forEach((branch, i) => {
      const mat = branchMaterials[i]
      const active = highlightSlug === branch.slug
      const target = active ? growth.glowIntensity * 2.4 : growth.glowIntensity

      mat.uniforms.uIntensity.value = THREE.MathUtils.lerp(
        mat.uniforms.uIntensity.value,
        target,
        active ? 0.2 : 0.05,
      )
      mat.uniforms.uSpeed.value = active ? 0.46 : 0.15
    })
  })

  return (
    <group>
      {/* Raíces: la comunidad */}
      <mesh geometry={rootsGeo} material={rootMaterial} />

      {/* Tronco: la ciudad */}
      <mesh geometry={trunkGeo} material={trunkMaterial} />

      {/* Ramas: las áreas */}
      {branchGeos.map((geo, i) => (
        <mesh key={model.branches[i].slug} geometry={geo} material={branchMaterials[i]} />
      ))}
    </group>
  )
}
