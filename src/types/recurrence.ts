export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Regla de repetición de una tarea o un evento. La valida y normaliza Rust. */
export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  /** 1 = lunes … 7 = domingo. Solo en las semanales; vacío = el día del inicio. */
  weekdays: number[];
  /** Solo tareas: la siguiente se cuenta desde el día en que se completa. */
  fromCompletion: boolean;
  /** Último instante en que puede empezar una repetición. */
  until: number | null;
  /** Día del mes pedido en tareas mensuales o anuales (lo mantiene Rust). */
  dayOfMonth?: number | null;
};
