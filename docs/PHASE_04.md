# Fase 4 — Tareas y proyectos

Fecha de verificación: 25 de octubre de 2026.

## Revisión de las Fases 1–3

Antes de empezar se revisó todo el código y se volvieron a ejecutar `npm run check`, `npm run build`, `cargo clippy --all-targets -- -D warnings` y `cargo test` (8 pruebas): todo aprobado. La revisión encontró estos defectos, corregidos en esta fase:

| Fase | Defecto | Corrección |
| --- | --- | --- |
| 1 | `button, input { font: inherit }` estaba fuera de una capa CSS y anulaba las utilidades `text-[..]` de Tailwind 4: botones y navegación salían a 16 px. | Regla movida a `@layer base` e incluidos `select` y `textarea`. Verificado con captura de la ventana empaquetada. |
| 2 | El panel del tray no escuchaba cambios de datos: al reabrirlo mostraba datos antiguos. | Escucha `flowdesk://data-changed` y se refresca al recibir foco. |
| 2 | Al pulsar el icono con el panel abierto, la pérdida de foco lo ocultaba y el mismo clic podía volver a mostrarlo. | Marca temporal de ocultación por pérdida de foco (300 ms) en `windows/mod.rs`. |
| 3 | El plugin `window-state` también guardaba y restauraba las ventanas `note-*`, compitiendo con la geometría de SQLite y acumulando entradas de notas borradas. | Filtro: el plugin solo gestiona `main`. |
| 3 | Una nota expandida podía redimensionarse por debajo de 120 px; el `CHECK` de SQLite rechazaba la escritura y se perdía también la posición. | Altura mínima de 120 px al estar expandida y valores acotados en SQL. |
| 3 | `⌥N` creaba la ventana, pero el editor no recibía el foco y, en modo accesorio, la app no se activaba. | `set_focus()` al crear y foco automático del editor en notas vacías. |
| 3 | La base real tenía 2 filas huérfanas en `note_windows` (notas de prueba borradas fuera de la app sin `foreign_keys`). | Migración 3 limpia huérfanos; `PRAGMA foreign_key_check` queda vacío. |

También se comprobó una sospecha que resultó falsa: la transparencia de ventanas en macOS ya no requiere `macOSPrivateApi` desde Tauri 2.12.1.

## Implementado

**Esquema (migración 3)**
- `tasks.due_has_time`: fechas límite con o sin hora. Las fechas sin hora se guardan a mediodía local.
- `task_notes`: relación N:M entre tareas y notas, con `ON DELETE CASCADE` en ambos lados.
- Índices para etiquetas, subtareas, estado de proyectos y tiempo por proyecto.

**Tareas** (`src-tauri/src/commands/tasks.rs`)
- Crear, editar, completar, reabrir, cancelar y eliminar.
- Campos: título, descripción, estado, prioridad, fecha límite (con hora opcional), proyecto, tiempo estimado, tiempo registrado (solo lectura hasta la Fase 5), etiquetas y subtareas.
- Subtareas: añadir, renombrar, completar y eliminar.
- Etiquetas: normalizadas (sin `#`, sin duplicados por mayúsculas), color determinista y eliminación automática de las que quedan sin uso.
- Vistas: Hoy (incluye vencidas), Próximas, Todas y Completadas.
- Filtros por proyecto (incluido "Sin proyecto"), prioridad, etiqueta y estado; orden por fecha, prioridad, creación o título.
- Búsqueda en título, descripción y etiquetas con `LIKE` parametrizado y escapado (`%` y `_` se buscan literalmente).
- `completed_at` se mantiene coherente al cambiar de estado.

**Proyectos** (`src-tauri/src/commands/projects.rs`)
- Crear, editar, archivar, restaurar y eliminar.
- Nombre, descripción, color, estado, fecha de inicio y fecha objetivo (validada).
- Estadísticas reales: tareas totales, completadas, abiertas, vencidas, notas, tiempo registrado (`time_entries`) y progreso.
- Eliminación protegida: el usuario elige conservar las tareas sin proyecto o borrarlas (esto último requiere escribir el nombre). Notas, sesiones y registros de tiempo nunca se borran. El diálogo ofrece archivar como alternativa.

**Interfaz**
- Página Tareas con vista de lista y Kanban (arrastrar y soltar más botones ◀ ▶ accesibles por teclado), captura rápida contextual y panel de detalle con guardado automático.
- Página Proyectos con tarjetas de progreso y vista de detalle que reutiliza el mismo espacio de tareas filtrado por proyecto.
- Dashboard: completar tareas con un clic, fecha relativa ("Hoy", "Mañana", vencida en rojo), acceso a la vista Hoy y saludo según la hora.
- Panel del tray: completar tareas y acción "Tareas de hoy" (sección 14.4).
- Diálogo de nueva tarea con prioridad y proyecto; `Esc` cierra diálogos y el panel de detalle.
- Notas: vínculo con proyecto desde la nota flotante, chip de proyecto en la página Notas, y "Convertir selección" crea la tarea vinculada a la nota y a su proyecto.

## Pruebas realizadas

- `npm run check` y `npm run build`: aprobados.
- `cargo fmt --check` y `cargo clippy --all-targets -- -D warnings`: aprobados.
- `cargo test`: **20 pruebas aprobadas** (8 previas + 12 nuevas): validación, etiquetas, estados, vistas, filtros, búsqueda literal, subtareas, vínculos con notas, progreso de proyectos, archivado y las dos modalidades de eliminación protegida, además de la limpieza de huérfanos de la migración 3.
- Migración 3 aplicada primero sobre una copia de la base real y después por la app empaquetada sobre la base real: `integrity_check = ok`, `foreign_key_check` vacío; la tarea existente creada para "hoy" pasó a fecha sin hora.
- `npm run bundle:macos`: `.app` y `.dmg` generados.
- Con una instancia aislada (`HOME` temporal, sin tocar los datos reales): un clic izquierdo físico en el icono abrió el panel bajo el icono con datos reales y un segundo clic lo cerró.
- Captura de la ventana empaquetada: tipografía corregida y dashboard con datos reales.

## Pendiente de validación manual

Las páginas Tareas y Proyectos no se pudieron recorrer con clics automatizados: la ventana estaba en otro Space y no se quiso tomar el control de la pantalla mientras el equipo estaba en uso. Comprobar:

1. Crear, editar y completar tareas desde la lista, el Kanban, el dashboard y el panel del tray.
2. Arrastrar tarjetas entre columnas del Kanban (se desactivó `dragDropEnabled` en la ventana principal para no interferir con el drag & drop HTML5).
3. Crear, archivar, restaurar y eliminar proyectos con ambas modalidades.
4. Vincular una nota a un proyecto desde la nota flotante y convertir una selección en tarea.
5. Reabrir el panel del tray después de cerrarlo con el icono: el tercer clic de la prueba cayó en un Space a pantalla completa con la barra de menú oculta, por lo que el resultado no es concluyente.
6. `⌥N` desde otra aplicación: la nota debe quedar lista para escribir sin hacer clic.

## Limitaciones y pendientes

- La búsqueda usa `LIKE` de SQLite: no distingue mayúsculas solo en ASCII (`á` y `Á` se tratan como distintas).
- Tarjetas del dashboard reorganizables (sección 4): no implementadas todavía.
- Atajo `⌥N` configurable y `⌥⇧T` para nueva tarea (sección 17): pendientes.
- Restricción de comandos por ventana: todas las ventanas pueden invocar todos los comandos de la app; se abordará en la revisión de seguridad (Fase 9).
- Vinculación de proyectos con espacios de trabajo: Fase 6.
- Asociación de tareas con sesiones Pomodoro y tiempo registrado real: Fase 5.
- El panel del tray muestra un contorno de sombra nativa alrededor del margen transparente; es estético y queda por ajustar.

## Corrección: notas que no flotaban ni se movían

Reportado por el usuario tras la entrega: "las notas no se quedan encima de las aplicaciones, y no la puedo mover".

**Causas encontradas**

1. *No se movían.* `data-tauri-drag-region` invoca `start_dragging`, que no forma parte de `core:default`. La ventana principal no lo necesitaba porque usa la barra de título nativa. Además, el campo de título ocupaba casi toda la cabecera.
2. *No flotaban.* Las notas nacían en modo `normal`. En "Siempre encima" tampoco aparecían sobre apps a pantalla completa: Tauri no expone `FullScreenAuxiliary`. Experimentos con ventanas Swift mínimas en macOS 26 demostraron que eso no basta: **macOS fija al crear la ventana si podrá entrar en el espacio de otra app a pantalla completa, y solo lo permite si en ese momento la app es accesoria.** Una ventana creada en modo regular nunca aparece ahí, aunque la app pase después a accesoria; una creada en modo accesorio sigue apareciendo aunque la app vuelva a ser regular.
3. *Defecto propio de esta fase:* al reordenar `apply_display_mode`, `set_always_on_bottom(false)` se ejecutaba después de `set_always_on_top(true)` y devolvía la nota al nivel normal.
4. *Persistencia (Fase 3):* la escritura limitada a una cada 250 ms descartaba el último movimiento, y ⌘Q no pasa por `ExitRequested`, así que tampoco se guardaba al salir. Las notas reaparecían desplazadas.

**Cambios**

- Capability `notes` con `core:window:allow-start-dragging`, solo para `note-*`.
- Cabecera de la nota con `data-tauri-drag-region="deep"` y asa visible. Campos y botones siguen siendo interactivos. `maximizable(false)` evita que el doble clic maximice la nota.
- `windows::build_floating`: notas y panel del tray se crean con la app momentáneamente en modo accesorio. `windows::join_all_spaces` añade `CanJoinAllSpaces | FullScreenAuxiliary` mediante `objc2-app-kit`.
- El panel del tray se crea por código en `setup` (antes en `tauri.conf.json`) para aplicarle lo mismo.
- Las notas nuevas nacen en "Siempre encima"; cada nota puede cambiar de modo.
- Guardado de geometría 300 ms después del último movimiento o redimensionado.

**Verificado** con una instancia aislada (`HOME` temporal), dashboard abierto (app regular) y VS Code a pantalla completa en primer plano:

- Nota en "Siempre encima": en pantalla sobre VS Code, nivel flotante (capa 5).
- Arrastre real desde el asa: la ventana se movió y no se cambió de espacio.
- Arrastrar y salir enseguida con `quit`: SQLite guardó la posición final y la nota se restauró exactamente en ella.

**Pendiente de validación manual**

- Panel del tray sobre una app a pantalla completa: usa el mismo mecanismo, pero abrirlo exige pulsar el icono con la barra de menú oculta.
- Al crear una nota con el dashboard abierto, la app pasa un instante a modo accesorio: comprobar si el icono del Dock parpadea.

## Próxima fase

Fase 5: Pomodoro gestionado por Rust (resistente a suspensión y cambios de reloj), seguimiento manual de tiempo con asignación a tareas y proyectos, estadísticas y notificaciones locales.
