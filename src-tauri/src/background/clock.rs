use std::time::Duration;

/// Fuentes de tiempo del servicio de temporizadores. Se abstraen para poder simular
/// en las pruebas el paso del tiempo, el reposo del Mac y los cambios de hora.
pub trait Clock: Send + Sync {
    /// Tiempo con el equipo despierto. No avanza en reposo ni cambia con la hora del sistema.
    fn awake(&self) -> Duration;
    /// Tiempo monotónico que sigue avanzando durante el reposo.
    fn continuous(&self) -> Duration;
    /// Hora de pared (Unix, segundos) solo para registros y fechas visibles.
    fn wall(&self) -> i64;
}

pub struct SystemClock;

#[cfg(target_os = "macos")]
fn read(clock: libc::clockid_t) -> Duration {
    let mut spec = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `spec` es un puntero válido y ambos relojes existen en macOS ≥ 10.12.
    unsafe { libc::clock_gettime(clock, &mut spec) };
    Duration::new(spec.tv_sec as u64, spec.tv_nsec as u32)
}

impl Clock for SystemClock {
    #[cfg(target_os = "macos")]
    fn awake(&self) -> Duration {
        read(libc::CLOCK_UPTIME_RAW)
    }

    #[cfg(target_os = "macos")]
    fn continuous(&self) -> Duration {
        // En macOS CLOCK_MONOTONIC continúa durante el reposo.
        read(libc::CLOCK_MONOTONIC)
    }

    // Fuera de macOS no se distingue el reposo: ambos relojes coinciden.
    #[cfg(not(target_os = "macos"))]
    fn awake(&self) -> Duration {
        use std::{sync::OnceLock, time::Instant};
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        ORIGIN.get_or_init(Instant::now).elapsed()
    }

    #[cfg(not(target_os = "macos"))]
    fn continuous(&self) -> Duration {
        self.awake()
    }

    fn wall(&self) -> i64 {
        chrono::Utc::now().timestamp()
    }
}

#[cfg(test)]
pub mod testing {
    use super::Clock;
    use std::{sync::Mutex, time::Duration};

    /// Reloj manual para pruebas.
    #[derive(Default)]
    pub struct ManualClock {
        state: Mutex<(Duration, Duration, i64)>,
    }

    impl ManualClock {
        pub fn new(wall: i64) -> Self {
            Self {
                state: Mutex::new((Duration::from_secs(1_000), Duration::from_secs(1_000), wall)),
            }
        }

        /// El equipo permanece despierto `seconds` segundos.
        pub fn advance(&self, seconds: u64) {
            let mut state = self.state.lock().unwrap();
            state.0 += Duration::from_secs(seconds);
            state.1 += Duration::from_secs(seconds);
            state.2 += seconds as i64;
        }

        /// El equipo duerme `seconds` segundos.
        pub fn sleep(&self, seconds: u64) {
            let mut state = self.state.lock().unwrap();
            state.1 += Duration::from_secs(seconds);
            state.2 += seconds as i64;
        }

        /// El usuario cambia la hora del sistema.
        pub fn shift_wall(&self, seconds: i64) {
            self.state.lock().unwrap().2 += seconds;
        }
    }

    impl Clock for ManualClock {
        fn awake(&self) -> Duration {
            self.state.lock().unwrap().0
        }
        fn continuous(&self) -> Duration {
            self.state.lock().unwrap().1
        }
        fn wall(&self) -> i64 {
            self.state.lock().unwrap().2
        }
    }
}
