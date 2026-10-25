# Fase 3 — Notas flotantes

Fecha de verificación: 25 de octubre de 2026.

## Implementado

- CRUD local de notas y segunda migración versionada.
- Creación transaccional de nota y configuración de ventana.
- Varias ventanas Tauri independientes dentro de un solo proceso.
- Editor con guardado automático después de 650 ms sin cambios.
- Título y contenido con límites validados en Rust.
- Markdown básico seguro: títulos, negrita y listas, sin HTML arbitrario.
- Color, transparencia y tamaño de texto por nota.
- Modos normal, siempre encima y debajo de ventanas.
- Posición, tamaño, visibilidad, altura expandida y estado colapsado persistentes.
- Restauración de las notas visibles al reiniciar.
- Ocultar o cerrar sin perder contenido.
- Archivar, restaurar y eliminar con confirmación.
- Recordatorio persistido para conectarlo al servicio de notificaciones de una fase posterior.
- Conversión de la selección del editor en una tarea.
- Búsqueda básica y listado de notas activas/archivadas.
- Creación desde dashboard, panel del tray, menú contextual y atajo global `Option + N`.
- Detección y exposición del estado de registro del atajo en Configuración.

## Pruebas realizadas

- `npm run check` y `npm run build`: aprobados.
- `cargo clippy --all-targets -- -D warnings`: aprobado.
- `cargo test`: 8 pruebas aprobadas.
- `npm run bundle:macos`: `.app` y `.dmg` generados.
- Migración 2 aplicada sobre la base existente.
- Ventana de nota restaurada con tamaño `360×340` y posición `120×120`.
- Nivel siempre encima observado como ventana de nivel elevado en macOS.
- Vista previa Markdown activada y renderizada dentro del `.app` empaquetado.
- `Option + N` generó una segunda entidad y una segunda ventana reales.
- Ambas ventanas convivieron dentro de un único proceso.
- Reinicio de la aplicación restauró dos ventanas y sus geometrías.
- La escritura de geometría limitada persistió una posición centrada inicialmente nula como `704×396`.
- Las dos notas creadas para las pruebas se eliminaron explícitamente al terminar.

La inyección automatizada de texto fue bloqueada por los permisos de entrada de macOS, por lo que el guardado automático del contenido requiere todavía una prueba manual escribiendo en el editor. La transacción y persistencia de entidades sí están cubiertas por pruebas Rust.

## Limitaciones reales

- “Debajo de ventanas” usa la API pública `always_on_bottom`. No garantiza quedar debajo de los iconos del Finder ni comportarse como un widget nativo.
- Los recordatorios se almacenan, pero todavía no programan notificaciones.
- La vinculación visual con proyectos y espacios llegará cuando esos módulos tengan CRUD completo.
- Mission Control, pantalla completa y configuraciones con varios monitores requieren validación manual.

## Próxima fase

Fase 4: CRUD completo de tareas y proyectos, prioridades, subtareas, etiquetas, filtros, búsqueda, vistas lista/Kanban y relaciones con notas.
