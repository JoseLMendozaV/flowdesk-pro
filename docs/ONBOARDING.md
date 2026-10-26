# Bienvenida, recorrido y novedades

Fecha de verificación: 25 de octubre de 2026.

FlowDesk Pro presenta sus funciones con tres experiencias que comparten ventana y datos:

| Experiencia | Cuándo aparece | Qué muestra |
| --- | --- | --- |
| **Bienvenida inicial** | Primera apertura de la ventana principal | Pantalla de bienvenida, recorrido por cada función y «¡Todo listo!» |
| **Visita guiada** | Desde el final del recorrido, «Mostrármelo en FlowDesk» o Configuración | Resalta elementos reales de la interfaz con un globo explicativo |
| **Novedades** | Tras una actualización con funciones nuevas o mejoradas | Solo lo que el usuario aún no conoce, y el historial de versiones |

Además, la misma ventana ofrece el catálogo **Funcionalidades disponibles** y **Atajos de teclado**.

## Qué se presenta hoy

La disponibilidad no depende de la fase, sino del registro y de lo que Rust declara. Revisado en el código el 25 de octubre de 2026:

| Función | Fase | Versión | Estado |
| --- | --- | --- | --- |
| Inicio | 1 | 0.1.0 (mejorada en 0.2.0) | Se presenta |
| Barra de menús | 2 | 0.1.0 (mejorada en 0.2.0) | Se presenta |
| Notas flotantes | 3 y 7 | 0.1.0 (mejorada en 0.2.0 y 0.4.0) | Se presenta |
| Tareas y Proyectos | 4 | 0.1.0 | Se presentan |
| Pomodoro | 5 | 0.1.0 | Se presenta |
| Seguimiento del tiempo | 5 | 0.1.0 (por aplicación en 0.2.0) | Se presenta |
| Agenda y recordatorios (mejorada en 0.5.0 y 0.6.0), Espacios (mejorados en 0.4.0), Portapapeles | 6 | 0.2.0 | Se presentan |
| Tareas que se repiten (mejora de Tareas), Paleta de comandos, Papelera | — | 0.6.0 | Se presentan |
| Fecha de inicio (Tareas), arrastrar en el calendario (Agenda), próximo evento (Barra de menús) | — | 0.7.0 | Mejoras de funciones existentes |
| IA local | 8 | — | **No se presenta**: no hay módulo; la barra lateral la muestra deshabilitada |

## Cuándo se abre

`OnboardingManager` (ventana principal) decide una sola vez por sesión, y solo cuando el dashboard es visible:

1. Si `show_welcome_on_startup` está activo, abre la bienvenida.
2. Si no, compara la huella del contenido disponible con la última vista. Si hay funciones nuevas o mejoradas y `show_whats_new_on_update` está activo, abre las novedades.
3. Si no hay nada que anunciar, o las novedades están desactivadas, registra el contenido como conocido sin abrir nada.

**Inicio oculto con macOS.** Con `--autostart` y «Iniciar oculto», el dashboard no se muestra y la comprobación no ocurre. La bienvenida pendiente aparece cuando el usuario abre FlowDesk por primera vez (icono, ⌥⇧F o Dock).

| Acción del usuario | Efecto |
| --- | --- |
| Termina el recorrido | `welcome_status = completed`. **Sigue abriéndose** en cada inicio |
| «Explorar por mi cuenta», «Saltar recorrido», Esc o cerrar la ventana | `welcome_status = skipped` si estaba pendiente (nunca borra un recorrido completado). Se conserva el último paso. **Sigue abriéndose** en cada inicio |
| «Mostrármelo en FlowDesk» | No cuenta como omitir. Al terminar o salir de la visita guiada, la ventana vuelve a abrirse en la misma función |
| Marca «No volver a mostrar esta bienvenida automáticamente» | **Única forma de que deje de abrirse sola.** Se guarda al momento (`show_welcome_on_startup = 0`) |
| Activa «Mostrar bienvenida al abrir FlowDesk» en Configuración | Vuelve a abrirse en cada inicio |
| «Omitir por ahora» en las novedades | Se cierran; quedan en Ayuda → ¿Qué hay de nuevo? |
| Marca «No mostrar automáticamente estas novedades» | `show_whats_new_on_update = 0`, independiente de la bienvenida |

La bienvenida se abre en cada inicio normal hasta que el usuario la desactive; terminarla u omitirla solo cambia `welcome_status`. Cerrar la ventana lo detecta Rust (`WindowEvent::Destroyed`), así que también vale con el botón rojo o ⌘W. Si «Continuar tutorial donde lo dejé» está activo, la pantalla inicial ofrece «Continuar donde lo dejé: <función>».

Para la visita guiada desde un paso, `start_guided_tour` recibe el modo al que volver: Rust cierra la ventana sin registrarla como omitida y la visita, al terminar o con Esc, la reabre en la misma función.

## Dónde se abre a mano

- Barra de menús de macOS: **Ayuda → Recorrido por FlowDesk** y **Ayuda → ¿Qué hay de nuevo?**
- Menú del icono (clic derecho): submenú **Ayuda** con las mismas acciones.
- Panel del icono: botón **Ayuda**.
- Barra lateral: botón **?** junto a Configuración.
- **Configuración → Ayuda y bienvenida**: preferencias y acciones (recorrido completo, funcionalidades, novedades, atajos, visita guiada y reiniciar).

## Arquitectura

```text
src/features/onboarding/
  registry/   features.ts (registro), registry.ts (filtrado, novedades, historial), types.ts, registry.test.ts
  components/ OnboardingWindow, OnboardingManager, OnboardingHeader, OnboardingNavigation,
              OnboardingProgress, FeaturePreview, FeatureDemo, WelcomeIllustration, OnboardingSettings
  screens/    WelcomeScreen, FeatureStepScreen, FinishScreen, WhatsNewScreen, FeatureCatalogScreen, ShortcutsScreen
  tours/      InteractiveTour, TourSpotlight
  demos/      demostraciones con datos ficticios
  hooks/      useOnboardingData, useMotion
  assets/     <función>/<función>-light.webp y -dark.webp
src-tauri/src/commands/onboarding.rs   persistencia, capacidades y comandos
src-tauri/src/windows/onboarding.rs    ventana `onboarding` (una sola instancia)
src-tauri/src/menu/mod.rs              menú Ayuda de la app y del icono
src-tauri/migrations/0009_onboarding.sql
scripts/onboarding-screenshots/        arnés y script de capturas
```

- **React:** pantallas, navegación, animaciones, estado del recorrido y visita guiada.
- **Rust:** preferencias, progreso, historial, capacidades del binario, ventana y menús.
- **SQLite:** `onboarding_state` (una fila) y `onboarding_history` (últimos 200 eventos).

La ventana `onboarding` se crea al pedirla, con 900 × 620 acotado al área útil del monitor (mínimo 720 × 520). Se muestra cuando la página ya pintó, para evitar el destello blanco en modo oscuro. Si ya existe, Rust le envía `flowdesk://onboarding-open` con el modo pedido y la enfoca. Su código se carga aparte (`React.lazy`, 55 KB) para no pesar en las demás ventanas.

## Registro de funcionalidades

`src/features/onboarding/registry/features.ts` es la única fuente de la guía. Una función se presenta solo si cumple todo esto:

- `implemented`, `verified`, `enabled` y `onboardingEnabled` son verdaderos.
- Tiene `introducedInVersion`.
- **Rust declara todas sus capacidades** (`requires`).

Las capacidades salen de `CAPABILITIES` en `commands/onboarding.rs`. Así el registro no puede presentar una función que el binario no incluye.

`setup` cubre funciones que existen pero necesitan configuración: si falta su capacidad (por ejemplo `local-ai:model`), el paso explica qué hay que configurar.

### Añadir una función terminada (ejemplo: IA local, fase 8)

1. En Rust, declara la capacidad: añádela a `CAPABILITIES` o detecta su presencia real (por ejemplo, `local-ai:model` cuando hay un modelo instalado).
2. En `features.ts`, completa la ficha:
   - `implemented: true` y `verified: true` (solo después de probarla en la app empaquetada);
   - `introducedInVersion` con la versión que la publica;
   - textos, `highlights`, `example`, `tips` y `order`.
3. Añade `data-tour-id` estables a los elementos que quieras resaltar y escribe sus `tourSteps`.
4. Si se ve en la ventana principal, añade su vista en `featureShots` de `scripts/onboarding-screenshots/capture.mjs` y ejecuta `npm run onboarding:screenshots -- <id>`. Si no, crea una demostración en `demos/`.
5. `npm run test:onboarding` (`registryProblems()` exige versión, contenido, captura o demostración e ids únicos) y `npm run test:onboarding-ui`.

No hace falta tocar la lógica de la guía: la bienvenida, el catálogo, la visita guiada y las novedades la incluyen solas, y los usuarios que actualicen la verán en **Novedades**.

### Mejoras visibles de una función existente

Sube su `revision` y añade una entrada en `updates` con la versión y un resumen. Las novedades la mostrarán como **Mejorado** a quien conocía la revisión anterior. Las optimizaciones internas no deben subir la revisión.

## Novedades

- SQLite guarda `seen_features` como `{ id: revisión }`.
- Cada vez que se presenta el contenido se suma lo disponible conservando la revisión mayor. Se compara por **conjuntos de identificadores y revisiones**, no por número de versión.
- `featureRevision()` resume lo disponible (`CONTENT_REVISION:id@rev,…`). Si coincide con `last_seen_feature_revision`, no hay nada que calcular.
- Lo anunciado se marca como visto al mostrarlo: el mismo anuncio no reaparece.
- «¿Qué hay de nuevo?» sin novedades pendientes muestra «Estás al día» y el historial real por versión, generado a partir de `introducedInVersion` y `updates`.

## Visita guiada

`InteractiveTour` vive en la ventana principal y escucha `flowdesk://guided-tour`:

- Cambia de sección si el paso lo pide, espera hasta 1,5 s a que aparezca el elemento `[data-tour-id]` y lo resalta.
- Si el elemento no existe o no es visible (por ejemplo, el panel derecho oculto), **omite el paso** sin romper la visita.
- Sigue al elemento al redimensionar o desplazar (`ResizeObserver` y `scroll`). Con la ventana oculta o minimizada no pinta nada y continúa al volver.
- **Teclado:** ← → y Esc, capturados antes que los atajos de la sección (el calendario usa las mismas flechas). El foco va al botón principal del globo, que es un `dialog` con título y descripción para VoiceOver.
- Una capa bloquea los clics: la visita no puede modificar datos. No abre formularios y, al terminar, devuelve la sección inicial.
- Si hay un formulario o diálogo abierto, no empieza y pide cerrarlo primero. Desde Configuración solo se puede lanzar si no hay cambios sin guardar.

## Imágenes y demostraciones

- **Capturas reales** de la interfaz actual en claro y oscuro (WebP, 20–50 KB cada una, 620 KB en total).
  - `<picture>` elige la variante según el modo del sistema. Se amplían con un clic.
  - Las genera `npm run onboarding:screenshots`: un arnés renderiza la app real con el IPC de Tauri simulado (`@tauri-apps/api/mocks`) y datos de demostración ficticios.
  - Chrome sin interfaz las captura por el protocolo de depuración, con un perfil temporal. No toma la pantalla ni lee datos del usuario.
  - Hay que regenerarlas cuando cambie la interfaz.
- **Demostraciones** (notas, tareas, Pomodoro, tiempo, espacios, portapapeles, barra de menús):
  - Funcionan sin conexión y con datos solo en memoria.
  - Las interactivas (añadir y completar tareas, buscar en el portapapeles, cambiar de espacio) no llaman a Rust.
  - Se detienen con «Reducir movimiento», con la ventana minimizada u oculta.
- **Ilustración de bienvenida:** logotipo oficial, captura real del dashboard y elementos reconocibles de la app. No usa recursos de Tauri.

## Privacidad

La guía no activa el seguimiento por aplicación ni el portapapeles, no inicia temporizadores, no crea ni modifica tareas o proyectos y no pide permisos de macOS. Las demostraciones lo indican al pie. Nada sale del equipo.

## Pruebas realizadas

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `npm run check` y `npm run build`: aprobados.
- `cargo test`: **76 pruebas aprobadas** (8 nuevas):
  - primera ejecución con preferencias independientes;
  - completar y omitir no desactivan la bienvenida; omitir conserva el último paso y no borra un recorrido completado;
  - cerrar la ventana marca como omitida una bienvenida pendiente una sola vez;
  - solo la preferencia del usuario detiene la apertura automática;
  - fusión de funciones vistas con la revisión mayor y rechazo de ids no válidos;
  - reiniciar sin olvidar lo conocido;
  - historial acotado a 200 eventos;
  - migración 9 sobre una base anterior sin perder datos.
- `npm run test:onboarding`: **8 pruebas del registro**:
  - sin errores de mantenimiento;
  - hoy se presentan exactamente 10 funciones, sin IA;
  - lo incompleto, sin verificar, deshabilitado o sin publicar no aparece;
  - la capacidad de Rust es obligatoria;
  - nuevo frente a mejorado, sin repetir anuncios;
  - huella estable;
  - historial por versión;
  - IA sin modelo pide configuración.
- `npm run test:onboarding-ui`: **22 flujos sobre la interfaz real** (los 7 de las notas 2.0, en docs/PHASE_07.md, y el de las tareas en el calendario) en Chrome sin interfaz, con el IPC simulado:
  - al abrir decide bienvenida, novedades o nada, y **no abre nada con el dashboard oculto**;
  - avanzar, retroceder, saltar a un paso con los puntos, foco en el título y completar;
  - «Explorar por mi cuenta» y Esc omiten;
  - «Mostrármelo en FlowDesk» no omite y pide volver a la bienvenida;
  - al terminar o salir de la visita, la bienvenida se reabre en la misma función;
  - «Continuar donde lo dejé» lleva al último paso;
  - la casilla se guarda al momento sin tocar la preferencia de novedades;
  - novedades: 3 nuevas y 4 mejoradas, marcadas como vistas;
  - «Estás al día» con el historial;
  - el catálogo no muestra la IA local;
  - la visita guiada omite el panel derecho oculto, termina y no llama a ningún comando que cambie datos;
  - Esc devuelve la sección inicial;
  - «Reducir movimiento» detiene las animaciones;
  - modo oscuro y ventana de 720 × 520 sin desbordamiento.
- **App empaquetada con `HOME` aislado** y una base de la versión 0.2.0 con una tarea:
  - Iniciada con `--autostart` y «Iniciar oculto», aplicó la migración 9 y conservó la tarea (`integrity_check = ok`, sin violaciones).
  - `CGWindowList`: ninguna ventana en pantalla y ninguna ventana `onboarding`. La bienvenida quedó pendiente para la primera apertura.
- **Migración 9 sobre una copia de la base real:** versiones 1–9, datos intactos, `integrity_check = ok`. La copia se borró después.
- **Revisión visual** en claro y oscuro de la bienvenida, los pasos con captura y con demostración, las novedades, «Estás al día», el catálogo, los atajos, la ventana pequeña, Configuración y la visita guiada.
  - Se hizo con el arnés de capturas, sin tomar el control de la pantalla.
  - Se corrigieron:
    - el título de la bienvenida, que se recortaba al centrar con desbordamiento;
    - el nombre de la app, que se partía en ventanas estrechas;
    - la doble apertura de la bienvenida si la comprobación de inicio se ejecutaba dos veces seguidas.

### Validación manual en el Mac

El usuario autorizó usar la pantalla. Se hizo con la app en modo desarrollo y la base real: clics con `CGEvent` y capturas solo de las ventanas de FlowDesk.

- **Bienvenida en cada inicio:** se abrió en un inicio normal con el estado «omitida» y otra vez tras reiniciar con el recorrido ya completado.
- **«Mostrármelo en FlowDesk»** en el paso Tareas:
  - La bienvenida se cerró sin registrarse como omitida y la visita recorrió los 5 pasos de Tareas sobre la interfaz real.
  - Con «Terminar», la bienvenida se reabrió en «Paso 2 de 11 · Tareas».
- **«Comenzar a trabajar»** dejó `welcome_status = completed` con `show_welcome_on_startup = 1`.
- **«No volver a mostrar»:** al marcarla guardó `0` al momento y al desmarcarla volvió a `1`.
- **Defectos encontrados y corregidos:**
  - «Mostrármelo en FlowDesk» quedaba bajo el pliegue del texto: ahora está siempre visible bajo la captura.
  - El resalte se salía de la ventana con elementos a todo lo ancho: ahora se recorta.
  - En modo oscuro el fondo apenas se oscurecía: ahora es más opaco.

Pendiente de comprobar a mano:
- el menú **Ayuda** de la barra de menús y del icono;
- VoiceOver;
- arrastrar la cabecera de la ventana de bienvenida.

## Limitaciones

- Las capturas reflejan la interfaz del día en que se generan: hay que regenerarlas (`npm run onboarding:screenshots`) cuando cambie una pantalla.
- Mientras la visita guiada busca un elemento que no aparece (hasta 1,5 s), el resalte desaparece; después continúa con el siguiente paso.
- Las capas de la visita bloquean también el arrastre de la ventana principal hasta que termina.
- El menú de la app de macOS conserva los textos en inglés que Tauri pone por defecto (Edit, View, Window); solo **Ayuda** está traducido.
