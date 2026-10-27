# SpinDisk · Plan de construcción

> Tocadiscos de escritorio para tablet Android en horizontal. No reproduce música:
> acompaña visual y acústicamente lo que ya suena en Spotify, YouTube Music o YouTube.

Este documento es el contrato de trabajo. Las fases se construyen **de una en una**,
cada una con un criterio de aceptación verificable. Nada se da por terminado sin verlo.

---

## 1. Principios

1. **El render no sabe de dónde viene la música.** Todo entra por un único contrato
   (`TrackSnapshot` + `PlayerBridge`). En el PC lo alimenta un simulador; en la tablet,
   `MediaSession`. Cambiar de uno a otro no toca una línea de dibujo.
2. **Cero motores pesados.** Canvas 2D acelerado por hardware + WebView del sistema.
   Sin WebGL, sin Three.js, sin reproductor propio, sin descargar audio.
3. **Todo se prueba en el navegador.** El 95% del producto (arte, física, gestos, panel,
   letras, reloj) se valida con `F2` sin tocar la tablet ni instalar Android Studio.
4. **Nada de Java local.** El `.apk` lo compila GitHub Actions en la nube.
5. **Presupuesto de recursos como requisito, no como deseo:** < 15 MB instalados,
   < 60 MB de RAM, 1 dibujo por minuto en reposo.

El presupuesto manda sobre la estética: si una idea visual cuesta batería, se busca otra
forma de conseguir la misma sensación.

---

## 2. Arquitectura en una imagen

```
┌──────────────────────────────────────────────────────────────┐
│  Motor visual (lo que ves y tocas)                           │
│  Canvas 2D · escena, física, gestos, panel                     │
│  No conoce Android ni Spotify                                  │
└───────────────▲──────────────────────────┬───────────────────┘
                │ TrackSnapshot            │ play/pause/next/prev/seek
                │ (título, artista,        │
                │  portada, tiempo,        │
                │  duración, canSeek)      │
┌───────────────┴──────────────────────────▼───────────────────┐
│  PlayerBridge (contrato único)                                │
│   ├─ SandboxBridge  → navegador: iTunes + LRCLIB + reloj local │
│   └─ AndroidBridge  → tablet: MediaSessionPlugin.kt (Kotlin)   │
└──────────────────────────────────────────────────────────────┘
```

`SandboxBridge` (menú `F2`) y `AndroidBridge` (notificación multimedia real) son
intercambiables. El motor elige uno al arrancar con una comprobación de plataforma.

El estado del tocadiscos vive en una máquina (`Turntable`) que **no dibuja**: mantiene
grado de giro, posición del disco, ángulo del brazo, inversión de la funda y estados de
reposo. El render lee ese estado cada frame. Esto permite probar la física sin píxeles y
el dibujo sin física.

---

## 3. Estructura del proyecto

```
SpinDisk/
├─ index.html               Estructura del lienzo y de la consola
├─ src/
│  ├─ main.ts               Arranque, elección de puente, bucle adaptativo, gestos globales
│  ├─ styles.css            Consola translúcida, sandbox, avisos
│  ├─ core/
│  │  ├─ types.ts           Contrato: TrackSnapshot, PlayerBridge, Preferences
│  │  └─ store.ts           Preferencias en localStorage
│  ├─ bridge/
│  │  ├─ sandbox.ts         Falso Android: búsqueda real iTunes, reloj simulado, burst
│  │  ├─ android.ts         Puente a Capacitor → MediaSessionPlugin.kt
│  │  └─ lyrics.ts          LRCLIB: consulta, parseo LRC, caché en disco
│  ├─ scene/
│  │  ├─ layout.ts          Geometría del mueble: funda, plato, brazo; hit-testing
│  │  ├─ turntable.ts       Física, gestos y estados (freno, debounce, reposo, reloj)
│  │  ├─ disc.ts            Vinilo: mármol procedural, surcos, galleta impresa
│  │  ├─ sleeve.ts          Funda: frente de cartón, reverso de letras, reloj impreso
│  │  └─ renderer.ts        Composición de la escena y caché de sprites
│  ├─ render/canvas.ts      Primitivas: sombras, grano, texto curvo, mármol fBm
│  ├─ theme/palette.ts      Motor cromático "tierra y pastel" desde la portada
│  ├─ audio/foley.ts        Estática, caída de aguja y click del motor (WebAudio)
│  ├─ ui/
│  │  ├─ panel.ts           Consola de control ocultable (3 s)
│  │  ├─ sandbox.ts         Panel F2
│  │  └─ toast.ts           Avisos efímeros
│  └─ util/math.ts          Interpolación, tiempos, PRNG determinista
├─ android/                 Shell Kotlin (se versiona; lo generado no)
└─ .github/workflows/       Compilación del .apk en la nube
```

---

## 4. Estado actual (honesto)

**El motor completo está escrito, compila sin errores, dibuja, su física está medida, el shell
nativo está escrito y el APK ya se compila en la nube.** F0 a F8 cerraron; F9 sigue abierta en lo
que sólo se puede medir con la tablet en la mano (RAM y batería) y en la instalación. La capa DOM
ya se mira en el navegador del usuario, que encontró tres fallos de
sensación que ningún banco veía: el giro iba al revés del dedo, giraba demasiado rápido y un toque
en el vinilo dejaba la música en pausa para siempre. Hay cinco bancos, ninguno necesita navegador:
`scripts/sim.mjs` (62 comprobaciones de física, avanza el tiempo a mano), `scripts/uitest.mjs` (83
de la consola y del panel F2, que
ejecutan su código real contra el `index.html` verdadero con un DOM mínimo),
`scripts/audiotest.mjs` (43 del motor Foley sobre un `AudioContext` falso),
`scripts/nativecheck.mjs` (30 del contrato entre el TypeScript y el Kotlin, por análisis estático)
y `scripts/nativebridge.mjs` (29 del puente nativo con un `window.SpinDiskNative` falso). Las
capturas de `docs/captures/` las produce `scripts/preview.mjs`, que dibuja la misma escena sobre
un lienzo Skia nativo (`@napi-rs/canvas`, sólo de desarrollo): en este PC no se puede abrir
Chrome, así que la verificación visual es un PNG generado por Node.

| Pieza | Estado |
| --- | --- |
| Contrato + tienda de preferencias | Escrito y compilando |
| Paleta armónica desde portada | Escrito, verificado con portada real |
| Vinilo marmoleado + surcos + galleta | Escrito, verificado |
| Funda (frente, reverso, reloj) | ✅ Verificada · siete capturas de reverso, reloj y sueño |
| Brazo, plato, mesa, sombras | Escrito, verificado |
| Física y gestos | ✅ Verificado con `scripts/sim.mjs` · 62/62 |
| Toque seco y mano apoyada | ✅ Verificado · el toque deja pausa, mantener frena y al soltar sigue |
| Reloj de día (opcional) | ✅ Verificado · `f5-clocktag.png` · asoma en 1,35 s |
| Puente sandbox + búsqueda iTunes | Escrito, con cola de pistas; probado con `fetch` simulado |
| Puente Android (cliente) | ✅ Verificado con `scripts/nativebridge.mjs` · 29/29 |
| Shell Kotlin + manifiesto + Gradle | ✅ **Compila**: ejecución 40427965945, doce etapas en verde |
| Letras LRCLIB + caché | Escrito, verificado (59 líneas reales) |
| Foley sintetizado | ✅ Verificado con `scripts/audiotest.mjs` · 43/43 |
| Consola de control | ✅ Verificada con `scripts/uitest.mjs` · 52/52 |
| Panel F2 | ✅ Verificado con `scripts/uitest.mjs` · 24/24 |
| Aviso del permiso (tablet) | ✅ Verificado con `scripts/uitest.mjs` · 7/7 |
| Comprobación de tipos | ✅ `node scripts/check.mjs` · 19 archivos, 0 errores |
| Compilación | ✅ `node scripts/build.mjs` · 19 módulos + 2 estáticos, ~1,2 s |
| Copia a la tablet | ✅ `node scripts/native.mjs` · 21 archivos, 160 KB (tope 15 MB) |
| Banco de física | ✅ `node scripts/sim.mjs` · 62/62 comprobaciones |
| Banco de interfaz | ✅ `node scripts/uitest.mjs` · 83/83 comprobaciones |
| Banco de audio | ✅ `node scripts/audiotest.mjs` · 43/43 comprobaciones |
| Banco del contrato nativo | ✅ `node scripts/nativecheck.mjs` · 30/30 comprobaciones |
| Banco del puente nativo | ✅ `node scripts/nativebridge.mjs` · 29/29 comprobaciones |
| Captura visual | ✅ doce escenarios + tira de fotogramas en `docs/captures/` |
| Compilación del APK | ✅ GitHub Actions · 98 s · artefacto `spindisk-apk` de 0,83 MB |
| Prueba en tablet | Pendiente · instalar el APK y medir RAM/batería |

**Bloqueos reales de este PC, ya resueltos:**
1. `npm`/`pnpm` fallan al ejecutar scripts de instalación (`spawn EPERM`) → se instala con
   `npm install --ignore-scripts` y no hay dependencias de runtime que compilar.
2. El sandbox impide lanzar procesos hijos y redirigir la salida de un ejecutable → fuera
   Vite y cualquier bundler; el build usa `typescript` como biblioteca, en el mismo proceso.
3. Chrome no puede arrancar (su multiproceso recibe `ACCESO DENEGADO` y se auto-termina) →
   las capturas se generan con `scripts/preview.mjs` sobre Skia.
4. Consecuencia honesta: **la capa DOM (consola, panel F2, avisos) no se ha visto
   renderizada**; el lienzo y la física sí. Para mirarla hay que abrir
   `http://127.0.0.1:5173` en el navegador del escritorio.
5. **El Kotlin no se puede compilar aquí** (no hay JDK ni SDK de Android, y `gradle` necesitaría
   subprocesos que el sandbox deniega). Se escribió y revisó con análisis estático; la primera
   compilación real fue la de GitHub Actions y salió a la primera (F8, 98 s, doce etapas verdes).

---

## 5. Fases

Cada fase termina con algo que se puede mirar, tocar o medir. Si una fase no se puede
verificar, no se cierra.

### F0 · Entorno reproducible — ✅ cerrada
- [x] `plan.md` con arquitectura, fases y criterios
- [x] Toolchain decidido y funcionando en este PC (`typecheck` + `build` verdes)
- [x] Servidor estático local sin dependencias (`node scripts/serve.mjs`, recarga por SSE)
- [x] Primera captura del lienzo vacío — vía Skia, porque Chrome no arranca aquí

**Aceptación cumplida:** `node scripts/check.mjs` y `node scripts/build.mjs` terminan en 0 y
producen `dist/`; `node scripts/dev.mjs` sirve `http://127.0.0.1:5173` y recompila al guardar
en menos de 700 ms.

### F1 · Escena estática (el "wow" del primer minuto) — ✅ cerrada
- [x] Mesa con luz y grano, proporciones de la tablet Lenovo
- [x] Funda inclinada 3,2° con carátula, lomo y desgaste de borde
- [x] Vinilo saliendo por detrás, mármol generado por semilla de la pista
- [x] Galleta impresa: título, artista, código de barras, textos curvos
- [x] Brazo metálico, cabezal negro mate, soporte de descanso
- [x] Revisión de proporciones contra la referencia y ajuste fino
      (plinto de aluminio, contrapeso cilíndrico, funda vacía con marca en relieve)

**Aceptación:** `docs/captures/f1-desk.png` y `docs/captures/f1-track.png` se sostienen como
fotografía de producto: la sombra de la funda cae sobre el disco, el brazo va por encima y la
paleta de la carátula real (Kaleth Morales) se tradujo a arena, crema y terracota.

### F2 · Física y datos (ya se siente vivo) — ✅ cerrada
- [x] Primera canción desde `F2`, portada real y paleta armónica aplicada al instante
- [x] Giro a 33⅓ con arranque y frenada por inercia
- [x] Dedo sobre el vinilo: frena, pausa la app real y al soltar vuelve en ~0,5 s
- [x] Arrastre del brazo: adelanta/retrocede en Premium
- [x] Modo Free: el brazo se resiste, vibra y vuelve al punto exacto
- [x] Fin del disco (brazo al centro) = siguiente canción en Free
- [x] 5 saltos rápidos: el disco se queda dentro y sólo cambian portada y título
- [x] Tras 450 ms de calma, sale el nuevo vinilo y baja la aguja

**Aceptación cumplida por medición, no por opinión** (`node scripts/sim.mjs`, 49/49):

| Caso | Medido | Objetivo |
| --- | --- | --- |
| Arranque a 95 % de 33⅓ RPM | 0,52 s | ≤ 1,00 s |
| Freno con el dedo hasta < 5 % | 0,27 s | ≤ 0,35 s |
| Recuperación al soltar | 0,52 s | ≤ 0,70 s |
| Radio de la púa sobre el surco | 248 → 92 px | fuera de 92–248 px, nunca |
| Desfase brazo ↔ segundo que suena | 0,008 rad | ≤ 0,02 rad |
| Arrastre Premium al 60 % | `seek:147,00` de 245 s | segundo exacto |
| Media vuelta con el dedo | 180,0° y `seek:23,50` | sigue al dedo y al reloj |
| Una vuelta visible a régimen | 5,07 s | 5,0 s (36 % del giro físico) |
| Rebote en Free (retroceso) | 2,113 vs 2,117 rad | no cede |
| Antirrebote: calma antes de sacar el disco | 1,00 s | ≥ 0,45 s |
| Disco guardado en la funda durante los saltos | 0,01 | queda dentro |
| Reloj: disco asomando un tercio | 0,42 | 0,42 |

Y la tira `docs/captures/f2-freno.png` muestra los cuatro tiempos del freno con la portada
real: gira → el dedo frena → el motor se detiene → al soltar vuelve el giro.

**Tres fallos que sólo aparecieron al medir** (y que las capturas no delataban): el `clamp`
del arrastre tenía los límites invertidos y mandaba la aguja siempre a un extremo; el ángulo de
reposo dejaba el brazo apoyado *sobre* el disco en vez de en su soporte; y el puente simulado
nunca cambiaba de canción, así que el antirrebote no se podía probar. Los tres están corregidos
y cubiertos por el banco.

### F3 · Consola de control — ✅ cerrada
- [x] Deslizar desde el borde inferior o tocar la esquina → aparece
- [x] Se oculta sola a los 3 s sin actividad
- [x] Transporte funcional; línea de tiempo bloqueada en Free
- [x] Cuatro texturas con memoria entre sesiones
- [x] 33⅓ / 45 RPM sin alterar el audio
- [x] Mezclador de foley silencioso en los extremos
- [x] Puente: toque abre la app, mantener pulsado pide ventana flotante

**Aceptación cumplida por medición** (`node scripts/uitest.mjs`, 76/76): los 45 casos de la
consola y los 21 del panel F2 corren su código real contra el `index.html` verdadero, con un DOM
mínimo y un reloj falso. Cubre lo que no se puede ver: que la cuenta atrás se reinicie con cada
toque, que en Free el `seek` **no** llegue al puente, que el pulgar no se mueva, que la pulsación
larga del puente abra la ventana flotante a los 480 ms, y que la búsqueda de iTunes no dispare
antes de los 420 ms de debounce.

**Dos fallos reales que aparecieron al probarla:** el commit de la línea de tiempo pedía `seek`
incluso con `canSeek=false` (Free recibía una orden que Spotify rechaza), y los botones de
transporte no refrescaban la consola hasta el siguiente tick de 120 ms.

**Lo que sigue a ciegas:** el aspecto de esa capa. El banco demuestra que se comporta; que se
vea bonita sólo se puede juzgar mirando `http://127.0.0.1:5173` en el navegador del escritorio.

**Ajuste pedido por el usuario tras mirarla en pantalla:** el vinilo giraba al revés del dedo
(`spinAngle -= delta` con la Y del lienzo hacia abajo) y el giro a régimen se sentía demasiado
rápido. Ahora el disco acompaña la mano y el giro visible va al 60 % de la velocidad física
(`SPIN_DISPLAY = 1.8 / 5` en `src/scene/turntable.ts`): una vuelta tarda 5,0 s en vez de 1,8 s y el
mármol deja de parecer un remolino. Los dos cambios están medidos en el banco de física.

### F4 · Reverso de la carátula (liner notes) — ✅ cerrada
- [x] Toque en la funda: giro de 180° con canto de cartón (interpolado por tiempo, 0,52 s,
      despega la sombra, barre un reflejo y muestra el espesor al pasar de perfil)
- [x] Letra real de LRCLIB, verso actual subrayado a mano con tinta terracota y punto al margen
- [x] Sin letra o instrumental: ficha técnica estética, con sello distinto para cada caso
- [x] Caché local por canción (no repetir consultas)
- [x] Limpieza de títulos basura de YouTube ("(Official Video)", "- Topic")

**Aceptación cumplida:** los tres casos están capturados — `docs/captures/f4-liner.png`
(letra sincronizada, 59 líneas reales), `f4-nolyrics.png` (sin letra), `f4-instrumental.png`
(pieza instrumental) — más `f4-flipmid.png` a mitad del giro. El banco de física mide el
volteo: pasa de canto en el fotograma 17 de 31 y completa el giro en 0,52 s.

### F5 · Reposo y reloj de escritorio
- [x] Pausa: el plato desacelera, el brazo va al soporte en 1,8 s, la estática se apaga
- [x] Pasado 1 minuto: el disco se guarda dejando asomar un tercio (`discOut` 0,42)
- [x] Paleta reposada de bajo brillo, hora y fecha en un fajín de papel sobre la funda
- [x] Un toque en cualquier parte despierta y reanuda
- [x] Repintado a un dibujo por minuto (la escena queda `settled`; medido, no supuesto)
- [x] **Reloj de día opcional:** con la preferencia encendida la hora se queda impresa en un
      papelito mientras la música suena (asoma en 1,35 s, no enciende el fajín de reposo y se
      retira en 1,72 s al apagarla). El fajín de reposo manda cuando llega.
- [x] **Dormirse con la letra a la vista** giraba la funda al reverso y sólo se veía la pantalla
      oscurecida: ahora la funda se vuelve sola a la portada en 1,65 s y el fajín se imprime sobre
      la cara que esté mirando, sin espejo (`f1-clocksleep.png`, `f1-clockback.png`).
- [x] **Toque seco en el vinilo:** un toque corto sin arrastre deja la música en pausa (y otro la
      arranca); mantener el dedo sigue siendo freno con la aguja apoyada. Umbral `TAP_MS = 300` y
      `scrubMoved` para que un arrastre rápido nunca se confunda con un toque.
- [ ] **Pendiente de F5:** contar los repintados reales durante varios minutos en el navegador.
      El reloj sólo despertaba en el cambio de minuto, así que podía aparecer hasta dos minutos
      tarde; ya se despierta también en el instante exacto (`msUntilClock`) y el panel F2 lo
      adelanta con "Modo reloj ahora".

**Aceptación:** la tablet queda de adorno sobre el escritorio; CPU en reposo sin picos.

### F6 · Foley fino — ✅ cerrada
- [x] Click del motor al arrancar y al frenar
- [x] Caída de aguja justo antes de la primera nota
- [x] Chisporroteo continuo con volumen de 0 a 100
- [x] Silencio automático al levantar el brazo
- [x] Ajuste de niveles: nunca por encima de la voz de la canción

**Aceptación cumplida por medición** (`node scripts/audiotest.mjs`, 43/43). Todo el motor es
WebAudio sintetizado, sin un solo archivo de audio, y el banco lo revisa con un `AudioContext`
falso que anota nodos y automatizaciones (`scripts/fakeaudio.mjs`):

| Lo que debe pasar | Medición |
| --- | --- |
| Nada suena antes de un gesto | `ready=false`, cero contextos creados |
| Un solo contexto, aunque se toque mil veces | `resume=1`, `contextos=1` |
| Techo del mezclador (no tapar la voz) | 0,4 al 100 % · 0,22 al 55 % · 0 al 0 % |
| Pico teórico con estática + aguja | 0,42 de 1,0 |
| Bucle de polvo | 4,000 s (176.400 muestras), normalizado a 0,95 |
| Filtros del polvo | paso alto 420 Hz + paso bajo 5.200 Hz |
| Entrada y salida de la estática | τ 0,35 s al bajar la aguja · τ 0,18 s al levantarla |
| Caída de aguja | seno 96 → 44 Hz en 0,18 s, pico 0,55, dura 0,40 s |
| Golpe de contacto | ruido de banda 900 Hz, 35 ms |
| Interruptor | arranque 180 → 70 Hz · freno 140 → 58 Hz, 0,16 s |
| Roce del brazo | banda 1.500 Hz a 0,045 (imperceptible) |
| El plato lo dispara | una caída por posada, estática a 0,5; al frenar baja a 0 y al soltar vuelve |

**Dos fallos reales que sólo aparecieron al medir:** (1) el bucle de polvo se sumaba por encima
de 1,0 y recortaba —ahora se normaliza a 0,95—; (2) si se tocaba y soltaba el vinilo dentro del
mismo fotograma, `needleWasDown` quedaba en `true` y el chisporroteo ya no volvía a encenderse al
reanudar: ahora `stopCrackle()` apaga el sonido y el indicador a la vez. Además el motor se
desbloquea con el primer toque en cualquier parte de la pantalla, no sólo sobre el lienzo, para
que un disco que ya venía sonando también tenga su estática.

**Aceptación:** con el volumen al 30% el efecto se percibe sin resultar molesto, y el
silencio al levantar la aguja no deja cola audible.

### F7 · Shell nativo en la tablet — ✅ cerrada
- [x] `MediaListenerService.kt`: escucha la `MediaSession` de la notificación, portada, posición y capacidades
- [x] Permiso de acceso a notificaciones explicado en pantalla (Android 13+)
- [x] Comandos reales: pausa, siguiente, anterior, seek
- [x] Abrir la app de origen; ventana flotante cuando el sistema lo permita
- [x] El panel F2 desaparece en la tablet
- [x] Pantalla completa inmersiva, orientación horizontal, sin barra de navegación
- [~] Servicio en primer plano: **no hace falta**. Un `NotificationListenerService` lo mantiene
      el sistema y ya está enganchado mientras la app vive; añadir un foreground service con
      notificación permanente gastaría batería y una barra en una pantalla que debe estar limpia.

**Decisión de arquitectura: sin Capacitor.** El plan original lo preveía, pero en este PC
`npx cap sync` necesita subprocesos que el sandbox deniega, y además arrastra AndroidX. Se
escribió el shell a mano: **una `Activity` con una `WebView`, cero dependencias de terceros**.
El APK no lleva motor propio (usa el WebView de la tablet), así que pesa menos que con Capacitor.

**Cómo se verificó sin JDK ni SDK de Android** (aquí no se puede compilar Kotlin):
1. `node scripts/nativecheck.mjs` — **30/30**. Lee los dos lados y los compara: los 12 métodos
   `@JavascriptInterface` existen en la interfaz TypeScript con la misma aridad y sin sobras;
   los ganchos que Kotlin llama (`onSnapshot`, `onNotice`) están declarados; `ACTION_SEEK_TO`
   es la detección de Premium; el latido es de 500 ms; la portada se sirve por
   `https://spindisk.local/art` con CORS; el manifiesto declara actividad, servicio,
   `sensorLandscape`, `resizeableActivity`, los tres paquetes de música y VIBRATE; el módulo
   Gradle no tiene dependencias y el workflow publica el `app-debug.apk`.
2. `node scripts/nativebridge.mjs` — **29/29**. Instala un `window.SpinDiskNative` falso con los
   mismos nombres y valores de vuelta que el de Kotlin y comprueba el puente de verdad:
   `connect()` arranca el servicio, la primera instantánea llega sin esperar, la traducción de
   título/artista/segundo/duración/fuente es correcta, Spotify Free entra como `canSeek=false`,
   los comandos llegan en orden, el seek se rechaza en Free y se acepta en Premium, un JSON roto
   no rompe nada, los avisos nativos alcanzan la interfaz, y **la escena real** reacciona: el
   disco sale, la aguja baja, el arrastre hacia atrás rebota (0,007 rad) sin seek fantasma,
   llevarla a la galleta salta de canción y un salto empujado desde la capa nativa cambia el disco.

**Lo que no se pudo afirmar aquí:** que compilara. Lo dijo el primer `push` a GitHub (F8): compiló.

**Aceptación:** con Spotify real sonando, el vinilo gira y el freno con el dedo pausa
Spotify de verdad; con YouTube, igual. *(Pendiente de la primera sesión en la tablet: F8.)*

### F8 · APK en la nube — ✅ cerrada
- [x] `build-apk.yml`: instala, compila la interfaz, copia los assets, revisa el contrato, `assembleDebug`
- [x] Artefacto `spindisk-apk` descargable desde Actions
- [ ] Instalación en la tablet y primera sesión real
- [x] Instrucciones de instalación (WhatsApp / Drive / cable) en `docs/apk.md`

**Aceptación cumplida el 27 de octubre de 2026, en el primer intento.** `git push` disparó el
flujo y terminó en **98 segundos**, con las doce etapas en verde (dependencias, tipos, web y
assets, contrato nativo, Java 17, Gradle, versiones, `assembleDebug` y subida del artefacto):

- ejecución: <https://github.com/Ynnoil1211/SpinDisk/actions/runs/40427965945> · `completed / success`
- artefacto: **`spindisk-apk` · 0,83 MB comprimido** (expira el 25 de enero de 2027)
- commit compilado: `1b45cb6`, el mismo que tenía el árbol local — no hubo que tocar nada del
  Kotlin ni del Gradle que se escribieron a ciegas

Que compilara a la primera no era suerte: el contrato está verificado por análisis estático
(30/30), el puente por un doble del JavaScript nativo (29/29) y las tres revisiones a mano del
Kotlin encontraron y corrigieron los tres fallos que habrían roto el build o la sesión (las
llamadas a `startActivity` desde el hilo del WebView, el `openSource` que ignoraba el modo
ventana flotante y el token de la portada con caracteres escapables).

**Lo que sigue pendiente de esta fase:** instalar el APK en la tablet Lenovo y comprobar que ve
Spotify. El peso ya se sabe y está muy por debajo del presupuesto: **0,83 MB** frente a los
15 MB de la especificación.


### F9 · Medición y ajuste
- [x] Peso real del APK y de los datos (**0,83 MB** el artefacto, 169 KB de assets)
- [ ] RAM en reposo, en reproducción y en modo reloj
- [ ] Consumo de batería en una sesión de 3 horas
- [x] Perfilado de dibujo: qué se cachea y qué se redibuja
- [ ] Ajuste de la tasa de refresco si hace falta

**Perfilado hecho en este PC** (`npm run perf`, peor caso: lienzo 2560×1600, Skia en
CPU sin GPU, así que los milisegundos son techo pesimista):

| Medición | Resultado | Lectura |
| --- | --- | --- |
| Fotograma girando (mediana) | 1,2 ms | el dibujo cabe de sobra en 16,7 ms |
| Fotograma dormido (mediana) | **1,12 ms** | antes 47–62 ms: el fajín se redibujaba entero |
| Girando ÷ dormido | 1,07× | la regla «el reposo no cuesta más» se cumple |
| Primera textura de un disco nuevo | 183 ms | ocurre con el disco todavía dentro de la funda |
| Fuga de heap en 800 fotogramas | 0 MB | sin fugas de objetos |
| RSS del motor en Node | 85 MB | incluye framebuffer de 16 MB; hay que confirmarlo en la tablet |

Lo que se cachea ahora: la textura marmoleada por pista, los surcos y el reflejo
especular (capa fija que no rota), el fondo de la mesa, las dos caras de la funda, el
fajín de la hora (una impresión por minuto) y el papelito del reloj de día. Lo que se
redibuja cada fotograma: el disco girado, la galleta, el brazo y los sprites ya
compuestos.

**Aceptación:** números dentro del presupuesto, o un informe de por qué no y qué se
sacrificó. Los tres primeros puntos necesitan la tablet y un APK instalado: son los
únicos que siguen abiertos.

---

## 6. Decisiones abiertas

**D1 · Herramientas de construcción.** Vite no corre en este PC por el bloqueo de
subprocesos. Dos caminos:
- **A (recomendado):** sólo TypeScript como dependencia de desarrollo; `tsc` compila a
  `dist/`, un servidor estático de 40 líneas sirve el proyecto y un script copia HTML y
  CSS. Cero bundler, cero spawn, mismo resultado en CI. Encaja con "no usar cosas tan
  pesadas" y hace el build reproducible en cualquier máquina.
- **B:** mantener Vite y aceptar que el build local no existe (todo se compila en CI).
  Más lento para iterar y más frágil.

**D2 · Detección de "Spotify Free".** Se deduce de las acciones que declara la sesión
multimedia (`ACTION_SEEK_TO`, `ACTION_SKIP_TO_PREVIOUS`). No hay API oficial. Se probará
en la tablet; si Spotify no las expone de forma fiable, el modo protegido se activa por
prueba de seek fallido y se recuerda por app.

**D3 · Ventana flotante.** Android sólo permite lanzar en *freeform* si el fabricante lo
habilita. Plan: intentar `ActivityOptions` con modo freeform y, si falla, abrir la app y
mostrar un aviso de "usa pantalla dividida" con el gesto. La tablet Lenovo decide.

**D4 · Permiso de notificaciones.** Es el único permiso incómodo. Se pedirá una sola vez,
con una pantalla que explique qué gana el usuario (ver la canción y controlarla), y la app
funcionará igual sin él (modo adorno con reloj).

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Spotify Free ignora los comandos de seek | El brazo no puede retroceder | Modo protegido con resistencia y snap-back; el salto al final sí funciona |
| Android 13+ limita el acceso a la sesión multimedia | Sin datos en la tablet | Servicio de escucha de notificaciones + servicio en primer plano, declarados y explicados |
| LRCLIB no encuentra la canción | Reverso vacío | Ficha técnica de respaldo; caché negativa para no repetir consultas |
| Portada de la notificación en baja resolución | Paleta pobre | Se usa el color dominante y se satura con el motor armónico; nunca se amplía la imagen |
| WebView lento en la tablet | Giro entrecortado | Surcos y brillo en capa fija; textura pre-renderizada; escalado por `dpr` limitado a 2 |
| El proyecto vive en OneDrive | Bloqueos de archivo, sincronización | Excluir `node_modules`, `dist` y `.git` de la sincronización; commits frecuentes |
| Quedarse sin tiempo por pulir | Nunca llega el APK | F7 y F8 se hacen en cuanto F2 esté verde, aunque F3–F6 no estén perfectas |

---

## 8. Presupuesto y cómo se mide

| Métrica | Objetivo | Cómo se comprueba |
| --- | --- | --- |
| Instalación | < 15 MB | Tamaño del APK en Actions |
| RAM | < 60 MB | `adb shell dumpsys meminfo` con la app en reposo y reproduciendo |
| Reposo | 1 dibujo/minuto | Contador de frames en desarrollo; `systrace` si hace falta |
| Red | Sólo texto de letras | Panel de red de Chrome y registro del plugin |
| Arranque | < 2 s hasta el primer vinilo | Cronómetro en dispositivo real |

---

## 9. Verificación

- **Visual:** `node scripts/preview.mjs <escenario>` dibuja la escena sobre Skia y deja un
  PNG en `docs/captures/`. Escenarios: `desk`, `track`, `flip`, `clock`, `free`. Se revisan a
  ojo y se comparan entre iteraciones. (Chrome headless no arranca en este PC: su
  multiproceso recibe acceso denegado.)
- **Física:** `node scripts/sim.mjs` corre la máquina de estados real en Node, sin navegador y
  sin esperas: avanza el reloj a mano, comprueba 49 comportamientos con umbrales y escribe la
  tira `docs/captures/f2-freno.png`. Sale con código 1 si algo se sale del margen.
- **Interfaz:** `node scripts/uitest.mjs` monta la consola y el panel F2 sobre un DOM mínimo
  construido desde el `index.html` verdadero, con reloj falso: 76 comprobaciones de estado,
  gestos y avisos. Sale con código 1 si algo se rompe.
- **Audio:** `node scripts/audiotest.mjs` sustituye el `AudioContext` por uno falso que anota
  cada programación de parámetros: 43 comprobaciones de niveles, bucle de estática, caída de
  aguja y los disparos reales del plato.
- **Contrato nativo:** `node scripts/nativecheck.mjs` lee el TypeScript y el Kotlin y comprueba
  que los 12 métodos y los dos ganchos coinciden, más el manifiesto y el workflow (30).
  `node scripts/nativebridge.mjs` instala un `window.SpinDiskNative` falso y verifica el puente
  y la reacción de la escena (29).
- **Tipos:** comprobación estricta en cada fase, sin excepciones ni `any` sueltos.
- **Casos extremos:** el panel F2 y el banco pueden forzar Free/Premium, 5 saltos, canción sin
  letra y modo reloj sin esperar a que ocurran.
- **Dispositivo:** una sesión real por fase a partir de F8, con Spotify y YouTube.

---

## 10. Convenciones

- Interfaz y comentarios en español; nombres de código en inglés cuando son conceptos
  técnicos (`bridge`, `spin`, `sleeve`).
- Sin dependencias nuevas sin justificarlo en este documento.
- Un archivo, una responsabilidad. Nada de archivos de 800 líneas.
- Los estados de reposo y los errores se diseñan: nunca una pantalla muerta ni un mensaje
  en inglés del sistema.
- Cada fase se registra aquí con su fecha cuando se cierra.

---

## 11. Próximo paso propuesto

**F9 · instalar el APK en la tablet y medir.** F8 ya está cerrada: el árbol se subió y el flujo
compiló a la primera (ejecución 40427965945, 98 s, artefacto `spindisk-apk` de 0,83 MB). Lo que
queda de F9 no se puede hacer desde ningún PC:

1. Descargar el artefacto y pasar el `app-debug.apk` a la tablet.
2. Instalarlo y conceder **acceso a las notificaciones** (el aviso de la propia app lleva al
   ajuste); sin eso la mesa se queda vacía.
3. Poner Spotify a sonar y comprobar que el vinilo gira, que el freno con el dedo pausa de
   verdad y que en Free el brazo rebota sin desincronizarse.
4. Medir con `adb shell dumpsys meminfo com.spindisk.tablet` en los tres estados (reproducción,
   reposo, reloj) y anotar el peso instalado real; después, una sesión de tres horas para la
   batería.

Lo que salga de ahí decide el ajuste de F9: si la RAM se pasa de 60 MB, el primer candidato es el
modo «dibujo plano» (sin `clearRect` del lienzo completo ni pilas de transformación por pieza)
que ya está descrito en §8.

