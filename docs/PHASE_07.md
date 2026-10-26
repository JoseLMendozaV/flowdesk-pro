# Fase 7 — Notas flotantes 2.0

Fecha de verificación: 26 de octubre de 2026.

Corresponde a la «fase 15 — Notas flotantes 2.0» del plan ampliado. Se desarrolló como fase 7 porque la fase 7 original (widgets nativos) se descartó por decisión del usuario.

Las notas pasan de un textarea con Markdown básico a un editor enriquecido. Conservan sus ventanas nativas, su posición, su color y su transparencia. Ninguna nota existente pierde contenido.

## Editor

**Tiptap 3.32** (ProseMirror), con mantenimiento activo e integración con React:

| Paquete | Aporta |
| --- | --- |
| `@tiptap/starter-kit` | Negrita, cursiva, subrayado, tachado, títulos (1–3), listas, listas numeradas, enlaces, código, bloques de código, citas, separadores y deshacer |
| `@tiptap/extension-list` | Listas de verificación, también anidadas |
| `@tiptap/extension-table` | Tablas básicas: insertar, añadir o quitar filas y columnas, quitar la tabla |
| `@tiptap/extensions` | Texto de ayuda en la nota vacía |
| Nodos propios (`src/features/notes/editor/attachments.tsx`) | Imagen redimensionable, archivo y audio |

- **Atajos de escritura:** `# ` título, `- ` lista, `1. ` lista numerada, `[] ` casilla, `> ` cita, `---` separador. Además, ⌘B, ⌘I y ⌘U.
- **Barra de formato:** compacta, pasa a dos filas en notas estrechas. Los controles de tabla aparecen dentro de una tabla.
- **Enlaces:** se abren con ⌘ + clic en el navegador predeterminado. Rust solo acepta `http`, `https` y `mailto`.
- **Carga diferida:** el editor (500 KB) se carga solo en las ventanas de nota (`React.lazy`). El dashboard y el panel de la barra de menús no lo cargan.

## Almacenamiento estructurado y versionado

| Columna | Contenido |
| --- | --- |
| `notes.content_format` | `markdown` (notas anteriores) o `rich-v1` |
| `notes.content_json` | Documento ProseMirror. Rust valida JSON, raíz `doc`, 2 MB, profundidad 64 y 100 000 nodos |
| `notes.content` | Texto plano derivado en Rust (`note_document.rs`). Lo siguen usando la búsqueda, la vista previa del dashboard, las tareas vinculadas y los espacios |
| `notes.revision` | Sube con cada cambio de título o contenido |

**Notas anteriores** (migración 10):
- La migración guarda una copia «legado» de cada nota no vacía en `note_content_versions` y no convierte nada.
- Al abrirla, el editor la muestra convertida desde el Markdown (texto escapado, sin HTML del usuario) con un aviso.
- La conversión solo se guarda cuando el usuario edita el contenido. Cambiar el color o la transparencia no la convierte.
- La copia «legado» nunca se descarta y se restaura desde Historial.

## Imágenes y archivos

- **Formas de adjuntar:**
  - pegar imágenes;
  - arrastrar archivos desde el Finder (Tauri entrega sus rutas);
  - elegirlos con el botón de imagen o de clip;
  - insertar desde el panel Adjuntos.
- **Almacenamiento:** `<datos>/note-attachments/<nota>/<id>.<ext>`. SQLite (`note_attachments`) guarda solo la referencia, el tipo, el tamaño y el nombre saneado. Nunca un BLOB.
- **Envío:** los bytes de una imagen pegada viajan como cuerpo crudo del IPC (`tauri::ipc::Request`), sin JSON.
- **Límites:**
  - 50 MB por archivo;
  - solo archivos normales, nunca carpetas, y con rutas absolutas;
  - el nombre conserva solo su parte final, sin caracteres de control ni punto inicial.
- **Visualización:**
  - Las imágenes PNG, JPEG, GIF y WebP se muestran como URL `blob:` local, sin abrir protocolos de archivo.
  - Se redimensionan arrastrando la esquina y el ancho se guarda en el documento.
  - El resto de archivos se ven como tarjeta con «Abrir» (aplicación predeterminada, `/usr/bin/open --`).
- **Protección frente a pérdidas:**
  - Quitar el nodo del documento no borra el archivo: el panel lo marca como «no usado en la nota».
  - Eliminar pide confirmación y mueve el archivo a la papelera (`.trash`) durante 30 días. Al iniciar, se purga lo que lleva más.
  - Restaurar una versión que usa un adjunto eliminado lo saca de la papelera.
  - Eliminar la nota borra sus adjuntos, porque ya se confirmó.

## Notas vinculadas a contextos

Panel **Contexto** de la nota:

| Contexto | Relación |
| --- | --- |
| Proyecto | `notes.project_id`, existente |
| Tareas | `task_notes`, existente; se buscan por título |
| Espacios de trabajo | `workspace_notes`, existente |
| Eventos | `note_context_links` (nuevo); un disparador borra el vínculo al borrar el evento |

- Desvincular nunca borra la tarea, el evento, el proyecto ni el espacio.
- `note_context_links` admite el tipo `document` para la biblioteca de conocimiento de una fase posterior. No se muestra porque esa biblioteca no existe.
- **Página Notas:** filtros por contexto (con tareas, con eventos, con adjuntos, con pendientes, fijadas), por proyecto y por espacio. Cada tarjeta lleva distintivos de lista de verificación, adjuntos, tareas y eventos.

## Notas por espacio de trabajo

- **Fijar en todos los espacios** (`notes.pinned_global`): la nota sigue visible al cambiar de espacio.
- **Por espacio:** «Mostrar también las notas globales» (`view_preferences.includeGlobalNotes`, activo por defecto). Desactivado, al activar el espacio solo se ven sus notas y las fijadas.
- Se mantienen el tamaño y la posición de cada ventana y la ventana única por nota (`note-<id>`).

## Notas de voz

- Los archivos de audio (M4A, MP3, WAV, AAC) se adjuntan como nodo de audio con reproductor.
- `note_attachments.transcript` queda reservado para la transcripción de la fase de voz, que usará su propio motor sin duplicar el procesamiento.
- La grabación desde el micrófono no está implementada: pediría permisos de macOS que la fase de voz gestionará.

## Guardado y recuperación

- **Autoguardado:** 650 ms después de dejar de escribir.
- **Al cerrar:** con ⌘W, Rust envía `flowdesk://note-flush` antes de ocultar la ventana. El botón de cerrar guarda antes. También se guarda al perder el foco.
- **Cierre inesperado:** cada cambio se anota en un diario local (`localStorage`, `flowdesk:note-draft:<id>`). Al reabrir la nota, si el diario difiere de lo guardado, ofrece «Recuperar» o «Descartar». El diario se borra al guardar.
- **Versiones** (`note_content_versions`):
  - una copia completa como mucho cada 10 minutos de edición, hasta 20 por nota, más el original «legado»;
  - restaurar guarda antes el estado actual («Antes de restaurar»).
- **Historial de cambios** (`note_revision_history`): cada guardado, con revisión, origen, caracteres y palabras. Hasta 100 por nota.
- **Listas de verificación** (`note_checklist_items`): derivadas del documento en cada guardado. Alimentan el contador de la nota y el filtro «Con pendientes».
- **Conflictos entre ventanas:**
  - El guardado envía la revisión sobre la que se editó; si otra ventana guardó después, Rust responde `NOTE_CONFLICT` y no sobrescribe.
  - La nota ofrece «Conservar la mía» (la otra queda en Historial) o «Usar la otra» (la mía queda en Historial).
  - Sin cambios propios pendientes, la ventana se sincroniza sola cuando otra guarda.

## Persistencia (migración 10)

- `notes`: `content_format`, `content_json`, `revision` y `pinned_global`.
- Tablas nuevas: `note_content_versions`, `note_revision_history`, `note_attachments`, `note_checklist_items` y `note_context_links`, con índices.
- Disparador `trg_events_delete_note_links`.
- Copia «legado» de cada nota no vacía.

## Guía de bienvenida

- **Notas flotantes:**
  - sube a la revisión 3 con el cambio de la versión 0.4.0;
  - contenido nuevo;
  - captura real de la nota con el editor (`npm run onboarding:screenshots -- notes`);
  - demostración con lista de verificación;
  - paso nuevo de la visita guiada sobre los filtros por contexto.
- **Espacios de trabajo:** revisión 2, por las notas globales y fijadas.
- Quien actualice desde una versión anterior verá ambas en **Novedades** como «Mejorado».

## Pruebas realizadas

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `npm run check` y `npm run build`: aprobados.
- `cargo test`: **94 pruebas aprobadas** (18 nuevas).
  - **Documento:**
    - texto derivado de cada bloque (títulos, listas, tablas, citas, código y separadores);
    - listas de verificación y adjuntos referenciados;
    - documentos no válidos, demasiado profundos o grandes;
    - recuento de palabras sin marcadores.
  - **Guardado:**
    - la migración conserva las notas anteriores con su original;
    - texto, listas, historial e instantánea;
    - la apariencia no sube la revisión;
    - conflicto con revisión antigua;
    - el Markdown sin convertir;
    - restaurar sin perder la versión actual;
    - límite de versiones conservando el original;
    - notas fijadas y notas globales por espacio.
  - **Adjuntos:**
    - nombres y tipos seguros;
    - archivos en el directorio administrado y no en SQLite;
    - en uso o sin usar;
    - papelera, restauración y purga a los 30 días;
    - límite de 50 MB.
  - **Contextos:**
    - vincular y desvincular sin borrar;
    - tipos y elementos inexistentes;
    - borrado del evento.
- `npm run test:onboarding`: **8 pruebas**. El historial por versión incluye la 0.4.0.
- `npm run test:onboarding-ui`: **21 flujos** en Chrome sin interfaz con el IPC simulado (7 nuevos):
  - la nota enriquecida muestra formato, lista, tabla, imagen (URL `blob:`) y archivo;
  - una nota antigua no se guarda al abrirla y se convierte al editarla;
  - la barra aplica negrita y el documento la guarda;
  - un conflicto se avisa sin sobrescribir;
  - se recupera lo escrito antes de un cierre inesperado;
  - el panel de adjuntos distingue lo usado;
  - la página Notas filtra por contexto.
- **App empaquetada con `HOME` aislado**, base de la 0.3.0 con una nota antigua no visible e inicio oculto:
  - aplicó la migración 10 sin abrir ventanas;
  - la nota conservó contenido, color, posición y transparencia, siguió en Markdown y obtuvo su versión «legado»;
  - `integrity_check = ok`; se cerró con una salida normal.
- **Migración 10 sobre una copia de la base real:**
  - la nota existente conserva título, contenido, color, posición, transparencia y tamaño de texto;
  - sigue en Markdown y tiene su versión «legado»;
  - `integrity_check = ok`. La copia se borró después.
- **Revisión visual** de la nota (formato, lista, imagen y tabla), la nota antigua con su aviso, los paneles Contexto, Adjuntos e Historial, y la página Notas con filtros, en claro y oscuro.

## Limitaciones

- **Arrastrar y soltar dentro de la nota:** con el gestor de arrastre de Tauri activo (necesario para recibir archivos del Finder), WebKit no permite arrastrar nodos con el ratón. Se reordenan cortando y pegando.
- **HEIC:** las imágenes HEIC se adjuntan como archivo, porque WebKit no las muestra en todas las versiones de macOS.
- **Resaltado de sintaxis:** los bloques de código no lo tienen.
