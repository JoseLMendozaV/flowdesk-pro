# Repeticiones, papelera y paleta de comandos (0.6.0)

Fecha de verificación: 26 de octubre de 2026.

Tres funciones pedidas por el usuario fuera del plan por fases. La fase 8 (IA local) no cambia: sigue pendiente y deshabilitada.

## Tareas y eventos que se repiten

La regla se guarda como JSON en `tasks.recurrence_rule` y `calendar_events.recurrence_rule`. Rust la valida y normaliza (`src-tauri/src/recurrence.rs`):

| Campo | Contenido |
| --- | --- |
| `frequency` | `daily`, `weekly`, `monthly` o `yearly` |
| `interval` | 1 a 99 («cada 2 semanas») |
| `weekdays` | Solo semanales: 1 = lunes … 7 = domingo. Vacío = el día del inicio |
| `fromCompletion` | Solo tareas: la siguiente se cuenta desde el día en que se completa |
| `until` | Último instante en que puede empezar una repetición; `null` = sin fin |
| `dayOfMonth` | Solo tareas mensuales o anuales: el día pedido. Lo mantiene Rust para que el 31 caiga el 28 de febrero y vuelva al 31 de marzo |

Las fechas se calculan en hora local de pared: una tarea de las 9:00 sigue a las 9:00 tras el cambio de horario. Si la hora no existe por el cambio, pasa a la siguiente.

**Interfaz.**
- El campo **Repetir** está en el detalle de la tarea y en el diálogo del evento. Ofrece: cada día, días laborables, cada semana, cada mes, cada año o «Personalizar…».
- «Personalizar…» permite elegir intervalo, unidad, días de la semana, fin y, en tareas, «Según la fecha prevista» o «Desde que la completo».
- Cambiar la fecha mueve también el día de una regla semanal de un solo día.

### Tareas

- Una tarea repetida necesita fecha límite.
- **Al completarla** se crea la siguiente con el mismo título, descripción, prioridad, proyecto, espacio, estimación, etiquetas y notas vinculadas. Sus subtareas se copian sin completar, y la regla pasa a la nueva.
- **Fechas fijas:** la siguiente es la primera fecha de la serie que no haya pasado. Completar con tres días de retraso una tarea diaria crea la de hoy, no tres atrasadas.
- **«Desde que la completo»:** cuenta desde el día en que se completa, a la hora de la tarea.
- **Deshacer un clic por error:** al reabrir la tarea, la repetición creada se borra si nadie la ha tocado. Se usa la marca `recurrence_pristine`: un disparador la quita en cuanto cambia `updated_at`. Tampoco se borra si tiene tiempo registrado.
- **«Saltar esta vez»** pasa la tarea a su siguiente fecha sin completarla.
- Completarla otra vez no crea duplicados: `recurrence_next_id` recuerda la que ya se creó.
- Las listas muestran ↻ en las tareas que se repiten.

### Eventos

- La serie es una sola fila. `list_calendar` la expande en Rust para el rango visible, con un tope de 1 000 repeticiones por evento y consulta.
- Una repetición que empezó antes del rango y sigue en curso también aparece.
- Las repeticiones quitadas o editadas por separado se guardan en `calendar_events.recurrence_exceptions`, por su inicio original.
- **Al guardar o borrar una repetición**, el diálogo pregunta a cuáles se aplica:

| Opción | Al guardar | Al borrar |
| --- | --- | --- |
| Solo este evento | La serie la excluye y se crea un evento suelto con los cambios | La serie la excluye |
| Este y los siguientes | La serie termina justo antes y empieza una nueva con los cambios y las excepciones posteriores | La serie termina justo antes |
| Todos los eventos | Toda la serie se desplaza lo mismo que la repetición editada, y sus excepciones con ella | El evento entero va a la Papelera |

- No se ofrece «Este y los siguientes» en la primera repetición (equivale a «Todos»), ni «Solo este» si se cambió la regla.
- **Inicio** muestra la próxima repetición.
- **Avisos:** se programa el de la primera repetición que aún no ha pasado. Tras entregarlo, el servicio vuelve a calcular y programa el siguiente. Uno vencido durante el reposo se entrega tarde, como los demás, y uno ya entregado nunca se repite. Se calcula en Rust y se pasa por una tabla temporal a la reconciliación SQL existente.

## Papelera

Borrar una tarea, un proyecto o un evento guarda en `trash_items` una instantánea de las filas afectadas y de las referencias que las claves foráneas dejarán en NULL, y después borra de verdad. Así ninguna consulta de la app tiene que excluir lo borrado.

| Se borra | La instantánea incluye |
| --- | --- |
| Tarea | La tarea, sus subtareas, etiquetas (por nombre) y notas vinculadas. Registros de tiempo, sesiones y la tarea anterior de su serie que la apuntaban |
| Proyecto | El proyecto y sus espacios. Las tareas que conservaban el proyecto, las notas, los eventos, el tiempo y las sesiones que lo apuntaban. Con «Eliminar también las tareas», también esas tareas completas |
| Evento | La serie entera y sus vínculos con notas |
| Repeticiones de un evento | Qué repetición se quitó, o hasta cuándo llegaba la serie antes de recortarla |

**Restaurar.**
- Reinserta las filas con los mismos identificadores, solo en las columnas que existan.
- Lo que dejó de existir mientras tanto se omite: un proyecto que sigue en la Papelera deja la tarea sin proyecto, y una nota borrada no se vuelve a vincular.
- Los registros se vuelven a enlazar solo si siguen sin enlazar.
- Las tablas y columnas que se pueden tocar están en listas fijas (`commands/trash.rs`).

**Interfaz.**
- Al borrar aparece un aviso con **Deshacer** y **Ver papelera**. ⌘Z también deshace mientras se ve, salvo con el foco en un campo de texto.
- La sección **Papelera** (barra lateral, abajo) permite restaurar, eliminar para siempre y vaciar.
- Lo que lleva más de 30 días se purga al iniciar FlowDesk y al abrir la Papelera.
- Borrar tareas y eventos ya no pide confirmación. Borrar un proyecto con sus tareas sigue pidiendo escribir su nombre.

Las notas mantienen su propio flujo (archivar y eliminar) y sus adjuntos su papelera de archivos.

## Paleta de comandos

⌘K (o «Buscar o ir a…» en la barra lateral) abre la paleta en la ventana principal.

- **Acciones:** nueva tarea, nota o evento, empezar un Pomodoro o el cronómetro, Configuración y recorrido.
- **Ir a** cualquier sección, incluidas Tareas de hoy y Próximas.
- **Cambiar de espacio.**
- **Resultados:** tareas (la búsqueda de Rust: título, descripción y etiquetas, del espacio activo), proyectos (abre su detalle) y notas (muestra la ventana flotante).

No distingue tildes ni mayúsculas, y todas las palabras deben aparecer. Se maneja con ↑ ↓, Enter y Esc. Si una acción falla, la paleta sigue abierta con el error.

## Persistencia (migración 11)

- `tasks.recurrence_rule`, `tasks.recurrence_next_id` (FK a `tasks`, `SET NULL`) y `tasks.recurrence_pristine` con el disparador `trg_tasks_repetition_touched`.
- `calendar_events.recurrence_rule` y `calendar_events.recurrence_exceptions` (`'[]'` por defecto).
- Tabla `trash_items` e índice `idx_trash_deleted`.

No convierte datos existentes: nada se repite hasta que el usuario lo pide.

## Guía de bienvenida

- Nuevas fichas **Paleta de comandos** y **Papelera** (0.6.0), con capturas en claro y oscuro y pasos de la visita guiada (`palette-open`, `nav-trash`, `trash-content`).
- **Tareas** sube a la revisión 2 y **Agenda y recordatorios** a la 3, con su entrada en las novedades.
- Rust declara las capacidades `recurrence`, `trash` y `command-palette`.
- La pantalla de atajos añade ⌘K y ⌘Z.

## Pruebas realizadas

- `npm run test:rust`: **113 pruebas**. Las nuevas:
  - **Reglas:**
    - validación;
    - laborables;
    - cada dos semanas en varios días;
    - completar tarde sin crear tareas pasadas;
    - «desde que la completo»;
    - el día 31 en meses cortos;
    - fin de serie;
    - expansión en un rango con excepciones y repeticiones en curso;
    - desplazamiento en hora de pared.
  - **Tareas:**
    - exigir fecha;
    - crear la siguiente con etiquetas y subtareas sin completar;
    - no duplicar;
    - deshacer al reabrir solo si no se tocó;
    - saltar.
  - **Eventos:**
    - expansión;
    - próxima repetición en Inicio;
    - editar solo una, las siguientes y todas;
    - borrar cada alcance y restaurarlo desde la Papelera.
  - **Avisos:** el aviso de cada repetición se entrega una vez, se programa el siguiente y salta las repeticiones quitadas.
  - **Papelera:**
    - una tarea vuelve con subtareas, etiqueta ya podada, nota y registro de tiempo;
    - un proyecto vuelve con sus tareas, su espacio y sus notas;
    - restaurar omite lo que ya no existe;
    - purga a los 30 días.
- `npm run test:recurrence`: **4 pruebas** de la interfaz:
  - opciones del menú;
  - descripciones en español;
  - el día semanal sigue a la fecha;
  - búsqueda sin tildes.
- `npm run test:onboarding`: **8 pruebas**, con el historial de la 0.6.0.
- `npm run test:onboarding-ui`: **25 flujos** en Chrome sin interfaz (3 nuevos):
  - ⌘K busca y navega;
  - la tarea repetida muestra su regla y su borrado se deshace;
  - una repetición pide alcance al guardar y al borrar.
- **Migración 11 sobre una copia de la base real** (`.backup`):
  - `integrity_check = ok` y `foreign_key_check` vacío;
  - las 3 tareas siguen igual;
  - la copia se borró después.
- **App empaquetada con `HOME` aislado e inicio oculto**, sin abrir ventanas:
  - aplicó la migración 11 al arrancar;
  - programó el aviso de un evento diario para la repetición de hoy (no para la primera);
  - purgó un elemento de la Papelera de hace 40 días;
  - `integrity_check = ok`.
  - El aviso estaba fijado 20 minutos después para no mostrar notificaciones; el directorio se borró al terminar.
- **Revisión visual** en claro y oscuro de:
  - la paleta;
  - la Papelera;
  - el editor «Personalizar…» de una tarea;
  - la pregunta de alcance de un evento.

## Limitaciones

- No hay «el segundo martes de cada mes» ni «el último día del mes»: las mensuales repiten el mismo día del mes.
- Las tareas repetidas no admiten un número fijo de repeticiones, solo una fecha de fin.
- La paleta busca notas por título y texto en la interfaz, con las notas no archivadas del espacio activo.
- La Papelera no incluye notas.
