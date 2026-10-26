# Fase 6 — Herramientas de productividad

Fecha de verificación: 25 de octubre de 2026.

Calendario, recordatorios, espacios de trabajo, portapapeles y seguimiento automático por aplicación. Los tres servicios nuevos en segundo plano viven en Rust (`src-tauri/src/background/`) y funcionan con el dashboard cerrado.

## Calendario

- Vistas de día, semana y mes. Se navega con ← → y se vuelve a hoy con T; D, S y M cambian la vista, que se recuerda entre sesiones.
- Eventos con hora o de todo el día: título, notas, ubicación, proyecto y aviso. Pulsar una franja crea un evento a esa hora; pulsar un día en el mes crea un evento de todo el día.
- Las tareas con fecha límite aparecen en su día, con hora o en la franja de todo el día, y se completan desde el calendario.
- Los eventos que se solapan se reparten el ancho de la columna. Una línea marca la hora actual y solo avanza con la ventana visible.
- Dashboard y panel de la barra de menú: próximo compromiso con fecha (o "Todo el día"). El botón **Agenda** del panel abre el calendario.
- Integración futura: `calendar_events` tiene `source` ('local') y `external_id` con índice único. No hay sincronización externa en esta versión.

Los eventos de todo el día se guardan desde la medianoche local del primer día hasta la medianoche del día siguiente al último (fin exclusivo). Los días se suman con `setDate`, así el horario de verano no los desplaza.

### Mejora posterior (26 de octubre de 2026): tareas en la cuadrícula

- **Tareas con hora:** en las vistas de día y semana aparecen como bloques a su hora, con la altura de su tiempo estimado (30 minutos si no lo tienen).
- **Tareas sin hora:** se guardan a mediodía. El selector «Sin hora» elige dónde se muestran: a una hora por defecto (12:00 de inicio; también 8, 9, 10, 14, 16 o 18) o en la franja «Todo el día». La preferencia se recuerda.
  - En la cuadrícula llevan borde discontinuo y «Sin hora fija»; la tarea no cambia en la base de datos.
- **Columnas:** tareas y eventos que coinciden se reparten el ancho, con el mismo algoritmo de columnas (`placeDayItems` en `calendarDates.ts`).
- **Clics:** el círculo completa la tarea; el resto del bloque abre Tareas con su detalle.
- **Pruebas:**
  - `npm run test:calendar`: 5 pruebas de colocación (hora y duración, duración por defecto, hora por defecto o todo el día, columnas compartidas, final del día);
  - un flujo nuevo en `npm run test:onboarding-ui`.
- **Guía:** la ficha Agenda pasa a la revisión 2 (versión prevista 0.5.0), con un paso nuevo de la visita guiada sobre el selector.

## Recordatorios

`background/reminders.rs`, hilo `flowdesk-reminders`.

**Qué avisa**
- Tareas abiertas con hora: N minutos antes (por defecto 10; configurable de 0 a 1 día).
- Eventos con aviso: minutos antes del inicio. En los de todo el día se cuenta desde las 9:00.
- Notas con recordatorio, salvo las archivadas.
- Resumen diario: tareas de hoy y vencidas a la hora elegida (por defecto 9:00), una vez al día, solo si hay algo pendiente y durante las 3 horas siguientes.

**Diseño**
- Las filas de `reminders` se derivan de tareas, notas y eventos (`reconcile`). Al cambiar la fecha se reprograman, al completar o borrar se cancelan y al reabrir vuelven. La tabla solo recuerda qué aviso se entregó.
- La relación es polimórfica: unos disparadores borran el aviso al borrar la entidad.
- El hilo despierta en la siguiente hora de aviso, o como mucho cada 60 s, para notar el reposo, los cambios de hora y el resumen diario. También despierta al momento cuando cambian tareas, notas o eventos: escucha en Rust el mismo evento `flowdesk://data-changed` que usan las ventanas (comprobado en el código de Tauri 2.12.5: `emit` también llega a `listen_any`).

**Duplicados**
- Cada entrega escribe el estado y una fila en `notification_history` con clave única `reminder:{id}:{hora}`, y solo después muestra el aviso.
- Un cierre inesperado puede perder un aviso, pero nunca duplicarlo.

**Reposo y app cerrada**
- Lo vencido durante el reposo se entrega al despertar.
- Lo que lleva más de 6 h vencido se marca como perdido y no se anuncia.
- Un aviso fechado en el pasado al crearlo tampoco se anuncia.

**Silencio**
- Horas de silencio configurables, también cruzando la medianoche, y un interruptor general.
- Los avisos silenciados no se muestran, pero quedan en la lista **Recordatorios** del panel derecho del inicio, junto con los próximos 7 días.

## Espacios de trabajo

`commands/workspaces.rs`.

- Cada espacio tiene nombre, color, icono, vista de tareas al activarlo (Hoy, Próximas o Todas), proyectos y notas vinculados, y carpetas y apps asociadas.
- **El espacio activo** se guarda en `settings.selected_workspace_id`. Rust lo aplica en cada consulta, así la ventana principal, el panel de la barra de menú y las notas coinciden. Se cambia desde la barra lateral o desde el panel.

**Qué filtra el espacio activo**

| Contenido | Qué se ve |
| --- | --- |
| Tareas | Las asignadas al espacio y las de sus proyectos |
| Proyectos | Los vinculados al espacio |
| Notas | Las del espacio, las de sus proyectos y las que no pertenecen a ningún espacio |
| Eventos | Los de sus proyectos y los que no tienen proyecto |
| Dashboard y calendario | Lo mismo |
| Recordatorios y estadísticas de tiempo | Sin filtro |

**Datos sin duplicar**
- Una tarea, nota o proyecto creado con un espacio activo queda vinculado a él.
- Borrar un espacio solo borra sus vínculos.
- Archivar el espacio activo vuelve a mostrar todo.

**Notas flotantes**
- Al cambiar de espacio se ocultan las notas de otros espacios y se muestran las del nuevo, sin cambiar la preferencia `is_visible` del usuario. Al volver, reaparecen.
- Las notas nuevas se muestran sin robar el foco.

**Carpetas y apps**
- Se eligen con el selector de macOS (`tauri-plugin-dialog` 2.8.3, permiso `dialog:allow-open` solo para la ventana principal).
- Se guardan rutas absolutas validadas: deben existir, no pueden contener `..` y las apps deben ser `.app`. Como máximo 20 por espacio.
- Se abren con `/usr/bin/open -- <ruta>`, sin shell. Si una ruta desaparece, se marca como no encontrada.

## Portapapeles

`background/clipboard.rs`, hilo `flowdesk-clipboard`. Está **desactivado hasta que el usuario lo autoriza** en una pantalla que explica qué se guarda y sus límites.

**Captura**
- macOS no notifica los cambios de `NSPasteboard`. Mientras está activo y sin pausa, se compara `changeCount` cada segundo, como Maccy o Raycast. Desactivado o en pausa, el hilo duerme sin sondear.
- Lo que ya estaba copiado al activarlo no se guarda.

**Qué no se guarda**
- Contenido marcado con `org.nspasteboard.ConcealedType`, `TransientType` o `AutoGeneratedType` (convención de los gestores de contraseñas). Ni siquiera se lee.
- Lo copiado con una app excluida en primer plano. Por defecto: Acceso a Llaveros, Contraseñas, 1Password, Bitwarden y LastPass. Se añaden más con el selector de apps.
- Por defecto, texto con aspecto de credencial: claves privadas, tokens con prefijos conocidos (OpenAI, GitHub, GitLab, Slack, AWS, Google, npm), JWT, números de tarjeta con dígito de control Luhn, contraseñas que mezclan los cuatro tipos de carácter y cadenas largas de alta entropía.
  - Si el usuario desactiva esta opción, se guardan marcadas y **su texto nunca llega a la interfaz** ni a la búsqueda; solo se pueden volver a copiar.
- Textos de más de 1 MB e imágenes de más de 8 MB.

**Historial**
- Texto e imágenes PNG o TIFF; las imágenes van a `clipboard/` en el directorio de datos.
- Búsqueda con comodines escapados, favoritos y volver a copiar (la escritura propia no se recaptura; el elemento sube al principio).
- Borrar elemento; limpiar todo salvo favoritos.
- Capacidad configurable (50–1 000, los favoritos no cuentan), pausa y desactivación.
- Un contenido repetido sube al principio en lugar de duplicarse (hash FNV-1a estable).
- Las miniaturas llegan como bytes (`tauri::ipc::Response`) y se muestran con una URL `blob:`.

**Limitaciones que se explican en la interfaz**
- La detección de credenciales es heurística: puede no reconocer algunas y descartar texto normal.
- La app de origen es la que estaba en primer plano al copiar; una copia hecha desde segundo plano puede atribuirse a otra.

## Seguimiento automático por aplicación

`background/app_tracking.rs`, hilo `flowdesk-app-tracking`. **Desactivado por defecto**; se activa en Tiempo, que explica qué se guarda.

**Qué guarda**
- Solo el identificador y el nombre de la app en primer plano (`NSWorkspace`). **Nunca títulos de ventanas ni documentos.**
- No requiere permisos de accesibilidad ni de grabación de pantalla.

**Cómo mide**
- Una muestra cada 5 s.
- La inactividad se lee con `CGEventSourceSecondsSinceLastEventType`. Pasado el umbral (por defecto 5 min, de 1 a 60), el tramo se cierra en el momento de la última actividad.
- Un tramo también se cierra al cambiar de app y al pasar a una app excluida.
- Si entre muestras pasan más de 30 s, o el reloj retrocede, se cierra en la última muestra. Así el reposo y los cambios de hora no suman tiempo.
- Los tramos de menos de 3 s no se guardan.

**Guardado y estadísticas**
- Punto de control cada 60 s y cierre exacto al pausar, desactivar o salir.
- Las estadísticas de hoy y de la semana incluyen el tramo en curso.
- Retención de 90 días, configurable de 7 a 365. Los datos se pueden borrar.
- Está separado de `time_entries`: el uso de apps no cuenta como tiempo registrado de trabajo.

## Pruebas realizadas

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `npm run check` y `npm run build`: aprobados.
- `cargo test`: **68 pruebas aprobadas** (34 nuevas).
  - **Calendario:** validación, solapamiento de intervalos, eventos que se conservan al borrar su proyecto y próximo compromiso.
  - **Recordatorios:** aviso único antes del vencimiento, reprogramación, cancelación y reapertura, borrado por disparador, fechas pasadas, avisos perdidos tras 6 h, entrega tras reposo, silencio y desactivación, notas y eventos, agrupación, resumen diario único y espera máxima de 60 s.
  - **Espacios:** filtro de tareas, proyectos, eventos y dashboard; vinculación automática; notas globales y por espacio; archivado y borrado sin pérdida de datos; validación de rutas.
  - **Portapapeles:** detección de credenciales (8 positivos y 7 negativos), contenido protegido, apps excluidas, duplicados, capacidad con favoritos, imágenes y su archivo, y búsqueda que escapa `%`.
    - Además, **lectura y escritura reales con AppKit sobre un pasteboard privado** (`pasteboardWithUniqueName`), incluido `ConcealedType`, sin tocar el portapapeles del usuario.
  - **Seguimiento:** cambio de app, inactividad, apps excluidas, reposo y reloj atrasado, puntos de control, estadísticas en vivo y retención.
- **App empaquetada con `HOME` aislado:**
  1. Tres avisos sembrados (tarea, nota y evento) se entregaron con **0 s de retraso** con la app en segundo plano. `notification_history` tiene una sola fila por aviso.
  2. Las migraciones 6–8 se aplicaron sobre la base de la versión anterior: `integrity_check = ok`, `foreign_key_check` vacío.
  3. Iniciando oculta (`--autostart`) con el espacio «Investigación» activo, `CGWindowList` mostró solo la nota global y la de Investigación. Con «Docencia», la global y la de Docencia. `is_visible` siguió a 1 en las tres.
  4. Seguimiento automático: punto de control a los 60 s y cierre del tramo al salir (95 s).
  5. **CPU en segundo plano** con el seguimiento activo y dos notas abiertas: 0,05 s de CPU en 75 s (≈0,07 %). RSS 108 MB.
- **Migraciones 5–8 sobre una copia de la base real:** versiones 1–8, `integrity_check = ok`, sin violaciones y datos intactos. La copia se borró después.
- **Revisión visual** de calendario (día, semana y mes, en claro y oscuro), diálogo de evento, preferencias de recordatorios, espacios (lista, detalle y selector), portapapeles (consentimiento e historial) y tiempo por aplicación.
  - Se hizo en Chrome sin interfaz con un arnés temporal que simulaba el IPC de Tauri (`@tauri-apps/api/mocks`), para no tomar el control de la pantalla mientras el Mac estaba en uso. El arnés se eliminó.
  - Se corrigieron: el próximo compromiso de todo el día aparecía como "00:00", el número de caracteres salía dos veces en las credenciales ocultas, una imagen ilegible mostraba un icono roto y faltaba concordancia en "1 abiertas".

## Validación manual en el Mac (con la interfaz real)

El usuario autorizó tomar el control de la pantalla y del portapapeles. Se usaron sus datos reales con elementos de prueba que después se borraron, y su portapapeles se guardó completo (HTML y texto) y se restauró al final. Clics reales con `CGEvent` y teclado con System Events.

- **Avisos:**
  - Con otra app delante, el banner apareció a la hora exacta («Segunda prueba de aviso · Tarea: vence a las 16:02»).
  - **Defecto encontrado y corregido:** con FlowDesk en primer plano el aviso se entregaba sin banner. El delegado de `mac-notification-sys` no implementa `userNotificationCenter:shouldPresentNotification:`, y sin él macOS no presenta los avisos de la app activa. `background/macos.rs` añade ese único método al iniciar (`class_addMethod`, que no sustituye una implementación existente). Verificado: banner con FlowDesk delante a la hora exacta.
  - Crear un evento y cambiar de espacio despertaron el servicio al momento, que programó avisos de tareas insertadas mientras dormía.
- **Espacios:** creados desde la interfaz, con una nota flotante en cada uno.
  - Alfa → Beta ocultó la nota de Alfa.
  - Beta → Alfa (desde el selector de la barra lateral) mostró la de Alfa y ocultó la de Beta.
  - «Todos los espacios» mostró las dos.
  - `is_visible` siguió a 1 y el dashboard y «Notas recientes» se filtraron correctamente.
  - **Defecto encontrado y corregido:** al reaparecer, la nota quitaba el foco a la ventana desde la que se cambió de espacio. Ahora se devuelve el foco a esa ventana. Verificado.
- **Selectores:**
  - El de carpetas solo permite carpetas.
  - El de apps abre en Aplicaciones y guardó la ruta real (`/System/Applications/Calculator.app`).
  - «Abrir» lanzó la app.
- **Portapapeles** activado desde la pantalla de consentimiento:
  - Guardó un texto normal, una URL y una imagen; la miniatura se cargó por bytes.
  - Descartó el contenido marcado con `ConcealedType` y un texto con forma de contraseña.
  - «Copiar de nuevo» escribió el texto en el portapapeles y lo subió al principio sin duplicarlo.

## Identidad visual

Iconos propios proporcionados por el usuario. Los originales están en `src-tauri/icons/source/`.

- **Icono de la app** (Dock, Finder, avisos y `.dmg`):
  - El original no tenía transparencia: se recortó con una máscara redondeada.
  - Se colocó en la retícula de macOS (lienzo de 1024 y cuerpo de 824).
  - Los tamaños se generaron con `tauri icon`, sin las variantes de Android e iOS.
- **Logotipo «F»** en la barra lateral y el panel (`src/assets/flowdesk-logo.png`). Se eliminaron las motas semitransparentes del fondo conservando solo la región principal.
- **Barra de menús:** la silueta de la «F» como imagen *template* (`icons/tray-template.png`, `icon_as_template`), que macOS tiñe según el aspecto de la barra.
- El procesado se hizo con un script de Swift y CoreGraphics, sin dependencias nuevas.

## Limitaciones

- El portapapeles y el seguimiento sondean a 1 s y 5 s porque macOS no ofrece notificaciones para esos cambios sin permisos adicionales. Con App Nap el sistema puede espaciar las muestras; el tiempo entre muestras se atribuye a la app de la muestra anterior.
- Las estadísticas por app asignan cada tramo al día en que empezó.
- Los recordatorios no se repiten (no hay tareas recurrentes, fuera de alcance). Tras más de 6 h con la app cerrada no se anuncian.
- No hay sincronización con calendarios externos; solo el esquema preparado.

## Próxima fase

Fase 7: notas flotantes 2.0 (la fase 7 original, widgets nativos, se descartó por decisión del usuario).
