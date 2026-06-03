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
      "Total horas trabajadas semana",
      "Horas ordinarias",
      "Horas extra",
      "Valor hora extra",
      "Pago horas extras",
    ],
    ...summaryRows.map((row) => [
      row.collaborator.name,
      row.collaborator.documentId,
      row.totalWorkedHours,
      row.ordinaryHours,
      row.overtimeHours,
      row.overtimeRate,
      row.totalPay,
    ]),
    [],
    [
      "Totales",
      "",
      snapshot.totals.workedHours,
      snapshot.totals.ordinaryHours,
      snapshot.totals.overtimeHours,
      "",
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
      "Horas del tramo",
      "Horas del dia",
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
      record.dayWorkedHours,
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
    ["Total horas trabajadas semana", summaryRow.totalWorkedHours],
    ["Horas ordinarias", summaryRow.ordinaryHours],
    ["Horas extras", summaryRow.overtimeHours],
    ["Valor hora extra", summaryRow.overtimeRate],
    ["Pago horas extras", summaryRow.totalPay],
    [],
    ["Fecha", "Dia", "Horario(s)", "Horas trabajadas"],
    ...collaboratorDays.map((day) => [
      formatDateLabel(day.date),
      day.dayLabel,
      day.scheduleLabel,
      day.totalWorkedHours,
    ]),
    [],
    ["Totales", "", "", summaryRow.totalWorkedHours],
  ];
}

function buildDailyMarkingSummaryRows(snapshot) {
  return [
    ["CARNES SAN MARTIN GRANADA"],
    ["Reporte diario de marcacion"],
    ["Fecha", formatDateLabel(snapshot.reportDate)],
    ["Semana legal", formatDateLabel(snapshot.weekStart), "Semana al", formatDateLabel(snapshot.weekEnd)],
    [],
    [
      "Colaborador",
      "Cedula",
      "Tramos",
      "Horario(s) del dia",
      "Horas del dia",
      "Total semana",
      "Horas ordinarias semana",
      "Horas extra semana",
      "Pago horas extra",
      "Estado",
    ],
    ...snapshot.summaryRows.map((row) => [
      row.collaborator.name,
      row.collaborator.documentId,
      row.recordCount,
      row.scheduleLabel,
      row.totalWorkedHours,
      row.weeklyTotalWorkedHours,
      row.weeklyOrdinaryHours,
      row.weeklyOvertimeHours,
      row.weeklyOvertimePay,
      row.statusLabel,
    ]),
    [],
    [
      "Totales",
      "",
      snapshot.totals.recordCount,
      "",
      snapshot.totals.workedHours,
      "",
      snapshot.totals.ordinaryHours,
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
      "Horas del tramo",
      "Horas del dia",
      "Total semana",
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
      record.dayWorkedHours,
      record.weeklyTotalWorkedHours,
      record.source === "clock" ? "Marcacion" : "Manual",
      record.checkOut ? "Completo" : "Entrada abierta",
    ]),
  ];
}

export function exportConsolidatedWorkbook(snapshot) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildConsolidatedRows(snapshot), [34, 16, 20, 18, 16, 18, 18]),
    "Consolidado"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildRawRows(snapshot), [14, 14, 34, 12, 12, 14, 16, 16, 12, 14]),
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
    buildSheet(buildDailyMarkingSummaryRows(snapshot), [34, 16, 10, 34, 16, 16, 18, 16, 18, 18]),
    "Resumen dia"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(buildDailyMarkingRawRows(snapshot), [34, 16, 12, 12, 14, 16, 16, 16, 12, 16]),
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
    buildSheet(buildSlipRows(snapshot, summaryRow, collaboratorDays), [18, 38, 34, 16]),
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
      buildSheet(buildSlipRows(snapshot, summaryRow, collaboratorDays), [18, 38, 34, 16]),
      sheetName
    );
  }

  XLSX.writeFile(
    workbook,
    `colillas-horas-extras-${snapshot.weekStart}-${getWeekEnd(snapshot.weekStart)}.xlsx`
  );
}
