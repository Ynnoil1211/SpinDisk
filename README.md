# SpinDisk

Tocadiscos de escritorio para tablet Android en horizontal. No reproduce música: se
engancha a lo que ya suena en Spotify, YouTube Music o YouTube y lo convierte en un disco
de vinilo que gira, un brazo que se posa y una funda que se puede voltear.

> Estado: **F0 a F8 cerradas** (entorno, escena, física medida, consola probada, reverso con
> letra sincronizada, reposo con reloj, motor de sonido verificado, shell nativo y **APK que se
> compila en la nube**). Queda instalar ese APK en la tablet y medir RAM y batería. Ver
> [plan.md](plan.md).

## Cómo se trabaja

No hace falta Android Studio, ni Java, ni bundler. Sólo Node 20+.

```bash
npm install          # dependencias de desarrollo: typescript y @napi-rs/canvas
node scripts/dev.mjs # sirve http://127.0.0.1:5173 y recompila al guardar
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | compila, sirve `dist/` y recarga el navegador al guardar |
| `npm run build` | compila `src/` a `dist/` |
| `npm start` | sirve `dist/` sin vigilancia |
| `npm run typecheck` | comprueba tipos sin escribir nada |
| `npm run preview -- track` | dibuja la escena a PNG sin navegador |
| `npm run sim` | corre el banco de física y escribe la tira de fotogramas |
| `npm run ui` | corre el banco de consola y panel F2 sobre un DOM mínimo |
| `npm run audio` | revisa el grafo del motor Foley con un AudioContext falso |
| `npm run native` | copia `dist/` a `android/app/src/main/assets/www` y pesa el resultado |
| `npm run native:check` | verifica el contrato TypeScript ↔ Kotlin sin compilar nada (30) |
| `npm run bridge` | prueba el puente nativo y la escena contra un `SpinDiskNative` falso (29) |
| `npm run sandbox` | comprueba que el simulador encadena canciones y respeta Free/Premium (9) |
| `npm run perf` | mide el dibujo: girando ~1,2 ms, dormido ~1,1 ms |

En el navegador, **F2** abre el panel de pruebas: busca una canción real (portada y letra
incluidas), cambia entre Spotify Free y Premium, y simula cinco saltos seguidos.

## Escenarios de captura

`node scripts/preview.mjs <escenario>` deja un PNG en `docs/captures/`:

| Escenario | Qué muestra |
| --- | --- |
| `desk` | la mesa vacía con la funda en blanco |
| `track` | disco fuera, brazo sobre el surco, portada real |
| `flip` | el reverso con la letra sincronizada |
| `flipmid` | el canto del cartón a mitad del giro |
| `liner` | liner notes con el verso actual subrayado |
| `nolyrics` | ficha técnica cuando la letra no está en el archivo |
| `instrumental` | ficha técnica de una pieza instrumental |
| `clock` | modo reloj de escritorio tras un minuto en pausa |
| `clocktag` | reloj de día: la hora en un papelito mientras suena |
| `clocksleep` | dormirse con la letra a la vista (la funda se gira sola) |
| `black` `cream` `glass` | las otras tres texturas del vinilo |
| `free` | el brazo rebotando en una cuenta gratuita |

Para ver cómo queda en otro tamaño de pantalla, `SPINDISK_VIEWPORT=850x393 node scripts/preview.mjs track`
dibuja la escena como en un móvil tumbado. En 16:10 (la tablet) sale exactamente como se diseñó; en
pantallas más anchas el motor agranda la escena un 18 % y recorta un poco de aire arriba y abajo.

`node scripts/sim.mjs` mide la física en cambio: 62 comprobaciones con umbrales (freno, arranque,
geometría del brazo, giro con el dedo, antirrebote, toque seco, volteo de la funda, reposo,
atajo al reloj) y una tira de cuatro fotogramas en `docs/captures/f2-freno.png`.
`node scripts/uitest.mjs` hace lo mismo con la consola y el panel F2: 89 comprobaciones sobre el
`index.html` real con un DOM mínimo y reloj falso. Los dos terminan en verde o con código 1.

El panel se abre deslizando desde el borde inferior (o tocando la esquina superior izquierda) y
**se cierra deslizándolo hacia abajo**, además de a los 3 s sin tocarlo. La franja que lo abre se
mide en píxeles de pantalla (6 % del alto, entre 38 y 64 px), y la primera vez que se abre la app se
enseña solo, porque la pista es una rayita de 3 px y nadie adivina que está ahí.

El panel F2 incluye un botón **«Modo reloj ahora»**: adelanta el minuto de reposo para ver el
reloj de escritorio sin esperar, y muestra la cuenta atrás real cuando está en pausa.

## Cómo está hecho

```
src/core      contrato con la fuente de datos (PlayerBridge) y preferencias
src/bridge    sandbox (navegador) y android (puente SpinDiskNative de la tablet)
src/scene     física del tocadiscos, vinilo, funda y composición
src/render    primitivas de dibujo: ruido, mármol, sombreado, texto curvo
src/theme     armonización de la paleta a tierra y pastel
src/ui        consola, panel de pruebas y avisos
android/      shell nativo: una Activity con WebView, el servicio de MediaSession y Gradle
scripts/      build, servidor, captura por Skia y los cinco bancos de pruebas
```

El motor visual no sabe de dónde viene la canción: sólo recibe un objeto con título,
artista, portada, tiempo y capacidades. Eso permite desarrollar el 95 % en el navegador y
enchufar Android después con un único puente Kotlin.

La tablet no lleva Capacitor ni AndroidX: el APK es una `Activity` con una `WebView` y un
`NotificationListenerService` propio, sin una sola dependencia de terceros. Por eso el peso
publicado de la interfaz es de 160 KB y el motor gráfico lo pone la propia tablet.

## El APK

`.github/workflows/build-apk.yml` compila la interfaz, verifica el contrato, copia `dist/` a los
assets y ejecuta `gradle :app:assembleDebug` en un runner de GitHub con JDK 17 y el SDK de
Android. El APK queda como artefacto descargable en la pestaña **Actions**, ya con nombre
`spindisk.apk` (el flujo lo renombra para no llegar a la tablet como `app-debug.apk`).

**Ya está compilado.** El primer `push` bastó: la
[ejecución 40427965945](https://github.com/Ynnoil1211/SpinDisk/actions/runs/40427965945) terminó
en verde en 98 s con las doce etapas correctas, y el artefacto **`spindisk-apk` pesa 0,83 MB**.
Para instalarlo: descargar el `.zip` del artefacto, descomprimirlo, pasar el `spindisk.apk` a la
tablet e instalarlo aceptando el origen desconocido. La primera vez que se abre pide **acceso a
las notificaciones**, que es lo único que le permite saber qué suena. Si **Play Protect** lo
bloquea (lo normal con cualquier app de fuera de la tienda), en `docs/apk.md` están los tres
caminos: `adb install`, «instalar de todas formas» o desactivar el análisis un momento.

El flujo guarda en caché `~/.android/debug.keystore`, así que todas las compilaciones firman con
la misma clave y una actualización se instala encima de la anterior.

En este PC no hay JDK ni SDK: el Kotlin se escribió y revisó a mano, y la compilación de verdad
la hizo el runner.

## Presupuesto

Menos de 15 MB instalados y 60 MB de RAM: dibujo 2D por hardware, sin motor 3D, sin
descargar audio, y un solo dibujo por minuto cuando el tocadiscos descansa.
