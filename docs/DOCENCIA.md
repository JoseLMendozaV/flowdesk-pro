# Docencia: Control Docente integrado en FlowDesk (0.8.0)

> En la 0.9.0 se añaden el **calendario académico** (feriados de Panamá y calendario de la UTP) y el **plan del curso**, y en la 0.9.1 la **hoja de notas del proyecto final** en el formulario oficial de la UTP. Ver [MEJORAS_0.9.md](MEJORAS_0.9.md).

Fecha de verificación: 26 de octubre de 2026.

La app de escritorio **Control Docente** (Tauri, Rust, React y SQLite, unas 6 400 líneas) pasa a ser la sección **Docencia** de FlowDesk. Se conserva todo lo que hacía y se añaden el **horario semanal** y la integración con el calendario, las tareas, los proyectos y la barra de menús.

## Qué incluye

**Lo que ya hacía Control Docente:**
- **Resumen** de la materia, convertido en panel en la 0.8.2 (ver más abajo).
- **Estudiantes:** altas, edición, activación, importación desde Excel y expediente con notas, asistencia, observaciones, compromisos y recuperaciones.
- **Equipos**, con integrantes y líderes.
- **Asistencia** por sesión (presente, ausente, justificada, tardanza).
- **Evaluaciones** individuales o por equipo, con rúbricas y recálculo automático.
- **Libro de notas** individual y por equipos.
- **Planificación** (clases, evaluaciones, entregas, reuniones) y anuncios.
- **Analítica** con alertas tempranas.
- **Informes** imprimibles, en CSV y en Excel con varias hojas.
- **Periodos académicos** y reglas de cada curso.

**Lo nuevo:**
- **Horario:** cada materia tiene franjas semanales con día, tipo (clase, teoría o laboratorio), hora, aula, fechas y aviso.
  - **Vista «Bloques»:** como la hoja oficial de la institución. Un bloque por fila y un día por columna, con «1 DS VIII (T)(2D3)».
  - **Vista «Horas»:** la semana a escala real.
  - **Elegir por bloques:** «Desde el bloque» y «Hasta el bloque». También se puede poner otra hora a mano.
- **Bloques horarios** (Ajustes): primer bloque, duración, descanso y cantidad. Por defecto, los de la UTP: 19 bloques de 45 minutos con 5 de descanso, de 7:00 a 22:45. Se guardan en `settings.teaching_time_blocks`.
- **Resumen como panel** (0.8.2). Paneles disponibles:
  - **Cifras clave:** estudiantes, asistencia y promedio con su mínimo, y cuántos van aprobando, en riesgo o sin notas.
  - **Requieren atención:** cada estudiante con su motivo; un clic abre el expediente.
  - **Próximas clases y entregas:** las clases salen del horario (sin festivos) y las entregas y eventos de los próximos 21 días.
  - **Asistencia por clase:** una barra por clase realizada, con la línea del mínimo y un aviso de las clases con estudiantes sin marcar, que cuentan como ausentes.
  - **Distribución de notas.**
  - **Promedio por evaluación**, con cuántos están calificados.
  - **Estudiantes:** nota, asistencia, ausencias y estado, ordenables.
  - **Rendimiento por equipo.**
  - **Accesos rápidos.**

  «Personalizar» elige qué paneles ver y en qué orden. Vale para todas las materias y se guarda en `settings.teaching_overview_layout`.

  Los gráficos siguen las pautas de visualización de FlowDesk:
  - un solo color validado (`--series-1`) y estado siempre con icono y texto;
  - descripción emergente en cada barra, también con el teclado;
  - todas las cifras están en la tabla.

  Corrige el error «no such table: preferences»: el resumen antiguo intentaba guardar la materia elegida en una tabla de Control Docente que FlowDesk no usa.
- **Marcar a todos** (0.8.1): cada clase de Asistencia tiene en su cabecera un menú para poner a todos presentes, ausentes, justificados o con tardanza, poner presentes solo a los que aún no tienen marca, o quitar todas las marcas.
  - Queda pendiente hasta «Guardar cambios», para corregir antes las excepciones.
  - Guardar asistencia en una clase la da por **realizada**. Así cuenta en los promedios, aunque se haya creado desde el horario como «No realizada».
- **Crear sesiones de asistencia** a partir del horario:
  - una sesión por cada día de clase, con su hora;
  - un día con teoría y laboratorio es **una sola sesión**, de la primera hora a la última;
  - las que ya existían en esos días reciben la hora si no la tenían;
  - se renumeran por fecha y nunca se toca la asistencia registrada.

## Integración con FlowDesk

| De Docencia | En FlowDesk |
| --- | --- |
| Materia | Un **proyecto** con el mismo nombre (y grupo). Renombrarla o archivarla lo actualiza. Desde Docencia, el botón de carpeta lo abre |
| Franja del horario | Un **evento semanal** entre sus fechas, con aula y aviso. Se titula «… · Teoría» o «… · Laboratorio» según su tipo. Aparece en el calendario, en Inicio y junto al icono de la barra de menús («Desarrollo de Software VIII · Teoría en 12 min») |
| Evaluación activa con fecha | Un evento «Entrega: …» en el calendario |
| Planificación | Un evento en el calendario, con el aviso de «Recordar antes» |
| Observación con fecha de seguimiento | Una **tarea** «Seguimiento: estudiante», que se resuelve en ambos sentidos: completarla en Tareas resuelve la observación, y resolverla en Docencia completa la tarea |

**Lo reflejado se cambia desde Docencia.**
- Los eventos llevan `source = 'teaching'`.
- El diálogo del calendario lo explica y ofrece «Abrir Docencia». Arrastrar está desactivado.
- En una clase del horario se puede quitar una repetición concreta (un festivo). Esa excepción se conserva mientras no cambie el inicio de la franja.
- Rust lo exige también fuera de la interfaz (`modify_event` y `remove_event`).

**Lo reflejado desaparece con su origen,** también en los borrados en cascada (disparadores de la migración 13).

**Cambios sin guardar.** Si Asistencia o Calificaciones tienen cambios sin guardar, cambiar de pestaña, de materia o de sección de FlowDesk pide confirmación (`leaveGuard` en `appStore`).

**Paleta ⌘K.** Incluye «Docencia», «Mi horario de clases», «Plan del curso» y las materias como resultados.

**Calendario académico y plan del curso (0.9.0).**
- Los días sin clases del calendario académico quitan esas clases del calendario y las sesiones vacías de la asistencia.
- Los feriados aparecen en el calendario como eventos de todo el día.
- El plan reparte los temas en las sesiones y pasar lista los da por vistos.
- Detalles en [MEJORAS_0.9.md](MEJORAS_0.9.md).

## Importación

**Sin configuración: tus datos de Control Docente.**
- La bienvenida de Docencia detecta `~/Library/Application Support/com.jmendoza.controldocente/control-docente.sqlite3` y la importa con un botón.
- También se puede elegir otro archivo, o importar la base de la **versión Django** (`db.sqlite3`).
- **El original nunca se modifica:** se abre en solo lectura y se copia con `VACUUM INTO` (incluido lo pendiente en su WAL) a `teaching-backups/` dentro de los datos de FlowDesk. Se importa desde esa copia.
- Se conservan los identificadores, así que notas, asistencia, equipos y rúbricas mantienen sus relaciones.
- Al terminar se crean los proyectos y se reflejan las entregas, la planificación y los seguimientos.
- Solo se puede importar con Docencia vacía.

**Respaldo.** Copia toda la base de FlowDesk con `VACUUM INTO`, que es coherente aunque la base esté en uso.

Tras importar, Control Docente puede dejar de usarse; su base sigue intacta por si quieres volver a ella.

## Arquitectura

- **Rust** (`src-tauri/src/teaching/`):
  - `commands.rs`: los 47 comandos de Control Docente con el prefijo `teaching_`. Usan la conexión de FlowDesk mediante `Database::lock()`.
  - `schedule.rs`: horario y sesiones.
  - `sync.rs`: reflejo en proyectos, calendario y tareas, dentro de la misma transacción.
  - `legacy.rs`: importaciones y respaldo.
  - `academic.rs`: calendario académico (feriados de Panamá y UTP) y su efecto en horario y sesiones (0.9.0).
  - `syllabus.rs`: plan del curso, reparto en sesiones y nota de preparación (0.9.0).
  - `final_sheet.rs` y `xlsx_template.rs`: hoja de notas del proyecto final de la UTP sobre la plantilla oficial, sin cambiar su formato (0.9.1).
  - `overview.rs`: Resumen (0.8.2).
  - `error.rs` y `models.rs`.
- **Interfaz** (`src/features/teaching/`):
  - `TeachingPage` se carga solo al abrir Docencia (`React.lazy`).
  - Las pantallas son las de Control Docente con su CSS, limitado a `.teaching`, en la capa `components` y con los colores de FlowDesk (también en oscuro).
  - framer-motion se sustituye por un adaptador mínimo (`lib/motion.tsx`).
  - Imprimir un informe oculta el resto de la ventana (`body.printing-report`).
- **Permisos:** la ventana principal puede usar también el diálogo de guardar (exportaciones y respaldos).

## Persistencia (migración 13)

- **Tablas de Control Docente**, con los mismos nombres y columnas:
  - `academic_periods`, `courses`, `students`, `enrollments`;
  - `student_groups`, `group_memberships`, `class_sessions`, `attendance_records`;
  - `evaluations`, `grades`, `group_grades`, `rubric_criteria`, `rubric_scores`, `recovery_grades`;
  - `student_observations`, `academic_events`, `announcements`, `audit_logs`.
- **Columnas de integración:**
  - `courses.project_id`;
  - `evaluations.calendar_event_id`;
  - `academic_events.calendar_event_id`;
  - `student_observations.task_id`.
- **`course_schedule`**, para el horario, con `kind` (`class`, `theory` o `lab`).
- **Disparadores** de limpieza y de resolución de seguimientos.

No se conservan `app_meta` ni `preferences` de Control Docente:
- la importación queda marcada en `settings` (`teaching_imported`);
- la materia y la pestaña abiertas se guardan en la interfaz;
- el tema sigue al de macOS.

## Pruebas realizadas

- `npm run test:rust`: **129 pruebas** (más 2 opcionales con datos reales). Las de Docencia:
  - Proyecto por materia: se crea, se renombra, se archiva y se recrea si se borró.
  - Horario:
    - clases semanales en el calendario con hora, aula, aviso y proyecto;
    - nada fuera del periodo;
    - editar mueve la serie y borrar la quita.
  - Desde el calendario:
    - solo se quita una clase concreta;
    - editar o borrar la serie se rechaza;
    - el festivo se conserva al volver a guardar la franja.
  - Sesiones desde el horario:
    - crea las que faltan y pone hora a la existente;
    - renumera por fecha sin tocar la asistencia;
    - no duplica al repetirlo;
    - avisa si no hay horario.
  - Entregas y planificación en el calendario: con hora, de día completo y con aviso; desaparecen sin fecha o al borrar.
  - Seguimientos como tareas, resueltos en ambos sentidos.
  - Importación de Control Docente:
    - el original no cambia, byte a byte;
    - queda una copia;
    - se conservan identificadores, notas y asistencia;
    - se rechaza si ya hay materias.
  - Teoría y laboratorio el mismo día (horario real de la UTP): dos eventos titulados por tipo y una sola sesión de 14:30 a 16:55.
  - Bloques horarios: por defecto los de la UTP; se guardan y se rechazan los que no caben en el día.
  - Guardar asistencia da la clase por realizada solo si se registró alguna marca.
  - Resumen:
    - nota ponderada sobre lo evaluado;
    - asistencia con P, T y J;
    - estados y motivos;
    - asistencia por clase realizada, distribución y promedio por evaluación;
    - agenda;
    - paneles guardados, completados y validados.
  - Con tu base real (prueba opcional sobre una copia): el resumen de tus dos materias se calcula sin errores.
  - Fechas locales y días de la semana.
  - Cálculo de rúbricas (prueba original de Control Docente).
- **Con tus datos reales** (pruebas opcionales, sobre copias):
  - Control Docente: 2 materias, 45 estudiantes, 45 matrículas, 29 sesiones, 606 registros de asistencia, 13 evaluaciones, 96 notas, 12 equipos y 44 integrantes, idénticos al original, más 2 proyectos y 1 entrega en el calendario.
  - La versión Django: 2 materias, 45 estudiantes, 28 sesiones y 96 notas, sin modificar el `db.sqlite3`.
- `npm run test:onboarding`: **8 pruebas**, con Docencia en la 0.8.0.
- `npm run test:onboarding-ui`: **33 flujos** en Chrome sin interfaz. Los 3 nuevos:
  - el horario añade una clase con los datos de la materia y crea las sesiones;
  - con asistencia sin guardar, cambiar de pestaña o de sección pide confirmación;
  - una clase de Docencia en el calendario no se edita y lleva a Docencia;
  - «Marcar a todos» rellena la clase entera (o solo los que faltan) y espera a «Guardar cambios»;
  - el Resumen muestra sus paneles, la descripción emergente de cada clase y se personaliza (ocultar y reordenar).
- **Copia empaquetada con una copia de tu base real**, con otro identificador. Se abrió Docencia con la API de accesibilidad y se leyó el Resumen de Desarrollo de Software V, sin el error de base de datos:
  - 20 estudiantes, asistencia del 68,3 % y 15 de 32 clases realizadas;
  - las próximas clases de tu horario y el resto de los paneles.
- **Migración 13 sobre una copia de tu base de FlowDesk** (versión 12):
  - `integrity_check = ok` y `foreign_key_check` vacío;
  - tus tareas intactas;
  - disparadores creados.
- `npm run test:recurrence`: incluye los nombres cortos del horario por bloques («Desarrollo de Software VIII» → «DS VIII»).
- **Revisión visual** en claro y oscuro de todas las pestañas con datos de demostración (estudiantes ficticios). El horario de demostración sigue la hoja oficial de la UTP.

## Limitaciones

- La importación es inicial: se hace una vez, con Docencia vacía. No sincroniza con Control Docente si se sigue usando.
- Los anuncios no se envían por correo; como en Control Docente, quedan registrados.
- Las rúbricas y recuperaciones funcionan igual que en Control Docente; no tienen equivalente en el resto de FlowDesk.
