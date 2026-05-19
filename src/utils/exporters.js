import * as XLSX from "xlsx";
import { formatDateLabel, getWeekEnd } from "./time";

function buildSheet(rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map((width) => ({ wch: width }));
  return sheet;
}

function buildConsolidatedRows(snapshot) {
  const summaryRows = snapshot.summaryRows.filter(
    (row) => row.recordCount > 0 || row.overtimeHours > 0
  );

  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Consolidado semanal de pago de horas extras"],
    ["Semana del", formatDateLabel(snapshot.weekStart), "Semana al", formatDateLabel(snapshot.weekEnd)],
    [],
    [
      "Colaborador",
      "Cedula",
      "Valor hora extra",
      "Horas trabajadas",
      "Horas extra",
      "Total a pagar",
    ],
    ...summaryRows.map((row) => [
      row.collaborator.name,
      row.collaborator.documentId,
      row.overtimeRate,
      row.totalWorkedHours,
      row.overtimeHours,
      row.totalPay,
    ]),
    [],
    [
      "Totales",
      "",
      "",
      snapshot.totals.workedHours,
      snapshot.totals.overtimeHours,
      snapshot.totals.totalPay,
    ],
  ];
}

function buildRawRows(snapshot) {
  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Registros semanales"],
    ["Semana del", formatDateLabel(snapshot.weekStart), "Semana al", formatDateLabel(snapshot.weekEnd)],
    [],
    [
      "Fecha",
      "Dia",
      "Colaborador",
      "Entrada",
      "Salida",
      "Descanso (min)",
      "Horas trabajadas",
      "Fuente",
      "Estado",
    ],
    ...snapshot.processedRecords.map((record) => [
      formatDateLabel(record.date),
      record.dayLabel,
      record.collaborator.name,
      record.checkIn || "",
      record.checkOut || "",
      Number(record.breakMinutes || 0),
      record.workedHours,
      record.source === "clock" ? "Marcacion" : "Manual",
      record.checkOut ? "Completo" : "Pendiente",
    ]),
  ];
}

function buildSlipRows(snapshot, summaryRow, collaboratorDays) {
  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Colilla de pago de horas extras"],
    [],
    ["Colaborador", summaryRow.collaborator.name],
    ["Cedula", summaryRow.collaborator.documentId],
    ["Semana del", formatDateLabel(snapshot.weekStart)],
    ["Semana al", formatDateLabel(snapshot.weekEnd)],
    ["Valor hora extra", summaryRow.overtimeRate],
    [],
    ["Fecha", "Dia", "Horario(s)", "Horas trabajadas", "Horas extra", "Pago"],
    ...collaboratorDays.map((day) => [
      formatDateLabel(day.date),
      day.dayLabel,
      day.scheduleLabel,
      day.totalWorkedHours,
      day.overtimeHours,
      day.overtimePay,
    ]),
    [],
    ["Totales", "", "", summaryRow.totalWorkedHours, summaryRow.overtimeHours, summaryRow.totalPay],
  ];
}

function buildDailyMarkingSummaryRows(snapshot) {
  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Reporte diario de marcacion"],
    ["Fecha", formatDateLabel(snapshot.reportDate)],
    [],
    [
      "Colaborador",
      "Cedula",
      "Tramos",
      "Horario(s) del dia",
      "Horas trabajadas",
      "Horas extra",
      "Total estimado",
      "Estado",
    ],
    ...snapshot.summaryRows.map((row) => [
      row.collaborator.name,
      row.collaborator.documentId,
      row.recordCount,
      row.scheduleLabel,
      row.totalWorkedHours,
      row.overtimeHours,
      row.overtimePay,
      row.statusLabel,
    ]),
    [],
    [
      "Totales",
      "",
      snapshot.totals.recordCount,
      "",
      snapshot.totals.workedHours,
      snapshot.totals.overtimeHours,
      snapshot.totals.totalPay,
      `${snapshot.totals.openCount} abierto(s)`,
    ],
  ];
}

function buildDailyMarkingRawRows(snapshot) {
  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Marcaciones del dia"],
    ["Fecha", formatDateLabel(snapshot.reportDate)],
    [],
    [
      "Colaborador",
      "Cedula",
      "Entrada",
      "Salida",
      "Descanso (min)",
      "Horas trabajadas",
      "Fuente",
      "Estado",
    ],
    ...snapshot.processedRecords.map((record) => [
      record.collaborator.name,
      record.collaborator.documentId,
      record.checkIn || "",
      record.checkOut || "",
      Number(record.breakMinutes || 0),
      record.workedHours,
      record.source === "clock" ? "Marcacion" : "Manual",
      record.checkOut ? "Completo" : "Entrada abierta",
    ]),
  ];
}

export function exportConsolidatedWorkbook(snapshot) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildConsolidatedRows(snapshot), [34, 16, 18, 18, 16, 14, 16]),
    "Consolidado"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildRawRows(snapshot), [14, 14, 34, 12, 12, 14, 16, 12, 14]),
    "Registros"
  );

  XLSX.writeFile(
    workbook,
    `consolidado-horas-extras-${snapshot.weekStart}-${getWeekEnd(snapshot.weekStart)}.xlsx`
  );
}

export function exportDailyMarkingWorkbook(snapshot) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildDailyMarkingSummaryRows(snapshot), [34, 16, 10, 34, 18, 14, 16, 18]),
    "Resumen dia"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildDailyMarkingRawRows(snapshot), [34, 16, 12, 12, 14, 16, 12, 16]),
    "Marcaciones dia"
  );

  XLSX.writeFile(workbook, `reporte-marcaciones-${snapshot.reportDate}.xlsx`);
}

export function exportIndividualSlipWorkbook(snapshot, employeeId) {
  const summaryRow = snapshot.summaryRows.find(
    (row) => row.collaborator.id === employeeId
  );

  if (!summaryRow) {
    return;
  }

  const collaboratorDays = snapshot.dailySummaries.filter(
    (day) => day.employeeId === employeeId
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildSlipRows(snapshot, summaryRow, collaboratorDays), [18, 38, 34, 16, 14, 14]),
    "Colilla"
  );

  const safeName = summaryRow.collaborator.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  XLSX.writeFile(workbook, `colilla-${safeName}-${snapshot.weekStart}.xlsx`);
}

export function exportAllSlipsWorkbook(snapshot) {
  const workbook = XLSX.utils.book_new();

  for (const summaryRow of snapshot.summaryRows) {
    const collaboratorDays = snapshot.dailySummaries.filter(
      (day) => day.employeeId === summaryRow.collaborator.id
    );

    const sheetName = summaryRow.collaborator.name.slice(0, 31);
    XLSX.utils.book_append_sheet(
      workbook,
      buildSheet(buildSlipRows(snapshot, summaryRow, collaboratorDays), [18, 38, 34, 16, 14, 14]),
      sheetName
    );
  }

  XLSX.writeFile(
    workbook,
    `colillas-horas-extras-${snapshot.weekStart}-${getWeekEnd(snapshot.weekStart)}.xlsx`
  );
}
