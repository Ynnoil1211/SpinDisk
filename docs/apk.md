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

1. Descarga el artefacto **spindisk-apk**.
2. Pásalo a la tablet y ábrelo (hay que permitir «instalar desde orígenes desconocidos»
   para el explorador o la app de mensajería con la que llegue).
3. Al primer arranque, la app pedirá **acceso a las notificaciones**: sin eso no puede
   leer lo que suena. Lo avisa en una banda arriba con un botón «Activar», y también se
   puede activar a mano en Ajustes → Notificaciones → Acceso a notificaciones → SpinDisk.
4. Con Spotify o YouTube sonando en segundo plano, la portada debe aparecer sola.

## Lo que no se puede comprobar sin la tablet

Peso real del APK, RAM en reposo y en reproducción, y batería en una sesión larga: son
las tres casillas abiertas de F9 en `plan.md`. Se miden con el APK instalado
(`adb shell dumpsys meminfo com.spindisk.tablet` es el atajo si hay cable).
