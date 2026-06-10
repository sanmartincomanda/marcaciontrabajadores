import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { normalizeDocumentId } from "../data/collaborators";
import { formatDateLabel, getWeekEnd } from "./time";

const BRAND = {
  companyName: "Carnes San Martin Granada",
  accent: "FFE1141B",
  accentSoft: "FFFBE7E8",
  dark: "FF111111",
  muted: "FF6C6C6C",
  border: "FFD6D6D6",
  paper: "FFF8F6F3",
  editable: "FFFFF4CC",
};

const BANK_PAYROLL_PLAN_NUMBER = "AAF6";

function buildSheet(rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map((width) => ({ wch: width }));
  return sheet;
}

function formatWeekRange(start, end) {
  return `Semana del ${formatDateLabel(start)} al ${formatDateLabel(end)}`;
}

function formatCompactDayMonth(value) {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) {
    return "";
  }

  return `${day}${month}`;
}

function formatBankDate(value) {
  return String(value || "").replace(/-/g, "");
}

function formatBankAmount(value) {
  const cents = Math.round(Number(value || 0) * 100);
  return String(Math.max(cents, 0)).padStart(13, "0");
}

function padRight(value, length) {
  return String(value ?? "").padEnd(length, " ");
}

function buildBankDetailDescription(snapshot) {
  return `Horas extras ${formatCompactDayMonth(snapshot.weekStart)} al ${formatCompactDayMonth(snapshot.weekEnd)}`;
}

function buildBankPaymentRows(snapshot) {
  return snapshot.summaryRows.filter((row) => Number(row.totalPay || 0) > 0);
}

function triggerTextDownload(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function getLogoUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  return new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.origin).toString();
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

async function loadWorkbookLogo(workbook) {
  const logoUrl = getLogoUrl();
  if (!logoUrl) {
    return null;
  }

  const response = await fetch(logoUrl);
  if (!response.ok) {
    throw new Error("No pude cargar el logo para el reporte.");
  }

  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  return workbook.addImage({
    base64: `data:image/png;base64,${base64}`,
    extension: "png",
  });
}

function triggerDownload(buffer, filename) {
  const blob = new Blob(
    [buffer],
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
  );
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

async function saveWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
}

function setCellText(cell, value) {
  cell.value = value ?? "";
  return cell;
}

function styleTitle(cell, size = 18) {
  cell.font = {
    name: "Aptos Display",
    size,
    bold: true,
    color: { argb: BRAND.dark },
  };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleMuted(cell) {
  cell.font = {
    name: "Aptos",
    size: 10,
    color: { argb: BRAND.muted },
  };
}

function styleLabel(cell) {
  cell.font = {
    name: "Aptos",
    size: 10,
    bold: true,
    color: { argb: BRAND.muted },
  };
}

function styleTableHeader(row) {
  row.eachCell((cell) => {
    cell.font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.accent },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: BRAND.accent } },
      left: { style: "thin", color: { argb: BRAND.accent } },
      bottom: { style: "thin", color: { argb: BRAND.accent } },
      right: { style: "thin", color: { argb: BRAND.accent } },
    };
  });
  row.height = 24;
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.font = {
      name: "Aptos",
      size: 10,
      color: { argb: BRAND.dark },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: BRAND.border } },
      left: { style: "thin", color: { argb: BRAND.border } },
      bottom: { style: "thin", color: { argb: BRAND.border } },
      right: { style: "thin", color: { argb: BRAND.border } },
    };
  });
  row.height = 22;
}

function styleCurrencyColumn(worksheet, columnKey) {
  worksheet.getColumn(columnKey).numFmt = '"C$" #,##0.00';
}

function styleHourColumn(worksheet, columnKey) {
  worksheet.getColumn(columnKey).numFmt = "0.0";
}

function applyLetterhead(worksheet, {
  logoId,
  title,
  subtitle,
  weekRange,
  documentLabel,
}) {
  worksheet.views = [{ showGridLines: false }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };

  worksheet.mergeCells("C1:I1");
  worksheet.mergeCells("C2:I2");
  worksheet.mergeCells("C3:I3");
  worksheet.mergeCells("C4:I4");

  if (logoId != null) {
    worksheet.addImage(logoId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 92, height: 92 },
    });
  }

  setCellText(worksheet.getCell("C1"), BRAND.companyName);
  styleTitle(worksheet.getCell("C1"), 20);

  setCellText(worksheet.getCell("C2"), title);
  worksheet.getCell("C2").font = {
    name: "Aptos Display",
    size: 15,
    bold: true,
    color: { argb: BRAND.accent },
  };

  setCellText(worksheet.getCell("C3"), subtitle);
  styleLabel(worksheet.getCell("C3"));

  setCellText(worksheet.getCell("C4"), weekRange);
  styleMuted(worksheet.getCell("C4"));

  worksheet.mergeCells("A5:I5");
  setCellText(worksheet.getCell("A5"), documentLabel);
  worksheet.getCell("A5").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND.paper },
  };
  worksheet.getCell("A5").font = {
    name: "Aptos",
    size: 10,
    italic: true,
    color: { argb: BRAND.muted },
  };
  worksheet.getCell("A5").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell("A5").border = {
    top: { style: "thin", color: { argb: BRAND.border } },
    bottom: { style: "thin", color: { argb: BRAND.border } },
  };

  [1, 2, 3, 4, 5].forEach((rowNumber) => {
    worksheet.getRow(rowNumber).height = rowNumber === 1 ? 26 : 20;
  });
}

function styleTotalsRow(row) {
  row.eachCell((cell) => {
    cell.font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: BRAND.dark },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF4F4F4" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "medium", color: { argb: BRAND.accent } },
      bottom: { style: "thin", color: { argb: BRAND.border } },
    };
  });
  row.height = 23;
}

function buildConsolidatedRows(snapshot) {
  return snapshot.summaryRows.filter(
    (row) => row.recordCount > 0 || row.overtimeHours > 0
  );
}

function buildRawRows(snapshot) {
  return snapshot.processedRecords.map((record) => ({
    date: formatDateLabel(record.date),
    dayLabel: record.dayLabel,
    collaborator: record.collaborator.name,
    checkIn: record.checkIn || "",
    checkOut: record.checkOut || "",
    breakMinutes: Number(record.breakMinutes || 0),
    workedHours: record.workedHours,
    dayWorkedHours: record.dayWorkedHours,
    source: record.source === "clock" ? "Marcacion" : "Manual",
    status: record.checkOut ? "Completo" : "Pendiente",
  }));
}

function buildSlipRows(collaboratorDays) {
  return collaboratorDays.map((day) => ({
    date: formatDateLabel(day.date),
    dayLabel: day.dayLabel,
    schedule: day.scheduleLabel,
    workedHours: day.totalWorkedHours,
  }));
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

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenAI Codex";
  workbook.company = BRAND.companyName;
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

function createDetailSheet(workbook, snapshot, logoId) {
  const worksheet = workbook.addWorksheet("Registros");
  applyLetterhead(worksheet, {
    logoId,
    title: "Respaldo de Marcaciones Semanales",
    subtitle: "Detalle de tramos y horas diarias registradas",
    weekRange: formatWeekRange(snapshot.weekStart, snapshot.weekEnd),
    documentLabel: "Anexo operativo para soporte de calculo semanal",
  });

  worksheet.columns = [
    { key: "date", width: 14 },
    { key: "day", width: 16 },
    { key: "collaborator", width: 34 },
    { key: "checkIn", width: 12 },
    { key: "checkOut", width: 12 },
    { key: "breakMinutes", width: 14 },
    { key: "workedHours", width: 14 },
    { key: "dayWorkedHours", width: 14 },
    { key: "source", width: 14 },
    { key: "status", width: 16 },
  ];

  const headerRow = worksheet.getRow(7);
  headerRow.values = [
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
  ];
  styleTableHeader(headerRow);

  const rows = buildRawRows(snapshot);
  let currentRow = 8;
  for (const item of rows) {
    const row = worksheet.getRow(currentRow);
    row.values = [
      item.date,
      item.dayLabel,
      item.collaborator,
      item.checkIn,
      item.checkOut,
      item.breakMinutes,
      item.workedHours,
      item.dayWorkedHours,
      item.source,
      item.status,
    ];
    styleDataRow(row);
    row.getCell(3).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    currentRow += 1;
  }

  styleHourColumn(worksheet, "G");
  styleHourColumn(worksheet, "H");
  worksheet.autoFilter = "A7:J7";
  worksheet.views = [{ state: "frozen", ySplit: 7, showGridLines: false }];
}

async function createConsolidatedWorkbook(snapshot) {
  const workbook = createWorkbook();
  const logoId = await loadWorkbookLogo(workbook);
  const worksheet = workbook.addWorksheet("Consolidado");

  applyLetterhead(worksheet, {
    logoId,
    title: "Consolidado Semanal de Pago de Horas Extras",
    subtitle: "Documento de respaldo fiscal y laboral",
    weekRange: formatWeekRange(snapshot.weekStart, snapshot.weekEnd),
    documentLabel:
      "Las celdas amarillas se pueden ajustar manualmente. El pago se recalcula automaticamente en Excel.",
  });

  worksheet.columns = [
    { key: "index", width: 6 },
    { key: "collaborator", width: 34 },
    { key: "documentId", width: 18 },
    { key: "totalWorkedHours", width: 18 },
    { key: "ordinaryHours", width: 16 },
    { key: "overtimeHours", width: 16 },
    { key: "overtimeRate", width: 18 },
    { key: "overtimePay", width: 18 },
    { key: "signature", width: 24 },
  ];

  const headerRow = worksheet.getRow(7);
  headerRow.values = [
    "No.",
    "Colaborador",
    "Cedula",
    "Total Horas Trabajadas Semana",
    "Horas Ordinarias",
    "Horas Extras",
    "Valor Hora Extra",
    "Pago Horas Extras",
    "FIRMAS",
  ];
  styleTableHeader(headerRow);

  const summaryRows = buildConsolidatedRows(snapshot);
  const dataStartRow = 8;

  summaryRows.forEach((item, index) => {
    const rowNumber = dataStartRow + index;
    const row = worksheet.getRow(rowNumber);
    row.getCell("A").value = index + 1;
    row.getCell("B").value = item.collaborator.name;
    row.getCell("C").value = item.collaborator.documentId;
    row.getCell("D").value = item.totalWorkedHours;
    row.getCell("E").value = item.ordinaryHours;
    row.getCell("F").value = item.overtimeHours;
    row.getCell("G").value = item.overtimeRate;
    row.getCell("H").value = {
      formula: `F${rowNumber}*G${rowNumber}`,
      result: item.totalPay,
    };
    row.getCell("I").value = "";
    styleDataRow(row);
    row.getCell("B").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    row.getCell("F").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.editable },
    };
    row.getCell("G").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.editable },
    };
    row.getCell("I").border = {
      left: { style: "thin", color: { argb: BRAND.border } },
      right: { style: "thin", color: { argb: BRAND.border } },
      bottom: { style: "medium", color: { argb: BRAND.dark } },
    };
  });

  const totalRowNumber = dataStartRow + summaryRows.length;
  const totalRow = worksheet.getRow(totalRowNumber);
  totalRow.getCell("A").value = "";
  totalRow.getCell("B").value = "TOTALES";
  totalRow.getCell("C").value = "";
  totalRow.getCell("D").value = { formula: `SUM(D${dataStartRow}:D${totalRowNumber - 1})` };
  totalRow.getCell("E").value = { formula: `SUM(E${dataStartRow}:E${totalRowNumber - 1})` };
  totalRow.getCell("F").value = { formula: `SUM(F${dataStartRow}:F${totalRowNumber - 1})` };
  totalRow.getCell("G").value = "";
  totalRow.getCell("H").value = { formula: `SUM(H${dataStartRow}:H${totalRowNumber - 1})` };
  totalRow.getCell("I").value = "";
  styleTotalsRow(totalRow);
  totalRow.getCell("B").alignment = { horizontal: "left", vertical: "middle" };

  styleHourColumn(worksheet, "D");
  styleHourColumn(worksheet, "E");
  styleHourColumn(worksheet, "F");
  styleCurrencyColumn(worksheet, "G");
  styleCurrencyColumn(worksheet, "H");
  worksheet.autoFilter = "A7:I7";
  worksheet.views = [{ state: "frozen", ySplit: 7, showGridLines: false }];

  worksheet.mergeCells(`A${totalRowNumber + 2}:I${totalRowNumber + 2}`);
  setCellText(
    worksheet.getCell(`A${totalRowNumber + 2}`),
    "Observacion: la columna 'Pago Horas Extras' usa formula editable dentro del Excel para permitir ajustes manuales."
  );
  styleMuted(worksheet.getCell(`A${totalRowNumber + 2}`));

  createDetailSheet(workbook, snapshot, logoId);

  return workbook;
}

function addSlipDetailTable(worksheet, startRow, collaboratorDays) {
  const headerRow = worksheet.getRow(startRow);
  headerRow.values = ["Fecha", "Dia", "Horario(s)", "Horas trabajadas"];
  styleTableHeader(headerRow);

  const rows = buildSlipRows(collaboratorDays);
  rows.forEach((item, index) => {
    const row = worksheet.getRow(startRow + 1 + index);
    row.values = [item.date, item.dayLabel, item.schedule, item.workedHours];
    styleDataRow(row);
    row.getCell(3).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  });

  return startRow + rows.length + 1;
}

function addSlipSummary(worksheet, snapshot, summaryRow, collaboratorDays) {
  worksheet.getCell("A7").value = "Colaborador";
  worksheet.getCell("B7").value = summaryRow.collaborator.name;
  worksheet.getCell("A8").value = "Cedula";
  worksheet.getCell("B8").value = summaryRow.collaborator.documentId;
  worksheet.getCell("A9").value = "Periodo";
  worksheet.getCell("B9").value = formatWeekRange(snapshot.weekStart, snapshot.weekEnd);

  ["A7", "A8", "A9", "E7", "E8", "E9", "E10", "E11"].forEach((cellRef) => {
    styleLabel(worksheet.getCell(cellRef));
  });

  worksheet.getCell("E7").value = "Total Horas Trabajadas Semana";
  worksheet.getCell("F7").value = { formula: `SUM(D15:D${14 + collaboratorDays.length})`, result: summaryRow.totalWorkedHours };
  worksheet.getCell("E8").value = "Horas Ordinarias";
  worksheet.getCell("F8").value = { formula: `MIN(F7,48)`, result: summaryRow.ordinaryHours };
  worksheet.getCell("E9").value = "Horas Extras";
  worksheet.getCell("F9").value = { formula: `MAX(0,F7-48)`, result: summaryRow.overtimeHours };
  worksheet.getCell("E10").value = "Valor Hora Extra";
  worksheet.getCell("F10").value = summaryRow.overtimeRate;
  worksheet.getCell("E11").value = "Pago Horas Extras";
  worksheet.getCell("F11").value = { formula: "F9*F10", result: summaryRow.totalPay };

  ["B7", "B8", "B9", "F7", "F8", "F9", "F10", "F11"].forEach((cellRef) => {
    const cell = worksheet.getCell(cellRef);
    cell.font = { name: "Aptos", size: 11, color: { argb: BRAND.dark } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: BRAND.border } },
    };
  });

  ["F7", "F8", "F9"].forEach((column) => {
    worksheet.getCell(column).numFmt = "0.0";
  });
  ["F10", "F11"].forEach((column) => {
    worksheet.getCell(column).numFmt = '"C$" #,##0.00';
  });
  worksheet.getCell("F10").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND.editable },
  };
}

function addSlipFooter(worksheet, startRow) {
  worksheet.mergeCells(`A${startRow}:C${startRow}`);
  worksheet.mergeCells(`E${startRow}:F${startRow}`);
  worksheet.getCell(`A${startRow}`).value = "Entregado por";
  worksheet.getCell(`E${startRow}`).value = "Recibido conforme";
  styleLabel(worksheet.getCell(`A${startRow}`));
  styleLabel(worksheet.getCell(`E${startRow}`));

  worksheet.mergeCells(`A${startRow + 2}:C${startRow + 2}`);
  worksheet.mergeCells(`E${startRow + 2}:F${startRow + 2}`);
  worksheet.getCell(`A${startRow + 2}`).border = {
    bottom: { style: "medium", color: { argb: BRAND.dark } },
  };
  worksheet.getCell(`E${startRow + 2}`).border = {
    bottom: { style: "medium", color: { argb: BRAND.dark } },
  };
}

function createSlipWorksheet(workbook, snapshot, summaryRow, collaboratorDays, logoId, sheetName) {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = [
    { key: "a", width: 16 },
    { key: "b", width: 28 },
    { key: "c", width: 26 },
    { key: "d", width: 16 },
    { key: "e", width: 20 },
    { key: "f", width: 16 },
  ];

  worksheet.views = [{ showGridLines: false }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };

  worksheet.mergeCells("B1:F1");
  worksheet.mergeCells("B2:F2");
  worksheet.mergeCells("B3:F3");
  worksheet.mergeCells("B4:F4");

  if (logoId != null) {
    worksheet.addImage(logoId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 84, height: 84 },
    });
  }

  setCellText(worksheet.getCell("B1"), BRAND.companyName);
  styleTitle(worksheet.getCell("B1"), 18);
  setCellText(worksheet.getCell("B2"), "Colilla de Pago de Horas Extras");
  worksheet.getCell("B2").font = {
    name: "Aptos Display",
    size: 14,
    bold: true,
    color: { argb: BRAND.accent },
  };
  setCellText(worksheet.getCell("B3"), "Documento de respaldo por colaborador");
  styleLabel(worksheet.getCell("B3"));
  setCellText(worksheet.getCell("B4"), formatWeekRange(snapshot.weekStart, snapshot.weekEnd));
  styleMuted(worksheet.getCell("B4"));

  addSlipSummary(worksheet, snapshot, summaryRow, collaboratorDays);
  const footerStartRow = addSlipDetailTable(worksheet, 15, collaboratorDays) + 3;
  addSlipFooter(worksheet, footerStartRow);

  styleHourColumn(worksheet, "D");
}

async function createSlipWorkbook(snapshot, employeeId, includeAllSheets = false) {
  const workbook = createWorkbook();
  const logoId = await loadWorkbookLogo(workbook);

  const summaryRows = includeAllSheets
    ? snapshot.summaryRows.filter((row) => row.recordCount > 0 || row.totalWorkedHours > 0)
    : snapshot.summaryRows.filter((row) => row.collaborator.id === employeeId);

  for (const summaryRow of summaryRows) {
    const collaboratorDays = snapshot.dailySummaries.filter(
      (day) => day.employeeId === summaryRow.collaborator.id
    );
    const sheetName = includeAllSheets
      ? summaryRow.collaborator.name.slice(0, 31)
      : "Colilla";
    createSlipWorksheet(
      workbook,
      snapshot,
      summaryRow,
      collaboratorDays,
      logoId,
      sheetName
    );
  }

  return workbook;
}

export async function exportConsolidatedWorkbook(snapshot) {
  const workbook = await createConsolidatedWorkbook(snapshot);
  await saveWorkbook(
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

export async function exportIndividualSlipWorkbook(snapshot, employeeId) {
  const summaryRow = snapshot.summaryRows.find(
    (row) => row.collaborator.id === employeeId
  );

  if (!summaryRow) {
    return;
  }

  const workbook = await createSlipWorkbook(snapshot, employeeId, false);
  const safeName = summaryRow.collaborator.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  await saveWorkbook(workbook, `colilla-${safeName}-${snapshot.weekStart}.xlsx`);
}

export async function exportAllSlipsWorkbook(snapshot) {
  const workbook = await createSlipWorkbook(snapshot, null, true);
  await saveWorkbook(
    workbook,
    `colillas-horas-extras-${snapshot.weekStart}-${getWeekEnd(snapshot.weekStart)}.xlsx`
  );
}

export function exportBankPaymentFile(snapshot, options) {
  const paymentDate = String(options?.paymentDate || "").trim();
  const shipmentInput = String(options?.shipmentNumber || "").trim();

  if (!paymentDate) {
    throw new Error("Indica la fecha de pago antes de descargar el archivo del banco.");
  }

  if (!/^\d{1,5}$/.test(shipmentInput)) {
    throw new Error("El numero de envio debe tener entre 1 y 5 digitos.");
  }

  const rows = buildBankPaymentRows(snapshot);
  if (rows.length === 0) {
    throw new Error("No hay pagos de horas extras para exportar al banco en esta semana.");
  }

  const shipmentPadded = shipmentInput.padStart(5, "0");
  const shipmentForFilename = String(Number(shipmentInput));
  const bankDate = formatBankDate(paymentDate);
  const detail = padRight(buildBankDetailDescription(snapshot), 31);
  const totalAmount = formatBankAmount(
    rows.reduce((sum, row) => sum + Number(row.totalPay || 0), 0)
  );

  const header = (
    `B${BANK_PAYROLL_PLAN_NUMBER}${shipmentPadded}` +
    " ".repeat(20) +
    "00000" +
    bankDate +
    totalAmount +
    String(rows.length).padStart(5, "0")
  ).padEnd(122, " ");

  const detailLines = rows.map((row, index) => {
    const documentId = padRight(
      normalizeDocumentId(row.collaborator.documentId),
      16
    );
    const sequence = String(index + 1).padStart(5, "0");
    const amount = formatBankAmount(row.totalPay);
    const name = padRight(row.collaborator.name.toUpperCase(), 30);

    return (
      `T${BANK_PAYROLL_PLAN_NUMBER}${shipmentPadded}` +
      documentId +
      " ".repeat(4) +
      sequence +
      bankDate +
      amount +
      " ".repeat(5) +
      detail +
      name
    ).padEnd(122, " ");
  });

  const content = [header, ...detailLines].join("\r\n");
  triggerTextDownload(
    content,
    `INP${BANK_PAYROLL_PLAN_NUMBER}${shipmentForFilename}.PRN`
  );
}
