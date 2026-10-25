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
      ├── ventanas y tray de macOS
      └── snapshot App Group (fase de widgets)
```

SQLite es la única fuente principal. Cuando se implemente WidgetKit, Rust exportará un snapshot mínimo al contenedor App Group; la extensión no escribirá directamente en la base principal.

## Persistencia

`src-tauri/src/database/mod.rs` abre una sola conexión protegida y aplica migraciones dentro de transacciones inmediatas. La migración `0001_initial.sql` contiene el esquema base completo. Cada migración aplicada queda registrada en `schema_migrations`.

Las consultas usan parámetros. Las eliminaciones y relaciones se expresan mediante claves foráneas con reglas `CASCADE` o `SET NULL` según la propiedad de los datos. Los filtros de tareas se construyen con fragmentos SQL fijos y valores enlazados; la búsqueda escapa `%`, `_` y `\`.

Reglas de eliminación:

- Tarea: borra sus subtareas, etiquetas asignadas y vínculos con notas; sesiones y registros de tiempo quedan sin tarea. Las etiquetas sin uso se eliminan.
- Proyecto: el usuario elige conservar las tareas (`SET NULL`) o borrarlas. Notas, sesiones y registros de tiempo nunca se borran. Archivar (`archived_at`) es la alternativa no destructiva y conserva el estado previo.
- Nota: borra su ventana y sus vínculos con tareas; las tareas se conservan.

Las ventanas comunican cambios mediante el evento `flowdesk://data-changed` con el tipo afectado (`tasks`, `projects`, `notes`); cada vista vuelve a consultar solo lo que muestra.

## Ciclo de vida

El proceso Rust controla el tray y la ventana principal. `CloseRequested` se cancela para ocultar el dashboard. La acción explícita `Salir de FlowDesk` llama a la salida completa. El plugin de instancia única enfoca la ventana existente ante una segunda apertura.

El panel `tray-panel` es una segunda ventana sin marco, no redimensionable y excluida de la persistencia de geometría. Positioner recibe los eventos físicos del icono y coloca el panel bajo él respetando los límites del monitor. Al perder foco, el panel se oculta.

La ventana principal nace invisible para evitar destellos. En un inicio normal Rust restaura tamaño/posición y la muestra; cuando recibe `--autostart`, consulta SQLite y puede mantener la aplicación en modo accesorio, sin dashboard ni icono en el Dock. El registro de inicio se administra con un LaunchAgent oficial de Tauri.

## Servicios en segundo plano

`src-tauri/src/background/` contiene lo que debe seguir funcionando sin ventanas. El servicio de temporizadores mide con el reloj de actividad del sistema (no avanza en reposo ni con cambios de hora) y detecta el reposo comparándolo con el reloj continuo. Su hilo despierta solo cuando hace falta y comunica los cambios con `flowdesk://timer-changed`. Las ventanas solo muestran ese estado.

Las ventanas ocultas no repintan: Rust anuncia `flowdesk://visibility` y `useDataChanged` y los hooks del temporizador aplazan sus actualizaciones hasta que la ventana vuelve a verse. Sin esto, WebKit mantiene un display link activo en páginas ocultas (ver `docs/PHASE_05.md`).

## Notas flotantes

Cada nota tiene una entidad `notes`, una configuración `note_windows` y una ventana dinámica con etiqueta `note-{uuid}`. SQLite es la única fuente de su geometría: el plugin `window-state` solo gestiona la ventana `main`. Las capabilities admiten únicamente el patrón `note-*` además de las ventanas estáticas.

El contenido se guarda mediante un comando tipado después de 650 ms sin cambios. Rust valida título, contenido, color, transparencia y tamaño de texto antes de realizar una transacción. La geometría se captura de forma limitada a cuatro escrituras por segundo, al perder foco, al cerrar y al finalizar la aplicación.

Los niveles disponibles son normal, siempre encima y siempre debajo. El último usa `always_on_bottom`; no modifica niveles privados de AppKit ni promete quedar anclado debajo de los iconos del Finder.

## Seguridad

La capability inicial se limita a `core:default`. La política CSP restringe recursos a la aplicación y a los canales IPC/asset de Tauri. Cada módulo futuro deberá declarar únicamente los permisos que necesite.
