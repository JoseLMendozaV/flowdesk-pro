use std::{
    sync::{Condvar, Mutex},
    time::Duration,
};

/// Señal para despertar un hilo de fondo antes de tiempo (cambio de datos o de
/// preferencias) sin que tenga que sondear.
pub struct Wakeup {
    pending: Mutex<bool>,
    signal: Condvar,
}

impl Wakeup {
    pub fn new(pending: bool) -> Self {
        Self {
            pending: Mutex::new(pending),
            signal: Condvar::new(),
        }
    }

    pub fn wake(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = true;
            self.signal.notify_all();
        }
    }

    /// Espera `timeout`, o indefinidamente con `None`, salvo aviso. Devuelve si hubo
    /// aviso (también si llegó antes de empezar a esperar) y lo consume.
    pub fn wait(&self, timeout: Option<Duration>) -> bool {
        let Ok(guard) = self.pending.lock() else {
            return true;
        };
        let guard = match timeout {
            Some(timeout) => self
                .signal
                .wait_timeout_while(guard, timeout, |pending| !*pending)
                .map(|(guard, _)| guard)
                .ok(),
            None => self.signal.wait_while(guard, |pending| !*pending).ok(),
        };
        guard.is_none_or(|mut pending| std::mem::take(&mut *pending))
    }
}

#[cfg(test)]
mod tests {
    use super::Wakeup;
    use std::time::Duration;

    #[test]
    fn wake_before_wait_is_not_lost() {
        let wakeup = Wakeup::new(false);
        assert!(!wakeup.wait(Some(Duration::from_millis(5))));
        wakeup.wake();
        assert!(wakeup.wait(None));
        assert!(!wakeup.wait(Some(Duration::from_millis(5))));
    }
}
