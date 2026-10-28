# Primer APK: qué mirar si el build falla

El workflow `.github/workflows/build-apk.yml` corre en cada `push` a `main`. El primer
build real de Kotlin de este proyecto es también la primera vez que un compilador lee
esos cuatro archivos, así que es normal que aparezca algo. Guía rápida, de lo más
probable a lo menos.

## Cómo leer el registro

1. Abre **Actions → build-apk → último run**.
2. Despliega el paso **Versiones**: dice con qué JDK, Gradle y plataformas del SDK se
   intentó. Sin eso el error es adivinanza.
3. Busca el primer `FAILURE:` y lee **hacia arriba** hasta `> Task :app:compileDebugKotlin`
   o `> Task :app:processDebugResources`. El mensaje útil está justo antes de `FAILURE:`.

## Tabla de fallos y arreglos

| Mensaje | Qué significa | Arreglo |
| --- | --- | --- |
| `Could not resolve com.android.tools.build:gradle:8.5.2` | el runner no encontró AGP (red o versión) | subir/bajar la versión en `android/build.gradle` a la que exista en Maven Central |
| `Minimum supported Gradle version is 8.x` | Gradle del runner más viejo que lo que pide AGP | ajustar `gradle-version` en el workflow o bajar AGP |
| `Unsupported class file major version` | JDK y Gradle desalineados | el workflow fija temurin 17 y Gradle 8.7; no cambiar uno sin el otro |
| `Unresolved reference: X` en un `.kt` | falta un `import` | añadirlo; los 38 imports actuales fueron revisados a mano |
| `Class 'X' is not abstract and does not implement abstract member` | firma de `override` que no coincide | copiar la firma exacta de la clase base del SDK |
| `This project uses AndroidX dependencies…` | propiedad de AndroidX apagada | ya está en `true` en `android/gradle.properties` |
| `Namespace not specified` / `exported` | manifiesto incompleto | ambos están puestos; revisar si se tocó el manifiesto |
| `SDK location not found` | `ANDROID_HOME` no visible para Gradle | añadir `local.properties` con `sdk.dir` o exportar la variable en el paso |

## Si sale verde

1. Descarga `spindisk.apk` de la [última release](https://github.com/Ynnoil1211/SpinDisk/releases/latest)
   (o el artefacto **spindisk-apk** del run en Actions).
2. Pásalo al dispositivo Android y ábrelo (hay que permitir «instalar desde orígenes desconocidos»
   para el explorador o la app de mensajería con la que llegue).
3. Al primer arranque, la app pedirá **acceso a las notificaciones**: sin eso no puede
   leer lo que suena. Lo avisa en una banda arriba con un botón «Activar», y también se
   puede activar a mano en Ajustes → Notificaciones → Acceso a notificaciones → SpinDisk.
4. Con Spotify o YouTube sonando en segundo plano, la portada debe aparecer sola.

## Si Google Play lo bloquea

Play Protect frena cualquier app que no venga de la tienda, y más si pide **acceso a
notificaciones**. No es un virus: Google no conoce el paquete. Tres caminos, del más
limpio al más rápido:

- **Por cable (el más fiable).** Opciones de desarrollador → depuración USB, y
  `adb install -r spindisk.apk`. En instalaciones por `adb` Play Protect no interviene.
- **«Instalar de todas formas».** Al abrir el APK, si sale el aviso, buscar
  *Más detalles* → *Instalar de todas formas*.
- **Desactivar el análisis un momento.** Play Store → foto de perfil → Play Protect →
  engranaje → desactivar *Analizar apps con Play Protect*, instalar y volver a activarlo.

Si en cambio dice **«Aplicación no instalada»**, no es un bloqueo sino un rechazo:

- El archivo debe terminar en `.apk` (WhatsApp y Drive a veces renombran).
- Si ya había una versión instalada, tiene que venir firmada con la **misma clave**.
  Por eso el flujo guarda `~/.android/debug.keystore` en caché entre compilaciones:
  desde el primer build con esa caché, las actualizaciones se instalan encima. Las
  instalaciones hechas **antes** de ese cambio llevan otra firma y hay que
  desinstalarlas una vez.

## Qué pasa al abrirlo por primera vez

Se ve la mesa con el tocadiscos vacío y una banda arriba: «Para leer lo que
suena, SpinDisk necesita acceso a las notificaciones». **No salta sola a los
ajustes** —antes lo hacía, y se sentía exactamente como si la app se cerrara al
entrar—: el botón «Activar» de esa banda es el que abre la pantalla del sistema.

Si la app se cerrara de verdad, al volver a abrirla aparece encima la traza del
último fallo, con un toque para descartarla. Una foto de esa banda basta para
saber qué pasó: no hace falta cable, `adb` ni logcat.

## Lo que no se puede comprobar sin la tablet

Peso real del APK, RAM en reposo y en reproducción, y batería en una sesión larga: son
las tres casillas abiertas de F9 en `plan.md`. Se miden con el APK instalado
(`adb shell dumpsys meminfo com.spindisk.tablet` es el atajo si hay cable).
