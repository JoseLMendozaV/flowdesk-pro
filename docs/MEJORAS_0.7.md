# Arrastrar en el calendario, fecha de inicio y próximo evento en la barra de menús (0.7.0)

Fecha de verificación: 26 de octubre de 2026.

Tres funciones pedidas por el usuario fuera del plan por fases. La fase 8 (IA local) sigue pendiente.

## Arrastrar y estirar en el calendario

En las vistas de día y semana:

- **Mover un evento** arrastrándolo cambia su hora y, en la vista semanal, su día. Conserva la duración y avanza de 15 en 15 minutos. El inicio no sale del día de destino (0:00–23:45).
- **Estirar el borde inferior** (aparece al pasar el ratón) cambia la duración, con un mínimo de 15 minutos.
- **Las tareas también se arrastran:**
  - moverlas cambia su fecha límite y les pone hora; las que no tenían se mueven desde la hora por defecto;
  - estirarlas cambia el tiempo estimado;
  - si el inicio quedara después de la nueva fecha límite, pasa a ese mismo día;
  - una regla semanal de un solo día sigue al nuevo día.
- **Eventos que se repiten:** al soltar se pregunta «Solo este evento / Este y los siguientes / Todos los eventos», con el mismo componente que el diálogo (`ScopeChoices`). Cancelar (o Esc) devuelve el bloque a su sitio.
- El bloque se queda en su nueva posición hasta que llegan los datos guardados; si falla, vuelve atrás y se muestra el error.
- **Clic y arrastre no se confunden:** hace falta mover 4 píxeles para que empiece el arrastre. El clic que sigue a soltar no abre el bloque ni crea un evento, y el círculo de una tarea nunca inicia un arrastre. Esc durante el arrastre lo cancela.

La lógica (`moveSpan`, `resizeSpan`, `taskSpan`, `snapMinutes`) está en `calendarDates.ts` y tiene pruebas propias.

## Fecha de inicio de las tareas

- `tasks.starts_at` guarda solo el día, a mediodía local como las fechas sin hora. No puede ser posterior a la fecha límite.
- En el detalle de la tarea, el campo **Empieza (opcional)** está junto a la fecha límite. Si la fecha límite se adelanta a una anterior al inicio, el inicio la sigue.
- **Vistas:**
  - **Hoy:** lo que vence hoy o antes, y lo que ya se puede empezar aunque no tenga fecha límite. Nunca lo que empieza otro día.
  - **Próximas:** lo que empieza o vence más adelante.
  - **Todas:** lo muestra todo, con «⧗ Empieza el lunes» en lo que aún no se puede empezar.
- **Inicio y el panel de la barra de menús** no listan entre las próximas lo que aún no ha empezado.
- **Repeticiones:** la siguiente tarea conserva la misma distancia entre inicio y fecha límite. «Saltar esta vez» también mueve el inicio.

## Próximo evento junto al icono

- Junto al icono de la barra de menús aparece el próximo evento con hora: «Tutoría en 12 min», «… en 1 h 5 min» o «Tutoría · ahora» durante sus primeros 15 minutos.
- Los títulos largos se abrevian a 18 caracteres. La descripción emergente da el título completo, la hora y la ubicación.
- **Configuración → Próximo evento en la barra de menús:** nunca, o 10, 15, 30 (por defecto), 60 o 120 minutos antes. Se guarda en `tray_preferences.next_event_minutes`.
- Sigue al espacio activo como Inicio. Las repeticiones cuentan y los eventos de todo el día no.
- **Si hay un Pomodoro o un cronómetro en marcha**, el temporizador tiene prioridad junto al icono y el evento pasa a la descripción emergente.
- **Quién lo actualiza:** el servicio de recordatorios. Ya se despertaba al menos una vez por minuto y con cada cambio de tareas, notas o eventos; ahora también al cambiar de espacio o de preferencia. Mientras hay un evento a la vista, se despierta justo cuando cambia el minuto del texto.

## Persistencia (migración 12)

- `tasks.starts_at` con el índice parcial `idx_tasks_starts`.
- `tray_preferences.next_event_minutes` (0–240, 30 por defecto).

## Guía de bienvenida

- Novedades de la 0.7.0:
  - **Tareas**, revisión 3: fecha de inicio;
  - **Agenda y recordatorios**, revisión 4: arrastrar y estirar;
  - **Barra de menús**, revisión 3: próximo evento.
- Capturas de Calendario y Tareas regeneradas.

## Pruebas realizadas

- `npm run test:rust`: **117 pruebas**. Las nuevas:
  - Hoy y Próximas con fechas de inicio;
  - el inicio guarda solo el día y no puede pasar la fecha límite;
  - la repetición conserva la distancia al inicio;
  - elección del evento que se anuncia: antelación, desactivado, todo el día, «ahora» y repeticiones;
  - formato del texto junto al icono;
  - preferencia guardada y validada.
- `npm run test:calendar`: **7 pruebas**, 2 nuevas:
  - mover en hora de pared sin salir del día;
  - mínimo al estirar, redondeo a 15 minutos y tareas sin hora.
- `npm run test:onboarding`: **8 pruebas**, con el historial de la 0.7.0.
- `npm run test:onboarding-ui`: **28 flujos** en Chrome sin interfaz. Hay 3 nuevos con arrastres reales del ratón:
  - un evento se mueve una hora y un día, y estirarlo pasa de 1 h a 1 h 30;
  - una repetición pregunta a cuáles se aplica, Cancelar la devuelve a su sitio y «Solo este» guarda;
  - una tarea que empieza otro día lo indica en la lista y en su detalle.

- **Migración 12 sobre una copia de la base real** (`.backup`):
  - `integrity_check = ok` y `foreign_key_check` vacío;
  - las 3 tareas siguen igual, ninguna con inicio;
  - antelación por defecto de 30 minutos.
  - La copia se borró después.
- **Copia empaquetada en la barra de menús real**, compilada con otro identificador (`com.flowdesk.pro.prueba`) para no interferir con la copia instalada, con `HOME` aislado e inicio oculto. El texto del icono se leyó con la API de accesibilidad, sin pulsar nada:
  - «Tutoría de prueba en 12 min», con «Próximo: Tutoría de prueba a las 18:42 · Aula 3» en la descripción emergente;
  - un minuto después, «… en 11 min»;
  - con la preferencia en «Nunca», el texto desaparece en el siguiente minuto;
  - un evento empezado hace 2 minutos muestra «Reunión en curso · ahora».

  La copia de prueba se cerró por su PID y se borró con sus datos.

## Limitaciones

- En la vista de mes y en la franja de todo el día no se arrastra; los eventos de todo el día se cambian desde el diálogo.
- Arrastrar no desplaza la cuadrícula sola al acercarse al borde: para llevar un bloque fuera de lo visible, primero se desplaza la vista.
- No hay «Deshacer» para un arrastre: se vuelve a arrastrar.
