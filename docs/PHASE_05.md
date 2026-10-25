# Fase 5 — Concentración

Fecha de verificación: 25 de octubre de 2026.

## Diseño

**El estado vive en Rust, no en la interfaz.** `src-tauri/src/background/timer.rs` gestiona el Pomodoro y el cronómetro manual. SQLite guarda cada sesión; en memoria solo se conserva un "ancla" por temporizador en marcha.

**Relojes** (`background/clock.rs`):

| Reloj | Uso | Reposo | Cambio de hora |
| --- | --- | --- | --- |
| `CLOCK_UPTIME_RAW` (actividad) | Tiempo transcurrido | No avanza | No le afecta |
| `CLOCK_MONOTONIC` (continuo) | Detectar reposo | Avanza | No le afecta |
| Hora de pared | Fechas visibles y estadísticas | — | Sí |

Si entre dos ciclos el reloj continuo avanzó más de 5 s por encima del de actividad, el Mac estuvo en reposo: los temporizadores en marcha se pausan con el tiempo trabajado exacto y se envía un aviso. Lo verifiqué en este Mac: el reloj continuo coincide con el tiempo desde el arranque (654 016 s frente a 654 017 s) e incluye unas 104 h de reposo que el de actividad no cuenta.

**Hilo `flowdesk-timers`.** Despierta solo cuando termina una sesión, cuando cambia el minuto visible en la barra de menú, o para guardar un punto de control cada 60 s. Sin temporizadores en marcha, duerme hasta que una operación lo avisa (`Condvar`). Mientras algo corre, declara actividad a `NSProcessInfo` para que App Nap no retrase el aviso de fin.

**Recuperación.**
- Salida normal (menú, ⌘Q o `quit`): los temporizadores en marcha se pausan con el tiempo exacto. Se hace en `ExitRequested` y también en `Exit`, porque ⌘Q no pasa por el primero.
- Cierre inesperado: al arrancar, las filas que figuraban en curso quedan en pausa con el último punto de control (se pierde como mucho un minuto).

**Reglas de datos.**
- Como máximo un Pomodoro y un cronómetro manual activos, garantizado también por índices únicos parciales en SQLite.
- Un enfoque y el cronómetro manual no pueden correr a la vez, para no contar el tiempo dos veces. Los descansos sí pueden coexistir con el cronómetro.
- Un enfoque completado, o interrumpido después de al menos 1 minuto, crea un registro en `time_entries` con origen `pomodoro`. Así `time_entries` es la única fuente del "tiempo registrado", y `tasks.tracked_seconds` se recalcula a partir de ella.
- Descanso largo cada N enfoques completados en el día (por defecto 4).

## Implementado

- **Pomodoro:** sesiones de 25, 45 y 60 min, o una duración personalizada (1–180 min); descanso corto y largo; pausar, reanudar y finalizar. Se puede asociar a una tarea, que aporta su proyecto. Inicio automático opcional de descansos y de enfoques. Preferencias persistentes.
- **Cronómetro manual:** iniciar, pausar, reanudar y finalizar, con descripción, tarea y proyecto. Los registros se pueden reasignar y eliminar.
- **Estadísticas:** tiempo registrado y de concentración por día (semana actual de lunes a domingo), totales de hoy y de la semana, tiempo por proyecto y sesiones completadas hoy.
- **Avisos locales** (`tauri-plugin-notification` 2.7.0) al terminar un enfoque o un descanso, y tras pausar por reposo. Se registran en `notification_history` con clave de deduplicación y pueden desactivarse.
- **Barra de menú:**
  - Título dinámico junto al icono: minutos restantes (`18m`), pausa (`‖ 18m`) o tiempo del cronómetro (`1:05`). Solo cambia con el minuto.
  - Acción "Iniciar o pausar Pomodoro" en el menú y en el panel.
- **Atajos globales** (sección 17): ⌥N nota, ⌥⇧T tarea, ⌥⇧F abrir FlowDesk, ⌥⇧P Pomodoro. Configuración muestra si cada uno se registró.
- **Interfaz:**
  - Página Concentración: anillo de progreso, tipo de sesión con el siguiente sugerido, ciclo, preferencias y sesiones del día.
  - Página Tiempo: cronómetro, cuatro indicadores, gráfico semanal, tiempo por proyecto y registros.
  - Dashboard: temporizador operativo.
  - Detalle de tarea: botones "Enfocarme" y "Cronometrar".

**Gráficos.**
- Colores validados con el validador de paleta: el azul y el violeta de la marca fallaban para daltonismo (ΔE 3,5). Se usan azul `#2a78d6` y naranja `#eb6834` (`#3987e5` y `#d95926` en modo oscuro), que aprueban contraste, separación para daltonismo (ΔE ≥ 24) y visión normal en ambos modos.
- Leyenda, tooltip también con el teclado, vista de tabla equivalente y una sola escala.

## Defecto encontrado y corregido durante las pruebas

Con un temporizador en marcha y todas las ventanas ocultas, el proceso consumía **1,2 % de CPU sin parar**. Tras pausar seguía igual, pero era 0 % si el temporizador no había llegado a correr.

`sample` mostró que el hilo de temporizadores estaba dormido. El consumo venía de un `CVDisplayLink` de WebKit que disparaba a la frecuencia del monitor: las páginas ocultas repintaban el segundero de la interfaz, WebKit no las considera `hidden` cuando la ventana está retirada de pantalla, y el display link no se detenía después.

Corrección:
- Rust anuncia `flowdesk://visibility` al mostrar u ocultar el dashboard y el panel.
- Con la ventana oculta, `useDataChanged`, `useTimer` y `useLiveTimer` aplazan sus actualizaciones y se ponen al día al mostrarse.

Resultado medido: **0,0 %** en marcha con todo oculto, sin `CVDisplayLink`; **0,3 %** con el dashboard abierto y la cuenta atrás avanzando.

## Pruebas realizadas

- `npm run check`, `npm run build`, `cargo fmt --check` y `cargo clippy --all-targets -- -D warnings`: aprobados.
- `cargo test`: **34 pruebas aprobadas** (14 nuevas). Con un reloj simulado cubren:
  - cuenta atrás y final con registro y aviso único;
  - pausa y reanudación;
  - **reposo del Mac**;
  - **cambios de la hora del sistema** (−1 día y +2 h sin efecto);
  - descanso largo tras 4 enfoques;
  - inicio automático encadenado;
  - interrupción con mínimo de 1 minuto;
  - tiempo de tarea desde el cronómetro;
  - exclusión enfoque/cronómetro;
  - punto de control y recuperación tras cierre inesperado;
  - guardado exacto al salir;
  - estadísticas por día y proyecto;
  - reasignación y borrado de registros;
  - validación de preferencias.
- Migración 4 probada sobre una copia de la base real y aplicada por la app: `integrity_check = ok`, `foreign_key_check` vacío. El índice único rechaza un segundo Pomodoro activo.
- **App empaquetada con `HOME` aislado** (enfoque configurado a 1 min):
  1. ⌥⇧P inició un enfoque de 60 s; la barra de menú mostró `1m`.
  2. Con el dashboard cerrado (0 ventanas, 1 proceso), la sesión terminó **exactamente a la hora prevista**, creó el registro de 60 s y una sola entrada de aviso; el título se limpió.
  3. ⌥⇧P desde otra app en primer plano inició la siguiente sesión correcta (descanso corto).
  4. `quit` tras 10 s guardó exactamente 10 s (el punto de control aún no había llegado); al reabrir, la sesión seguía en pausa y la barra mostraba `‖ 5m`.
  5. Una segunda apertura fue absorbida por la instancia única.

## Pendiente de validación manual

- **Permiso de avisos:** macOS mostró su solicitud de permiso de avisos para FlowDesk Pro al primer intento. El permiso es del usuario; los banners aparecerán al aceptarlo.
- Recorrer visualmente las páginas Concentración y Tiempo: la ventana estaba en otro escritorio y no se tomó el control de la pantalla.
- Reposo real del Mac: cubierto con reloj simulado y con la comprobación de los relojes, pero no se suspendió el equipo.

## Limitaciones

- El reposo se detecta en el siguiente ciclo del hilo (como mucho unos 60 s tras despertar). El tiempo transcurrido es correcto igualmente, porque el reloj de actividad no avanzó durante el reposo.
- Las estadísticas asignan cada registro al día en que empezó.
- Los registros en curso se reflejan en las estadísticas con el último punto de control (≤ 60 s de retraso).
- Los atajos todavía no son configurables.

## Corrección: la ventana principal no se podía mover

Reportado por el usuario. El defecto venía de la Fase 1.

**Causas**
- La ventana principal usa `titleBarStyle: Overlay`: la página cubre la barra de título nativa y el movimiento depende de `data-tauri-drag-region`. Ese mecanismo invoca `start_dragging`, que no está en `core:default`. En la Fase 4 el permiso solo se concedió a las notas.
- Las cabeceras usaban el atributo simple, que solo responde al pulsar el propio elemento. Además, el atributo simple en el bloque del título impedía el arrastre desde su texto.

**Cambios**
- Capability `window-dragging` con `core:window:allow-start-dragging` para `main` y `note-*`. El panel del tray queda excluido para seguir anclado al icono.
- Cabeceras de todas las páginas con `data-tauri-drag-region="deep"`.
- La franja superior de la barra lateral, junto a los botones de la ventana, y el bloque del logotipo también mueven la ventana.

**Verificado** en la app empaquetada (instancia aislada):
- Arrastre real desde la franja de la barra lateral: (−80, +40).
- Arrastre real desde el texto del título de la cabecera: (+40, −30).
- Pulsar elementos de la barra lateral navega sin mover la ventana.

Revisando visualmente Concentración y Tiempo se corrigieron dos detalles:
- El eje del gráfico mostraba "8 min" para 7,5 min. Ahora las escalas tienen una mitad redonda (0 / 10 / 20 min).
- El subtítulo afirmaba que la concentración ya contaba como tiempo registrado. En realidad se suma al terminar cada sesión.

## Próxima fase

Fase 6: portapapeles, seguimiento automático autorizado, calendario, recordatorios y espacios de trabajo.
