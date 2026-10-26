//! Reglas de repetición de tareas y eventos.
//!
//! Las fechas se calculan en hora local de pared: una tarea de las 9:00 sigue a las
//! 9:00 tras un cambio de horario. Las mensuales del día 31 caen el último día de los
//! meses más cortos sin desplazarse después (`day_of_month` guarda el día pedido).

use chrono::{
    DateTime, Datelike, Days, Local, Months, NaiveDate, NaiveDateTime, TimeDelta, TimeZone,
};
use serde::{Deserialize, Serialize};

const MAX_INTERVAL: u32 = 99;
/// Tope de repeticiones que se expanden por evento en una consulta.
const MAX_OCCURRENCES: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    pub frequency: Frequency,
    #[serde(default = "one")]
    pub interval: u32,
    /// Días de la semana (1 = lunes … 7 = domingo). Solo en las semanales; vacío = el del inicio.
    #[serde(default)]
    pub weekdays: Vec<u8>,
    /// Solo tareas: la siguiente se cuenta desde el día en que se completa.
    #[serde(default)]
    pub from_completion: bool,
    /// Último instante en que puede empezar una repetición; `None` = sin fin.
    #[serde(default)]
    pub until: Option<i64>,
    /// Día del mes pedido en las mensuales y anuales de tareas. Lo mantiene Rust.
    #[serde(default)]
    pub day_of_month: Option<u32>,
}

fn one() -> u32 {
    1
}

impl RecurrenceRule {
    pub fn parse(stored: Option<&str>) -> Option<Self> {
        stored.and_then(|value| serde_json::from_str(value).ok())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Valida y normaliza la regla para algo que empieza en `start`.
    pub fn normalized(mut self, start: i64, for_task: bool) -> Result<Self, String> {
        if !(1..=MAX_INTERVAL).contains(&self.interval) {
            return Err(format!("El intervalo debe estar entre 1 y {MAX_INTERVAL}"));
        }
        if !for_task {
            self.from_completion = false;
        }
        if self.frequency == Frequency::Weekly && !self.from_completion {
            if self.weekdays.iter().any(|day| !(1..=7).contains(day)) {
                return Err("Día de la semana no válido".to_string());
            }
            self.weekdays.sort_unstable();
            self.weekdays.dedup();
        } else {
            self.weekdays.clear();
        }
        if self.until.is_some_and(|until| until < start) {
            return Err("La repetición no puede terminar antes de empezar".to_string());
        }
        self.day_of_month = match (for_task, self.frequency, local(start)) {
            (true, Frequency::Monthly | Frequency::Yearly, Some(moment)) => {
                let day = moment.day();
                // Se conserva el día pedido mientras la fecha sea su versión recortada (31 → 30).
                match self.day_of_month {
                    Some(wanted) if clamp_day(moment.date(), wanted) == day => Some(wanted),
                    _ => Some(day),
                }
            }
            _ => None,
        };
        Ok(self)
    }

    fn ends_before(&self, start: i64) -> bool {
        self.until.is_some_and(|until| start > until)
    }

    /// Primera fecha de la serie que empieza en `start` posterior a `after`.
    fn next_date(&self, start: NaiveDate, after: NaiveDate) -> Option<NaiveDate> {
        if after < start {
            return Some(match self.frequency {
                Frequency::Weekly => self.next_weekly(start, start.pred_opt()?)?,
                _ => self.month_date(start, 0)?,
            });
        }
        let interval = self.interval;
        match self.frequency {
            Frequency::Daily => {
                let elapsed = u32::try_from((after - start).num_days()).ok()?;
                let steps = elapsed / interval + 1;
                start.checked_add_days(Days::new(u64::from(steps * interval)))
            }
            Frequency::Weekly => self.next_weekly(start, after),
            Frequency::Monthly | Frequency::Yearly => {
                let step = if self.frequency == Frequency::Yearly {
                    interval * 12
                } else {
                    interval
                };
                let elapsed = (after.year() - start.year()) * 12 + after.month() as i32
                    - start.month() as i32;
                let mut months = u32::try_from(elapsed.max(0)).ok()?;
                months -= months % step;
                loop {
                    let date = self.month_date(start, months)?;
                    if date > after {
                        return Some(date);
                    }
                    months += step;
                }
            }
        }
    }

    fn next_weekly(&self, start: NaiveDate, after: NaiveDate) -> Option<NaiveDate> {
        let weekdays: Vec<u32> = if self.weekdays.is_empty() {
            vec![start.weekday().number_from_monday()]
        } else {
            self.weekdays.iter().map(|day| u32::from(*day)).collect()
        };
        let first_monday =
            start - TimeDelta::days(i64::from(start.weekday().num_days_from_monday()));
        let mut date = after.succ_opt()?.max(start);
        // Siempre hay una coincidencia antes de recorrer dos periodos completos.
        for _ in 0..(14 * self.interval + 7) {
            let week = (date - first_monday).num_days() / 7;
            if week % i64::from(self.interval) == 0
                && weekdays.contains(&date.weekday().number_from_monday())
            {
                return Some(date);
            }
            date = date.succ_opt()?;
        }
        None
    }

    fn month_date(&self, start: NaiveDate, months: u32) -> Option<NaiveDate> {
        let base = start.with_day(1)?.checked_add_months(Months::new(months))?;
        let day = self.day_of_month.unwrap_or(start.day());
        base.with_day(clamp_day(base, day))
    }

    /// Fecha siguiente a `base` al contar desde ella (modo «al completarla»).
    fn after_interval(&self, base: NaiveDate) -> Option<NaiveDate> {
        match self.frequency {
            Frequency::Daily => base.checked_add_days(Days::new(u64::from(self.interval))),
            Frequency::Weekly => base.checked_add_days(Days::new(u64::from(self.interval) * 7)),
            Frequency::Monthly => self.month_date(base, self.interval),
            Frequency::Yearly => self.month_date(base, self.interval * 12),
        }
    }

    /// Fecha límite de la siguiente tarea. Con fechas fijas es la primera de la serie
    /// posterior a la actual que no haya pasado ya; «al completarla» cuenta desde `completed_at`.
    /// `None` si la serie terminó.
    pub fn next_task_due(&self, due_at: i64, completed_at: i64) -> Option<i64> {
        let due = local(due_at)?;
        let time = due.time();
        let date = if self.from_completion {
            self.after_interval(local(completed_at)?.date())?
        } else {
            let yesterday = local(completed_at)?.date().pred_opt()?;
            self.next_date(due.date(), due.date().max(yesterday))?
        };
        let next = to_timestamp(date.and_time(time))?;
        (!self.ends_before(next)).then_some(next)
    }

    /// Inicios de las repeticiones de una serie que empieza en `starts_at` y dura
    /// `duration` segundos que se solapan con `[from, to)`, sin las excepciones.
    pub fn occurrences(
        &self,
        starts_at: i64,
        duration: i64,
        exceptions: &[i64],
        from: i64,
        to: i64,
    ) -> Vec<i64> {
        let Some(start) = local(starts_at) else {
            return Vec::new();
        };
        let time = start.time();
        let Some(search_from) = local(from - duration.max(0)) else {
            return Vec::new();
        };
        let mut cursor = search_from.date().pred_opt().unwrap_or(search_from.date());
        let mut result = Vec::new();
        while result.len() < MAX_OCCURRENCES {
            let Some(date) = self.next_date(start.date(), cursor) else {
                break;
            };
            cursor = date;
            let Some(occurrence) = to_timestamp(date.and_time(time)) else {
                continue;
            };
            if occurrence >= to || self.ends_before(occurrence) {
                break;
            }
            if occurrence + duration > from && !exceptions.contains(&occurrence) {
                result.push(occurrence);
            }
        }
        result
    }

    /// Primera repetición que empieza en `at` o después.
    pub fn first_from(&self, starts_at: i64, exceptions: &[i64], at: i64) -> Option<i64> {
        // Una semana basta en las diarias; las anuales necesitan un año y algo.
        let window = match self.frequency {
            Frequency::Daily | Frequency::Weekly => 120 * 86_400,
            Frequency::Monthly | Frequency::Yearly => 4 * 366 * 86_400,
        } * i64::from(self.interval);
        // `occurrences` exige terminar después de `from`: un segundo antes incluye `at`.
        let from = at.max(starts_at) - 1;
        self.occurrences(starts_at, 0, exceptions, from, from + window)
            .into_iter()
            .find(|occurrence| *occurrence >= at)
    }
}

fn clamp_day(month: NaiveDate, day: u32) -> u32 {
    let days_in_month = month
        .with_day(1)
        .and_then(|first| first.checked_add_months(Months::new(1)))
        .and_then(|next| next.pred_opt())
        .map_or(28, |last| last.day());
    day.clamp(1, days_in_month)
}

fn local(timestamp: i64) -> Option<NaiveDateTime> {
    Local
        .timestamp_opt(timestamp, 0)
        .single()
        .map(|moment: DateTime<Local>| moment.naive_local())
}

/// Hora local a instante. Una hora inexistente por el cambio de horario pasa a la siguiente.
fn to_timestamp(moment: NaiveDateTime) -> Option<i64> {
    Local
        .from_local_datetime(&moment)
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(moment + TimeDelta::hours(1)))
                .earliest()
        })
        .map(|value| value.timestamp())
}

/// Desplaza `timestamp` lo mismo que separa, en hora de pared, `from` de `to`.
pub fn shift_local(timestamp: i64, from: i64, to: i64) -> i64 {
    match (local(timestamp), local(from), local(to)) {
        (Some(value), Some(wall_from), Some(wall_to)) => {
            to_timestamp(value + (wall_to - wall_from)).unwrap_or(timestamp + to - from)
        }
        _ => timestamp + to - from,
    }
}

pub fn parse_exceptions(stored: &str) -> Vec<i64> {
    serde_json::from_str(stored).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(year: i32, month: u32, day: u32, hour: u32) -> i64 {
        to_timestamp(
            NaiveDate::from_ymd_opt(year, month, day)
                .unwrap()
                .and_hms_opt(hour, 0, 0)
                .unwrap(),
        )
        .unwrap()
    }

    fn rule(frequency: Frequency) -> RecurrenceRule {
        RecurrenceRule {
            frequency,
            interval: 1,
            weekdays: Vec::new(),
            from_completion: false,
            until: None,
            day_of_month: None,
        }
    }

    fn dates(values: &[i64]) -> Vec<String> {
        values
            .iter()
            .map(|value| local(*value).unwrap().format("%Y-%m-%d %H:%M").to_string())
            .collect()
    }

    #[test]
    fn validates_rules() {
        let start = at(2026, 3, 2, 9);
        let too_often = RecurrenceRule {
            interval: 0,
            ..rule(Frequency::Daily)
        };
        assert!(too_often.normalized(start, true).is_err());
        let bad_day = RecurrenceRule {
            weekdays: vec![8],
            ..rule(Frequency::Weekly)
        };
        assert!(bad_day.normalized(start, true).is_err());
        let ends_early = RecurrenceRule {
            until: Some(start - 1),
            ..rule(Frequency::Daily)
        };
        assert!(ends_early.normalized(start, true).is_err());

        let event = RecurrenceRule {
            from_completion: true,
            weekdays: vec![3, 1, 3],
            ..rule(Frequency::Weekly)
        }
        .normalized(start, false)
        .unwrap();
        assert!(!event.from_completion);
        assert_eq!(event.weekdays, [1, 3]);
        let daily = RecurrenceRule {
            weekdays: vec![1],
            ..rule(Frequency::Daily)
        }
        .normalized(start, true)
        .unwrap();
        assert!(daily.weekdays.is_empty());
    }

    #[test]
    fn next_task_due_follows_the_schedule() {
        // Lunes 2 de marzo de 2026 a las 9:00, completada ese mismo día.
        let due = at(2026, 3, 2, 9);
        assert_eq!(
            rule(Frequency::Daily).next_task_due(due, due),
            Some(at(2026, 3, 3, 9))
        );
        let workdays = RecurrenceRule {
            weekdays: vec![1, 2, 3, 4, 5],
            ..rule(Frequency::Weekly)
        };
        let friday = at(2026, 3, 6, 9);
        assert_eq!(
            workdays.next_task_due(friday, friday),
            Some(at(2026, 3, 9, 9))
        );
        let fortnightly = RecurrenceRule {
            interval: 2,
            weekdays: vec![1, 4],
            ..rule(Frequency::Weekly)
        };
        assert_eq!(fortnightly.next_task_due(due, due), Some(at(2026, 3, 5, 9)));
        let thursday = at(2026, 3, 5, 9);
        assert_eq!(
            fortnightly.next_task_due(thursday, thursday),
            Some(at(2026, 3, 16, 9))
        );
    }

    #[test]
    fn late_completion_does_not_create_past_tasks() {
        let due = at(2026, 3, 2, 9);
        let completed = at(2026, 3, 5, 18);
        // Fechas fijas: la primera que no haya pasado (hoy, día 5).
        assert_eq!(
            rule(Frequency::Daily).next_task_due(due, completed),
            Some(at(2026, 3, 5, 9))
        );
        // Al completarla: tres días después de completarla, a la misma hora.
        let after_done = RecurrenceRule {
            interval: 3,
            from_completion: true,
            ..rule(Frequency::Daily)
        };
        assert_eq!(
            after_done.next_task_due(due, completed),
            Some(at(2026, 3, 8, 9))
        );
    }

    #[test]
    fn monthly_keeps_the_requested_day() {
        let due = at(2026, 1, 31, 12);
        let monthly = rule(Frequency::Monthly).normalized(due, true).unwrap();
        assert_eq!(monthly.day_of_month, Some(31));
        let february = monthly.next_task_due(due, due).unwrap();
        assert_eq!(february, at(2026, 2, 28, 12));
        // Al guardar la tarea de febrero se conserva el 31.
        let monthly = monthly.normalized(february, true).unwrap();
        assert_eq!(monthly.day_of_month, Some(31));
        assert_eq!(
            monthly.next_task_due(february, february),
            Some(at(2026, 3, 31, 12))
        );
        // Cambiar la fecha a mano cambia el día pedido.
        assert_eq!(
            monthly
                .normalized(at(2026, 2, 10, 12), true)
                .unwrap()
                .day_of_month,
            Some(10)
        );
    }

    #[test]
    fn series_end_on_until() {
        let due = at(2026, 3, 2, 9);
        let limited = RecurrenceRule {
            until: Some(at(2026, 3, 3, 23)),
            ..rule(Frequency::Daily)
        };
        assert_eq!(limited.next_task_due(due, due), Some(at(2026, 3, 3, 9)));
        let last = at(2026, 3, 3, 9);
        assert_eq!(limited.next_task_due(last, last), None);
    }

    #[test]
    fn expands_event_occurrences_in_a_range() {
        let start = at(2026, 3, 2, 10);
        let weekly = RecurrenceRule {
            weekdays: vec![1, 3],
            ..rule(Frequency::Weekly)
        };
        let excluded = at(2026, 3, 9, 10);
        let found = weekly.occurrences(
            start,
            3_600,
            &[excluded],
            at(2026, 3, 4, 0),
            at(2026, 3, 16, 0),
        );
        assert_eq!(dates(&found), ["2026-03-04 10:00", "2026-03-11 10:00"]);
        // Una repetición que empezó antes del rango pero sigue en curso también cuenta.
        let ongoing = rule(Frequency::Daily).occurrences(
            start,
            2 * 86_400,
            &[],
            at(2026, 3, 10, 0),
            at(2026, 3, 11, 0),
        );
        assert_eq!(
            dates(&ongoing),
            ["2026-03-08 10:00", "2026-03-09 10:00", "2026-03-10 10:00"]
        );
        // Nada antes del inicio de la serie.
        assert!(
            rule(Frequency::Daily)
                .occurrences(start, 3_600, &[], at(2026, 2, 1, 0), at(2026, 3, 2, 0))
                .is_empty()
        );
        let yearly = rule(Frequency::Yearly);
        assert_eq!(
            dates(&yearly.occurrences(start, 3_600, &[], at(2027, 1, 1, 0), at(2028, 1, 1, 0))),
            ["2027-03-02 10:00"]
        );
        assert_eq!(
            yearly.first_from(start, &[], at(2026, 3, 3, 0)),
            Some(at(2027, 3, 2, 10))
        );
    }

    #[test]
    fn shifts_in_wall_clock_time() {
        let from = at(2026, 3, 2, 10);
        let to = at(2026, 3, 2, 11);
        assert_eq!(
            shift_local(at(2026, 7, 6, 10), from, to),
            at(2026, 7, 6, 11)
        );
    }
}
