const DATE_FORMATTER = new Intl.DateTimeFormat("es-NI", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-NI", {
  dateStyle: "medium",
  timeStyle: "short",
});

const CURRENCY_FORMATTER = new Intl.NumberFormat("es-NI", {
  style: "currency",
  currency: "NIO",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DAY_FORMATTER = new Intl.DateTimeFormat("es-NI", {
  weekday: "long",
});

export const dayNames = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function toInputDate(date) {
  const parsed = new Date(date);
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

export function toInputTime(date) {
  const parsed = new Date(date);
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return toInputDate(parsed);
}

export function getMonday(date) {
  const parsed = new Date(date);
  const day = parsed.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  parsed.setDate(parsed.getDate() + diff);
  return toInputDate(parsed);
}

export function getWeekEnd(weekStart) {
  return addDays(weekStart, 6);
}

export function isDateInWeek(date, weekStart) {
  const start = new Date(`${weekStart}T00:00:00`).getTime();
  const end = new Date(`${getWeekEnd(weekStart)}T23:59:59`).getTime();
  const target = new Date(`${date}T12:00:00`).getTime();
  return target >= start && target <= end;
}

export function formatDateLabel(date) {
  if (!date) {
    return "--";
  }
  return DATE_FORMATTER.format(new Date(`${date}T12:00:00`));
}

export function formatDateTimeLabel(value) {
  if (!value) {
    return "--";
  }
  return DATE_TIME_FORMATTER.format(new Date(value));
}

export function formatCurrency(value) {
  return CURRENCY_FORMATTER.format(Number(value || 0));
}

export function formatHours(value) {
  return `${Number(value || 0).toFixed(2)} h`;
}

export function formatCompactHours(value) {
  return Number(value || 0).toFixed(2);
}

export function getDayLabel(date) {
  if (!date) {
    return "--";
  }
  return DAY_FORMATTER.format(new Date(`${date}T12:00:00`));
}

export function calculateWorkedHours(record) {
  if (!record?.date || !record?.checkIn || !record?.checkOut) {
    return 0;
  }

  const start = new Date(`${record.date}T${record.checkIn}:00`);
  const end = new Date(`${record.date}T${record.checkOut}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  const breakMinutes = Number(record.breakMinutes || 0);
  const diffHours = (end.getTime() - start.getTime()) / 36e5;
  return Math.max(diffHours - breakMinutes / 60, 0);
}

export function roundWorkedHours(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  const normalizedValue = Number(numericValue.toFixed(4));
  const wholeHours = Math.floor(normalizedValue);
  const decimalHours = Number((normalizedValue - wholeHours).toFixed(4));

  if (decimalHours <= 0.25) {
    return wholeHours;
  }

  if (decimalHours <= 0.75) {
    return wholeHours + 0.5;
  }

  return wholeHours + 1;
}

export function sumNumbers(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}
