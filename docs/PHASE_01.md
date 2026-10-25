# Fase 1 — Base técnica

Fecha de verificación: 25 de octubre de 2026.

## Implementado

- Proyecto oficial Tauri 2 con React, TypeScript y Vite.
- Tailwind CSS 4, Lucide React y Zustand.
- Estructura modular de frontend y backend.
- Esquema SQLite para las 22 entidades previstas.
- Migración versionada y transaccional.
- Dashboard con métricas, próximas tareas, notas, agenda y temporizador obtenidos de SQLite.
- Alta rápida de tareas con validación en Rust.
- Apariencia clara/oscura del sistema.
- Panel derecho ocultable con preferencia local de interfaz.
- CSP y capability inicial restringida.

## Base de Fase 2 incluida

- TrayIcon de Tauri 2.
- Menú contextual nativo.
- Reapertura y enfoque de la ventana principal.
- Cierre como ocultación y salida explícita separada.
- Instancia única.

## Pruebas realizadas

- `cargo test`: 5 pruebas aprobadas.
- `npm run build`: TypeScript y bundle Vite aprobados.
- `tauri build --bundles app,dmg`: aplicación e instalador generados para `aarch64`.
- Ejecución del `.app`: proceso iniciado, base/migración creadas y segunda apertura absorbida por la instancia existente.
- Inspección visual de la ventana empaquetada en modo oscuro: distribución de tres columnas y estados vacíos renderizados correctamente.

Las pruebas Rust validan la creación de las 22 tablas, la aplicación de claves foráneas, los valores reales de un dashboard vacío, la creación persistente de una tarea y su reflejo en el dashboard.

## Pendiente

- Panel rápido tipo popover, inicio de sesión y preferencias completas del tray.
- Notas flotantes y atajos globales.
- CRUD completo de tareas/proyectos y demás módulos.
- Temporizador robusto, notificaciones y servicios autorizados.
- Proyecto Xcode/WidgetKit. El equipo tiene Command Line Tools, pero no una instalación completa de Xcode seleccionada.
- Firma, notarización y pruebas manuales exhaustivas con Mission Control, Spaces, monitores externos y pantalla completa.
- El bundle actual tiene firma ad hoc local; no tiene identidad de Developer ID ni notarización para distribución pública.
- Cierre mediante el botón rojo: la automatización no pudo pulsarlo porque Terminal no tiene permiso de Accesibilidad; el controlador se compiló, pero la interacción queda pendiente de prueba manual.

## Próxima fase

Completar la Fase 2: ventana compacta del tray, autostart opcional, restauración persistida de geometría, acciones rápidas reales y pruebas manuales del ciclo de vida.
