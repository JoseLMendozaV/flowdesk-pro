# Copias de seguridad, plan del curso y calendario académico (0.9.0)

Fecha de verificación: 26 de octubre de 2026.

Tres funciones pedidas por el usuario. Ahora que FlowDesk guarda calificaciones y asistencia, las copias automáticas importan más; el plan del curso y el calendario académico completan Docencia. La fase 8 (IA local) sigue pendiente.

## Copias de seguridad automáticas

**Configuración → Copias de seguridad.**

- **Carpeta:** la elige el usuario («Elegir carpeta…»). Si está en iCloud Drive, las copias también quedan en la nube; la ruta se muestra como «iCloud Drive › Copias FlowDesk».
- **Una copia al día** mientras FlowDesk está abierto. El hilo `flowdesk-backups` comprueba 90 segundos después de abrir la app y luego cada media hora, o en cuanto cambia la configuración. Toca copia si hoy aún no se hizo ninguna.
- **Conservar:** las últimas 30 por defecto (7, 14, 30, 60 o 90). Al guardar una copia se borran las más antiguas, y solo los archivos con el nombre de las copias de FlowDesk.
- **Hacer copia ahora** cuenta como la copia del día.
- **Restaurar con un clic:**
  1. pide confirmación;
  2. comprueba la copia: que sea una base de FlowDesk íntegra (`PRAGMA quick_check`) y de una versión que esta app entiende;
  3. guarda antes el estado actual («Antes de restaurar», en la carpeta de copias o, sin carpeta, en `copias-antes-de-restaurar/` dentro de los datos de la app);
  4. deja la copia como `restore-pending.sqlite3` y reinicia FlowDesk;
  5. al arrancar, antes de abrir la base, borra el diario WAL anterior y sustituye la base. Así SQLite no aplica el diario viejo sobre la restaurada. Después las migraciones la ponen al día.
- **Desde otro archivo…** restaura una copia de cualquier carpeta, por ejemplo al estrenar un Mac.
- Si la carpeta no está disponible (disco o iCloud desconectados), se indica en rojo y la copia falla con el motivo, que queda visible hasta la siguiente copia correcta.

**Formato.**
- Cada copia es un único archivo SQLite: `FlowDesk-AAAA-MM-DD-HHMMSS.sqlite3`. Las manuales llevan `-manual` y las previas a restaurar `-antes-de-restaurar`.
- Se hace con `VACUUM INTO`, coherente aunque la base esté en uso, primero en los datos de la app. Luego se le añaden los adjuntos de las notas (tabla `flowdesk_backup_files`). Por último se copia a la carpeta con nombre provisional (`.partial`) y se renombra, para que iCloud nunca suba una copia a medias.
- Al restaurar, los adjuntos vuelven a `note-attachments/` y la tabla se elimina.
- La configuración vive en `backups.json`, fuera de la base, para que restaurar una copia antigua no la cambie.

Código: `src-tauri/src/backup.rs` y `src/features/backups/BackupsSection.tsx`.

## Calendario académico (Docencia → Horario)

- **«Cargar feriados y calendario UTP»** añade de una vez:
  - **Feriados nacionales de Panamá** de este año y el próximo. Se calculan: fijos más Martes de Carnaval y Viernes Santo según la Pascua, y el que cae en domingo se pasa al lunes. En 2026 coinciden con la lista oficial: 1 y 9 ene, 17 feb, 3 abr, 1 may, 3, 5, 10 y 28 nov, 8 dic, 21 dic (puente del 20) y 25 dic.
  - **Calendario académico 2026-2027 de la UTP** (pregrado, modificado por el Consejo Académico el 6 de febrero de 2026):
    - periodos de clases de cada semestre y del verano;
    - semanas de exámenes finales;
    - entrega de calificaciones y últimos retiros;
    - días libres institucionales (Aniversario de la UTP, Difuntos, Símbolos Patrios, día compensado, Días Santos, Carnavales).
  - Volver a cargarlo no duplica nada (clave única por origen, fecha y nombre).
- **«Añadir día»:** días o periodos propios (recesos, jornadas), con tipo y la casilla «Suspende las clases». Todo se puede editar o quitar.
- **Efecto de un día sin clases:**
  - Las clases del horario de ese día salen del calendario de FlowDesk, de los avisos, de la barra de menús y de «Próximas clases». Se guardan como excepciones de la serie en `course_schedule.skipped_occurrences`, aparte de las que el usuario quitó a mano, así que si el día deja de ser libre vuelven solo las suyas.
  - Las sesiones de asistencia de ese día que no se dieron ni tienen marcas se quitan, y se renumeran las demás. Las que ya tienen asistencia se conservan y se avisa.
  - «Crear sesiones de asistencia» no crea sesiones en días sin clases e indica cuántos omite.
  - Si se quita o se cambia un día libre, sus clases vuelven y, si la materia ya usaba sesiones, también sus sesiones.
- Los feriados, días libres, exámenes y fechas límite aparecen en el calendario como **eventos de todo el día** (no los periodos de clases).
- El **periodo de clases** en curso propone las fechas de una clase nueva del horario.

Con una copia de la base real, cargar el calendario añade 40 días y quita 5 sesiones vacías de feriados. Son las del 3, 4, 5, 6 y 10 de noviembre de Desarrollo de Software V y VIII, y sus clases desaparecen del calendario. Ninguna sesión con asistencia se toca.

## Plan del curso (Docencia → Plan)

- **Temas en orden**, con contenido, semana prevista y clase (sesión de asistencia).
- **«Pegar temario»:** un tema por línea. Quita viñetas y numeración («1.», «Tema 3:»), y «Semana 3:» o «S3 -» fija la semana prevista.
- **«Repartir en las clases»:** asigna los temas pendientes, en orden, a las sesiones que siguen al último tema asignado. Va uno por clase o, si el tema tiene semana prevista, a la primera clase de esa semana, y salta los días sin clases. «Rehacer el reparto» vuelve a repartir los pendientes.
- **Avance:** «Vamos en el tema 7 de 15» con la barra de progreso y el tema de ahora. Los **atrasados** son temas pendientes cuya clase ya pasó.
- **Pasar lista cumple el tema:** al guardar la asistencia de una clase, sus temas quedan como dados (disparador `trg_sessions_held_topics`). También se marcan a mano.
- **Asistencia:** el tema de la sesión toma el título del tema del plan si estaba vacío, y lo sigue si se renombra.
- **«Preparar clase»** abre una **nota flotante** por tema, encima de todo, en el proyecto de la materia. Lleva el guion «Objetivos / Actividades (lista de verificación) / Materiales / Después de la clase». La primera vez se crea; después se abre la misma, y si se borró se crea otra.
- **Resumen:** nuevo panel «Plan del curso» con el avance, el tema de ahora, los atrasados y «Preparar clase».

## Persistencia (migración 14)

- `academic_calendar`: `title`, `kind` (`holiday`, `break`, `exams`, `term` o `deadline`), `starts_on`, `ends_on`, `cancels_classes`, `source` (`panama`, `utp` o `user`) y `calendar_event_id`. Un disparador borra su evento del calendario.
- `course_schedule.skipped_occurrences`.
- `course_topics`: `course_id`, `position`, `title`, `week`, `details`, `session_id` (se libera si se borra la sesión), `done` y `note_id` (se libera si se borra la nota).

## Pruebas realizadas

- `npm run test:rust`: **137 pruebas** (más 3 opcionales con datos reales).
  - **Copias:**
    - nombres;
    - una al día;
    - conservar las N últimas sin tocar otros archivos;
    - restaurar con adjuntos y sin el WAL anterior;
    - rechazar archivos que no son copias de FlowDesk.
  - **Calendario académico:**
    - feriados de 2026 iguales a la lista oficial, puente incluido;
    - Pascua de 2027;
    - las clases de feriados salen del calendario sin perder las quitadas a mano;
    - las sesiones vacías se quitan y las que tienen asistencia se conservan;
    - cargar dos veces no duplica;
    - al quitar un feriado vuelven su clase y su sesión;
    - validación de los días.
  - **Plan:**
    - lectura del temario pegado;
    - reparto por orden y por semana;
    - avance y atrasados;
    - pasar lista cumple el tema;
    - tema de la sesión;
    - nota de preparación única y en el proyecto de la materia.
- `npm run test:onboarding-ui`: **36 flujos**. Los nuevos:
  - plan del curso (avance, preparar, marcar, pegar y repartir);
  - calendario académico (cargar y aviso de sesiones omitidas);
  - copias (carpeta de iCloud, copia ahora y restaurar con confirmación y reinicio).
- `npm run test:onboarding`: registro con «Copias de seguridad» como función nueva y Docencia en la revisión 4.
- Revisión visual en claro y oscuro de Plan, calendario académico, panel del Resumen y Configuración.

## Hoja de notas del proyecto final de la UTP (0.9.1)

**Docencia → Informes → «Preparar hoja…».** Rellena el formulario oficial «Formulario de registro de proyectos finales» (una hoja «Introducción» y una hoja «GRUPO N» por equipo) **sin cambiar su formato**.

- **Plantilla:** el docente elige una vez el Excel oficial. FlowDesk lo comprueba y guarda una copia privada en `plantillas/registro-proyectos-finales.xlsx`, dentro de los datos de la app.
  - No va en la app ni en el repositorio, que es público: es un formulario institucional y sus metadatos llevan nombres de personas.
  - Si la UTP cambia el formulario, se elige el nuevo con «Cambiar…».
- **Datos generales:**
  - docente, cédula del docente, carrera, asignatura y su código, código de horario, grupo, año y período;
  - se proponen desde la materia, el calendario académico (periodo de clases en curso) y la última hoja preparada (cédula y carrera);
  - se guardan por materia en `settings` (`teaching_final_sheet:<id>`).
- **Nota:** la de una evaluación o la nota final del curso.
  - Por defecto, la evaluación que se llame «proyecto» o «semestral»; si no hay ninguna, la nota final.
  - La nota se lleva a escala de 100 según el puntaje máximo de la evaluación. En las evaluaciones por equipo vale la de cada integrante (la del equipo, salvo que se cambiara a alguien).
- **Redondeo:** a enteros (85,5 → 86) o a un decimal, con la mitad hacia arriba y sin errores de coma flotante (84,5 calculado como 84,4999… sube a 85).
- **Motivos:** las casillas muestran el texto exacto de la plantilla y se marcan con «X»; «Otros» lleva su explicación.
- **Observaciones al trabajo:** opcionales, por equipo.
- **Revisión antes de exportar:**
  - **Impiden exportar:** no hay plantilla, hay más equipos que hojas o un equipo con más integrantes que filas, o hay notas fuera de 0–100.
  - **Avisos:** estudiantes sin equipo (no salen), sin nota (la celda queda vacía) o sin cédula, datos generales vacíos y ningún motivo marcado.
- **Vista previa** por equipo con la hoja donde va («GRUPO 1»…), en orden natural de nombres (Equipo 2 antes que Equipo 10).

**Cómo se conserva el formato** (`teaching/xlsx_template.rs`):
- Se cambia solo el valor de las celdas, dentro del XML de cada hoja, conservando su estilo (`s`). El texto va en línea, así que no se toca `sharedStrings.xml`.
- Todo lo demás se copia sin recomprimir: estilos, tema, logo, celdas combinadas, márgenes, ajustes de impresión y propiedades.
- En «GRUPO 2» a «GRUPO 8», que copian los datos generales de «GRUPO 1» con fórmulas, se conservan las fórmulas y se actualiza su valor calculado. Además, el libro pide recalcular al abrirse (`fullCalcOnLoad`).
- Las celdas se encuentran por sus etiquetas («CÓDIGO DE MATERIA:», «NOMBRE», «NOTA», «Nombre del Docente:»…), teniendo en cuenta las combinadas. Así funciona aunque «GRUPO 2» esté una fila más abajo o el formulario cambie un poco.
- Si hay más de 8 equipos, la propia plantilla indica copiar una hoja. Copiada en Excel como «GRUPO 9» y elegida de nuevo, FlowDesk la reconoce.

**Pruebas:**
- **Plantilla mínima:** rellenado por equipos, fórmulas, motivos, observaciones, redondeo, avisos y equipos que no caben.
- **Formulario oficial** (opcional, con `FLOWDESK_UTP_TEMPLATE`):
  - detecta 8 hojas de grupo, 10 filas y 7 motivos;
  - solo cambian las 9 hojas y la marca de recálculo;
  - cada celda conserva su estilo y lo de fuera de los datos queda idéntico.
- **Datos reales:** con una copia de la base, DS VIII toma «proyecto Final» con sus 7 equipos y DS V la nota final con sus 5 equipos. Revisado visualmente con Vista Rápida de macOS.
- **Interfaz:** flujo con aviso de lo que falta, guardado al salir del campo y exportación.
