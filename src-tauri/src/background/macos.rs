//! Consultas al sistema compartidas por el portapapeles y el seguimiento automático.
//! Ninguna requiere permisos de accesibilidad ni de grabación de pantalla.

use crate::models::ExcludedApp;
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSBundle, NSString};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

/// `kCGEventSourceStateCombinedSessionState`.
const COMBINED_SESSION_STATE: i32 = 0;
/// `kCGAnyInputEventType`.
const ANY_INPUT_EVENT: u32 = u32::MAX;

/// App en primer plano: solo identificador y nombre, nunca títulos de ventana.
pub fn frontmost_app() -> Option<ExcludedApp> {
    autoreleasepool(|_| {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let bundle_id = app.bundleIdentifier()?.to_string();
        let name = app
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_else(|| bundle_id.clone());
        Some(ExcludedApp { bundle_id, name })
    })
}

/// Segundos desde la última pulsación o movimiento del ratón en la sesión.
pub fn idle_seconds() -> i64 {
    // SAFETY: función de CoreGraphics sin efectos secundarios; los argumentos son constantes válidas.
    let seconds =
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
    if seconds.is_finite() && seconds >= 0.0 {
        seconds as i64
    } else {
        0
    }
}

/// Identificador y nombre de una app a partir de su paquete `.app`.
pub fn bundle_info(path: &str) -> Option<ExcludedApp> {
    autoreleasepool(|_| {
        let bundle = NSBundle::bundleWithPath(&NSString::from_str(path))?;
        let bundle_id = bundle.bundleIdentifier()?.to_string();
        let name = std::path::Path::new(path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| bundle_id.clone());
        Some(ExcludedApp { bundle_id, name })
    })
}

/// macOS solo muestra el banner de un aviso con la app en primer plano si el delegado
/// del centro de notificaciones lo pide. El de `mac-notification-sys` (que usa
/// `tauri-plugin-notification`) no implementa `shouldPresentNotification:` y los avisos
/// llegaban sin banner mientras se usaba FlowDesk. Se añade solo ese método:
/// `class_addMethod` no sustituye una implementación existente.
pub fn present_notifications_in_foreground() -> bool {
    use objc2::{
        ffi,
        runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
        sel,
    };

    unsafe extern "C-unwind" fn should_present(
        _this: &AnyObject,
        _cmd: Sel,
        _center: &AnyObject,
        _notification: &AnyObject,
    ) -> Bool {
        Bool::YES
    }

    let Some(class) = AnyClass::get(c"NotificationCenterDelegate") else {
        return false;
    };
    #[cfg(target_arch = "aarch64")]
    let types = c"B@:@@";
    #[cfg(not(target_arch = "aarch64"))]
    let types = c"c@:@@";
    // SAFETY: la función tiene la firma del selector (BOOL, self, _cmd, centro, aviso)
    // y `types` es su codificación; la clase existe durante toda la ejecución.
    unsafe {
        let imp = std::mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject, &AnyObject) -> Bool,
            Imp,
        >(should_present);
        ffi::class_addMethod(
            std::ptr::from_ref(class).cast_mut(),
            sel!(userNotificationCenter:shouldPresentNotification:),
            imp,
            types.as_ptr(),
        )
        .as_bool()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn adds_foreground_presentation_once() {
        let selector = objc2::sel!(userNotificationCenter:shouldPresentNotification:);
        let class =
            objc2::runtime::AnyClass::get(c"NotificationCenterDelegate").expect("delegate class");
        assert!(super::present_notifications_in_foreground());
        assert!(class.instance_method(selector).is_some());
        // Una segunda llamada no reemplaza el método.
        assert!(!super::present_notifications_in_foreground());
    }
}
