# FlowDesk Pro

Aplicación de productividad local para macOS construida con Tauri 2, Rust, React, TypeScript, Tailwind CSS y SQLite.

## Estado actual

Las Fases 1 a 5 están implementadas. Algunas integraciones de macOS conservan comprobaciones manuales pendientes:

- ventana principal con dashboard conectado a datos reales;
- SQLite local con migración versionada, claves foráneas, índices y modo WAL;
- tareas con subtareas, etiquetas, prioridades, fechas con o sin hora, filtros, búsqueda y vistas Hoy/Próximas/Todas/Completadas;
- vistas de lista y Kanban con panel de detalle y guardado automático;
- proyectos con estadísticas, progreso, archivado y eliminación protegida;
- vínculos entre tareas, notas y proyectos;
- Pomodoro y cronómetro gestionados por Rust, resistentes al reposo del Mac y a cambios de hora;
- estadísticas de tiempo por día, semana y proyecto, y avisos locales;
- atajos globales ⌥N, ⌥⇧T, ⌥⇧F y ⌥⇧P, y tiempo restante junto al icono de la barra de menú;
- estado compartido de interfaz con Zustand;
- tema claro/oscuro sincronizado con macOS;
- panel compacto conectado a datos reales y anclado al icono de la barra de menú;
- menú contextual nativo con abrir, nueva tarea y salir;
- cerrar la ventana oculta el dashboard sin terminar el proceso;
- protección de instancia única;
- restauración de tamaño y posición de la ventana principal;
- inicio opcional con macOS mediante LaunchAgent y modo de inicio oculto;
- notas flotantes independientes con guardado automático, Markdown básico y restauración;
- colores, transparencia, tamaño de texto, colapso y nivel de ventana por nota;
- atajo global `Option + N` y conversión de texto seleccionado en tarea;
- bundles `.app` y `.dmg` para Apple Silicon.

Las vistas todavía no implementadas aparecen desactivadas de forma explícita; no contienen datos simulados.

## Requisitos de desarrollo

- macOS 10.15 o posterior para Tauri 2.
- Rust estable.
- Node.js y npm.
- Xcode Command Line Tools para la aplicación Tauri.
- Xcode completo para crear y firmar la extensión WidgetKit de una fase posterior.

Este entorno fue verificado con Rust 1.99.1, Node 26.12.1, npm 11.20.0 y macOS 26.5.2 sobre `arm64`.

## Desarrollo

```bash
npm install
npm run tauri dev
```

Comprobaciones:

```bash
npm run check
npm run build
npm run test:rust
```

Generar la aplicación y el instalador:

```bash
npm run bundle:macos
```

Los artefactos se generan en:

```text
src-tauri/target/release/bundle/macos/FlowDesk Pro.app
src-tauri/target/release/bundle/dmg/FlowDesk Pro_0.1.0_aarch64.dmg
```

## Instalación

Descarga el `.dmg` de la última versión en [Releases](https://github.com/JoseLMendozaV/flowdesk-pro/releases/latest) y arrastra FlowDesk Pro a Aplicaciones.

La app no está firmada con un certificado Developer ID de Apple. La primera vez, macOS mostrará que no puede verificar al desarrollador: haz clic derecho sobre FlowDesk Pro en Aplicaciones, elige **Abrir** y confirma. Las actualizaciones posteriores se instalan desde la propia app.

## Actualizaciones

Al abrir FlowDesk, y después cada 6 horas, la app consulta `latest.json` en la última versión publicada de GitHub. Si hay una versión nueva, el dashboard muestra **Actualizar y reiniciar**. La descarga solo se instala si su firma coincide con la clave pública incluida en `tauri.conf.json`. La comprobación automática puede desactivarse en Configuración y no envía datos personales.

### Publicar una versión

```bash
npm run release -- 0.2.0 "Qué cambia en esta versión"
```

El script sube la versión en `package.json`, `Cargo.toml`, `Cargo.lock` y `tauri.conf.json`, ejecuta las comprobaciones, crea el commit y la etiqueta `v0.2.0` y los envía. El flujo `.github/workflows/release.yml` compila para Apple Silicon, firma y publica en GitHub Releases el `.dmg`, el `.app.tar.gz` firmado y `latest.json`. Las notas aparecen en el aviso de la app.

### Clave de firma

- Privada: `~/.tauri/flowdesk-pro.key`, fuera del repositorio. Su contraseña está en el Llavero de macOS (servicio `tauri-updater-key-password`).
- En GitHub: secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `npm run bundle:macos` usa la clave local para firmar las compilaciones propias.

**Haz una copia de seguridad de la clave privada.** Si se pierde, las copias ya instaladas no aceptarán actualizaciones firmadas con otra clave y habrá que reinstalar manualmente.

## Datos locales

La base `flowdesk.sqlite3` se crea dentro del directorio de datos de la aplicación asignado por macOS. SQLite es la fuente principal de datos. La primera migración crea las 22 entidades requeridas; la tercera añade `task_notes` y limpia filas huérfanas. La conexión activa:

- `foreign_keys = ON`;
- `journal_mode = WAL`;
- `synchronous = NORMAL`;
- `busy_timeout = 5000`.

No hay telemetría ni servicios remotos obligatorios.

## Ciclo de vida en macOS

- El botón rojo oculta la ventana principal.
- Un clic izquierdo en el icono de barra restaura y enfoca la ventana.
- El menú contextual permite abrir, iniciar acciones rápidas y salir por completo.
- Una segunda apertura activa la instancia existente.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Estado de la Fase 1](docs/PHASE_01.md)
- [Estado de la Fase 2](docs/PHASE_02.md)
- [Estado de la Fase 3](docs/PHASE_03.md)
- [Estado de la Fase 4 y correcciones de las Fases 1–3](docs/PHASE_04.md)
- [Estado de la Fase 5](docs/PHASE_05.md)

Referencias oficiales: [Tauri 2](https://v2.tauri.app/), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), [WidgetKit](https://developer.apple.com/documentation/widgetkit).
