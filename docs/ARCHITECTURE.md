# Arquitectura

## Límites principales

La interfaz React presenta datos y captura intención del usuario. Las operaciones persistentes cruzan comandos Tauri tipados y se ejecutan en Rust. El frontend no abre SQLite ni construye consultas SQL.

```text
React / Zustand
      │ invoke + eventos
      ▼
Comandos Tauri
      │
      ▼
Servicios Rust ── SQLite local
      │
      └── ventanas y tray de macOS
```

SQLite es la única fuente principal.

## Persistencia

`src-tauri/src/database/mod.rs` abre una sola conexión protegida y aplica migraciones dentro de transacciones inmediatas. La migración `0001_initial.sql` contiene el esquema base completo. Cada migración aplicada queda registrada en `schema_migrations`.

Las consultas usan parámetros. Las eliminaciones y relaciones se expresan mediante claves foráneas con reglas `CASCADE` o `SET NULL` según la propiedad de los datos. Los filtros de tareas se construyen con fragmentos SQL fijos y valores enlazados; la búsqueda escapa `%`, `_` y `\`.

Reglas de eliminación (los recordatorios se borran con su entidad mediante disparadores):

- Tarea: borra sus subtareas, etiquetas asignadas y vínculos con notas; sesiones y registros de tiempo quedan sin tarea. Las etiquetas sin uso se eliminan.
- Proyecto: el usuario elige conservar las tareas (`SET NULL`) o borrarlas. Notas, sesiones y registros de tiempo nunca se borran. Archivar (`archived_at`) es la alternativa no destructiva y conserva el estado previo.
- Nota: borra su ventana y sus vínculos con tareas; las tareas se conservan.

Tareas, proyectos y eventos pasan antes por la papelera (`commands/trash.rs`). Se guarda en `trash_items` una instantánea de las filas que se van a borrar y de las referencias que las reglas anteriores dejarán en NULL, y después se borra de verdad. Así ninguna consulta tiene que excluir lo borrado. Restaurar reinserta con los mismos identificadores, omite lo que ya no existe y vuelve a enlazar solo lo que sigue sin enlazar. Se purga a los 30 días.

### Docencia

`src-tauri/src/teaching/` contiene la gestión académica traída de Control Docente: sus tablas (identificadores enteros) viven en la misma base, sus comandos llevan el prefijo `teaching_` y usan la conexión con `Database::lock()`. `sync.rs` refleja cada materia como proyecto, el horario y las entregas como eventos (`source = 'teaching'`) y los seguimientos como tareas, dentro de la transacción de cada comando; los disparadores de la migración 13 limpian lo reflejado. La interfaz (`src/features/teaching/`) se carga solo al abrir Docencia y su CSS está limitado a `.teaching`. Detalles en `docs/DOCENCIA.md`.

`academic.rs` guarda el calendario académico. Los días sin clases se aplican como excepciones de las franjas (aparte de las manuales, en `skipped_occurrences`) y quitan las sesiones vacías. `syllabus.rs` lleva el plan del curso: crea la nota de preparación con `notes::insert_prepared_note` dentro de la transacción y abre su ventana después con `notes::present_note`, ya sin el bloqueo de la base. Detalles en `docs/MEJORAS_0.9.md`.

`src-tauri/src/backup.rs` hace las copias de seguridad diarias en la carpeta elegida, con su propio hilo (`flowdesk-backups`) y su configuración en `backups.json`. Restaurar deja `restore-pending.sqlite3`, y `Database::initialize` lo pone en lugar de la base antes de abrirla (`apply_pending`). Tras las migraciones, devuelve los adjuntos que trae la copia (`finish_restore`).

### Repeticiones

Tareas y eventos guardan su regla como JSON validado en `recurrence.rs`, con fechas en hora local de pared. Una tarea repetida es una fila por repetición: al completarla se crea la siguiente. Un evento repetido es una sola fila con excepciones, y `list_calendar` la expande en Rust para el rango pedido. El servicio de recordatorios calcula en Rust el aviso de la próxima repetición y lo reconcilia con los demás en SQL.

Las ventanas comunican cambios mediante el evento `flowdesk://data-changed` con el tipo afectado (`tasks`, `projects`, `notes`, `time`, `calendar`, `reminders`, `workspaces`, `clipboard`, `app-usage`, `onboarding`, `trash`); cada vista vuelve a consultar solo lo que muestra. El servicio de recordatorios escucha el mismo evento en Rust.

### Espacios de trabajo

El espacio activo (`settings.selected_workspace_id`) se aplica en Rust a cada consulta mediante los fragmentos de `commands/workspaces.rs`: tareas del espacio o de sus proyectos, proyectos vinculados, notas del espacio, de sus proyectos o sin espacio, y eventos de sus proyectos o sin proyecto. Recordatorios y estadísticas de tiempo no se filtran. Lo creado con un espacio activo queda vinculado a él; nada se duplica.

## Ciclo de vida

El proceso Rust controla el tray y la ventana principal. `CloseRequested` se cancela para ocultar el dashboard. La acción explícita `Salir de FlowDesk` llama a la salida completa. El plugin de instancia única enfoca la ventana existente ante una segunda apertura.

El panel `tray-panel` es una segunda ventana sin marco, no redimensionable y excluida de la persistencia de geometría. Positioner recibe los eventos físicos del icono y coloca el panel bajo él respetando los límites del monitor. Al perder foco, el panel se oculta.

La ventana principal nace invisible para evitar destellos. En un inicio normal Rust restaura tamaño/posición y la muestra; cuando recibe `--autostart`, consulta SQLite y puede mantener la aplicación en modo accesorio, sin dashboard ni icono en el Dock. El registro de inicio se administra con un LaunchAgent oficial de Tauri.

## Servicios en segundo plano

`src-tauri/src/background/` contiene lo que debe seguir funcionando sin ventanas. El servicio de temporizadores mide con el reloj de actividad del sistema (no avanza en reposo ni con cambios de hora) y detecta el reposo comparándolo con el reloj continuo. Su hilo despierta solo cuando hace falta y comunica los cambios con `flowdesk://timer-changed`. Las ventanas solo muestran ese estado.

Además del temporizador hay tres hilos, todos con la señal común `Wakeup` para despertar sin sondear cuando cambian datos o preferencias:

- `flowdesk-reminders`: deriva los avisos de tareas, notas y eventos y los entrega; duerme hasta el siguiente aviso, como mucho 60 s. También actualiza el próximo evento junto al icono de la barra de menús, que comparte el título con el temporizador (este tiene prioridad).
- `flowdesk-clipboard`: con consentimiento, compara `NSPasteboard.changeCount` cada segundo; si no, duerme indefinidamente.
- `flowdesk-app-tracking`: con consentimiento, una muestra cada 5 s de la app en primer plano y la inactividad; si no, duerme indefinidamente.

Las consultas a macOS que comparten (app en primer plano, inactividad, información de un `.app`) están en `background/macos.rs` y no requieren permisos de accesibilidad.

Las ventanas ocultas no repintan: Rust anuncia `flowdesk://visibility` y `useDataChanged` y los hooks del temporizador aplazan sus actualizaciones hasta que la ventana vuelve a verse. Sin esto, WebKit mantiene un display link activo en páginas ocultas (ver `docs/PHASE_05.md`).

## Notas flotantes

Cada nota tiene una entidad `notes`, una configuración `note_windows` y una ventana dinámica con etiqueta `note-{uuid}`. SQLite es la única fuente de su geometría: el plugin `window-state` solo gestiona la ventana `main`. Las capabilities admiten únicamente el patrón `note-*` además de las ventanas estáticas.

**Contenido.**
- El editor es Tiptap/ProseMirror y el documento se guarda en `notes.content_json` (formato `rich-v1`).
- Rust lo valida y deriva el texto plano de `notes.content` (búsquedas, vistas previas, tareas) y las listas de verificación (`note_document.rs`).
- Las notas anteriores siguen en Markdown hasta que se editan; su original queda en `note_content_versions`.

**Guardado.**
- Mediante un comando tipado 650 ms después de dejar de escribir, al perder el foco y antes de ocultar la ventana (`flowdesk://note-flush`).
- Cada guardado envía la revisión de partida: si otra ventana guardó antes, Rust responde `NOTE_CONFLICT` y no sobrescribe.
- Hay instantáneas periódicas y un historial ligero de cambios. Un diario en `localStorage` permite recuperar lo escrito tras un cierre inesperado.

**Adjuntos.** Los archivos van en `note-attachments/<nota>/` dentro del directorio de datos y SQLite guarda su referencia. Borrar los mueve 30 días a `.trash/`. Las imágenes se muestran como URL `blob:` a partir de sus bytes.

**Contextos.** Proyecto, tareas y espacios reutilizan `notes.project_id`, `task_notes` y `workspace_notes`; los eventos usan `note_context_links`.

**Geometría.** La geometría se captura de forma limitada a cuatro escrituras por segundo, al perder foco, al cerrar y al finalizar la aplicación.

Los niveles disponibles son normal, siempre encima y siempre debajo. El último usa `always_on_bottom`; no modifica niveles privados de AppKit ni promete quedar anclado debajo de los iconos del Finder.

## Bienvenida y novedades

La ventana `onboarding` (una sola instancia, creada al pedirla) presenta las funciones a partir del registro de `src/features/onboarding/registry/`. Una función solo aparece si el registro la marca como implementada, verificada y habilitada **y** Rust declara sus capacidades (`commands/onboarding.rs`). La fase no interviene. Las preferencias, lo que el usuario ya conoce (`{ id: revisión }`) y el progreso viven en `onboarding_state`. La ventana principal decide al hacerse visible si abre la bienvenida o las novedades, así que un inicio oculto con macOS nunca abre ventanas. La visita guiada resalta elementos con `data-tour-id` estables. Detalles en `docs/ONBOARDING.md`.

## Seguridad

La capability inicial se limita a `core:default`. Las ventanas de notas, la principal y la de bienvenida pueden moverse (`window-dragging`); solo la principal busca actualizaciones (`updates`) y abre el selector de archivos (`dialogs`). La política CSP restringe recursos a la aplicación y a los canales IPC/asset de Tauri. Cada módulo futuro deberá declarar únicamente los permisos que necesite.
