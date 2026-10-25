# Fase 2 — Barra de menú y segundo plano

Fecha de verificación: 25 de octubre de 2026.

## Implementado

- Ventana compacta `tray-panel` sin marco, siempre encima y excluida del Dock.
- Posicionamiento bajo el icono mediante el plugin oficial Positioner.
- Clic izquierdo configurado para mostrar u ocultar el panel.
- Clic derecho conserva el menú contextual nativo.
- Resumen real de tareas, tiempo, Pomodoro, evento próximo y ámbito actual.
- Creación rápida de tareas desde el panel.
- Apertura y enfoque del dashboard sin instancias duplicadas.
- Ocultación automática del panel al perder foco.
- Cierre del dashboard como ocultación; el proceso y el tray continúan activos.
- Restauración de tamaño, posición y estado maximizado de la ventana principal.
- Preferencias para iniciar con macOS y para iniciar oculto.
- Integración de inicio mediante LaunchAgent y argumento `--autostart`.
- Cambio de política de activación entre aplicación normal y modo accesorio.
- Acción explícita para salir completamente.
- Acciones de notas, Pomodoro y agenda marcadas como no disponibles hasta sus fases correspondientes.

## Pruebas realizadas

- `npm run check`: aprobado.
- `npm run build`: aprobado.
- `cargo clippy --all-targets -- -D warnings`: aprobado.
- `cargo test`: 6 pruebas aprobadas.
- `npm run bundle:macos`: `.app` y `.dmg` generados para Apple Silicon.
- Inicio normal: un proceso y dashboard visible.
- Segunda apertura: continúa un solo proceso.
- Inicio `--autostart` con `launch_hidden = 1`: proceso activo y cero ventanas visibles.
- Reapertura desde segundo plano: dashboard visible y un solo proceso.
- Botón rojo: ventana oculta y proceso todavía activo.
- Estado de ventana: `.window-state.json` creado; tamaño y posición restaurados con escala Retina correcta.

La prueba de inicio oculto modificó temporalmente la preferencia de la base y la restauró al terminar. No registró permanentemente un elemento de inicio de sesión.

## Pendiente de validación manual

- Clic físico izquierdo y derecho sobre el icono del menú; el entorno no concede acceso asistido al proceso de automatización.
- Posición del panel con Mission Control, varios Spaces, monitores externos y pantalla completa.
- Habilitar/deshabilitar realmente el LaunchAgent desde la interfaz en una sesión de usuario de prueba.
- Verificar el aspecto del panel abierto desde el icono en cada escala de pantalla.

Estas comprobaciones no se consideran aprobadas hasta realizarlas manualmente.

## Próxima fase

Fase 3: notas flotantes persistentes, múltiples ventanas, guardado automático, colores, transparencia, modos de nivel de ventana, restauración y atajo global `Option + N`.
