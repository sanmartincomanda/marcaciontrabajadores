import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());

const {
  collaborators,
  collaboratorMap,
  getCollaboratorByClockCode,
  getCollaboratorByEmployeeId,
  isBankPayrollEligible,
  resolveCollaboratorId,
} = await server.ssrLoadModule("/src/data/collaborators.js");
const { buildPayrollSnapshot, buildDailyMarkingSnapshot, getBankPaymentRows } =
  await server.ssrLoadModule("/src/utils/payroll.js");
const {
  exportBankPaymentFile,
  exportConsolidatedWorkbook,
  exportAllSlipsWorkbook,
  exportIndividualSlipWorkbook,
} = await server.ssrLoadModule("/src/utils/exporters.js");

const settings = {
  weekStart: "2026-11-09",
  standardHoursPerWeek: 48,
  overtimeMultiplier: 2,
};
const bankOptions = { paymentDate: "2026-11-10", shipmentNumber: "71" };
const hectorId = "2012910950003L";
const carlosId = "2012110690003K";
const retiredIds = ["2011804011000S", "2012805910009E", "2011310930004N"];

function directHours(employeeId, hours = 16) {
  return {
    id: `direct-${employeeId}`,
    employeeId,
    date: settings.weekStart,
    source: "manual-overtime",
    manualOvertimeHours: hours,
  };
}

async function captureDownload(t, action) {
  let blob;
  const anchor = { click() {} };
  const logo = await readFile(new URL("../public/logo.png", import.meta.url));
  t.mock.method(globalThis, "fetch", async () => new Response(logo));
  globalThis.window = {
    location: { origin: "https://example.test" },
    URL: { createObjectURL(value) { blob = value; return "blob:test"; } },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    setTimeout() {},
  };
  globalThis.document = { createElement: () => anchor };
  try {
    await action();
    assert.ok(blob, "The export should trigger a download");
    return { blob, filename: anchor.download };
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("new Granada workers can clock using their cedula or last five characters", () => {
  for (const [documentId, name] of [
    ["201-120675-0006K", "Geesel Indira Granados Balmaceda"],
    ["201-050106-1001T", "Fabian Jose Noguera Garay"],
    ["201-291095-0003L", "HECTOR DANILO ESPINOZA TORRES"],
  ]) {
    const collaborator = getCollaboratorByClockCode(documentId);
    assert.equal(collaborator.name, name);
    assert.equal(collaborator.branch, "Granada");
    assert.equal(getCollaboratorByClockCode(documentId.slice(-5).toLowerCase()), collaborator);
  }
  assert.equal(collaborators.filter((worker) => worker.branch === "Nindiri").length, 2);
  assert.equal(collaborators.filter((worker) => worker.branch === "Masaya Gold").length, 5);
});

test("retired workers cannot clock and their historical cedulas remain resolvable", () => {
  for (const id of retiredIds) {
    assert.equal(collaborators.some((worker) => worker.id === id), false);
    assert.equal(getCollaboratorByClockCode(id), null);
    assert.equal(getCollaboratorByClockCode(id.slice(-5)), null);
    assert.equal(resolveCollaboratorId(id), id);
    assert.equal(getCollaboratorByEmployeeId(id).id, id);
    assert.equal(isBankPayrollEligible(collaboratorMap[id]), false);
  }
  assert.equal(getCollaboratorByEmployeeId("collaborator-5").id, retiredIds[0]);
  assert.equal(getCollaboratorByEmployeeId("collaborator-13").id, retiredIds[1]);
  assert.equal(getCollaboratorByEmployeeId("collaborator-11").id, retiredIds[2]);
  assert.equal(getCollaboratorByEmployeeId("collaborator-15").id, "2011309890003C");
  assert.equal(getCollaboratorByEmployeeId("collaborator-16").id, "2012909810002E");
  assert.equal(getCollaboratorByEmployeeId("collaborator-18").id, "2012909810002E");
  assert.equal(getCollaboratorByEmployeeId("collaborator-23").id, "2022906690002S");
  assert.equal(resolveCollaboratorId("collaborator-24"), "");
});

test("Hector retains daily and weekly hours with no payment, even if salary changes", () => {
  const workers = collaborators.map((worker) =>
    worker.id === hectorId ? { ...worker, salary: 15000 } : worker
  );
  const records = [hectorId, carlosId].flatMap((employeeId) =>
    Array.from({ length: 6 }, (_, day) => ({
      id: `${employeeId}-${day}`,
      employeeId,
      date: `2026-11-${String(9 + day).padStart(2, "0")}`,
      checkIn: "07:00",
      checkOut: day === 5 ? "17:00" : "16:00",
      source: "clock",
    }))
  );
  const snapshot = buildPayrollSnapshot(workers, records, settings);
  const hector = snapshot.summaryRows.find((row) => row.collaborator.id === hectorId);
  const carlos = snapshot.summaryRows.find((row) => row.collaborator.id === carlosId);
  assert.equal(hector.totalWorkedHours, 55);
  assert.equal(hector.ordinaryHours, 48);
  assert.equal(hector.overtimeHours, 7);
  assert.equal(hector.totalPay, 0);
  assert.equal(carlos.totalPay, 662.06);
  assert.equal(snapshot.totals.totalPay, carlos.totalPay);
  const daily = buildDailyMarkingSnapshot(workers, records, settings, "2026-11-14");
  assert.equal(daily.summaryRows.find((row) => row.employeeId === hectorId).totalWorkedHours, 10);
});

test("PRN excludes Hector and retired workers from detail, count and total", async (t) => {
  const snapshot = buildPayrollSnapshot(collaborators, [directHours(carlosId)], settings);
  // A stale or manually adjusted positive payment must not bypass exclusion.
  snapshot.summaryRows.push(
    { collaborator: collaboratorMap[hectorId], totalPay: 777 },
    { collaborator: collaboratorMap[retiredIds[0]], totalPay: 333 },
  );
  assert.equal(getBankPaymentRows(snapshot).length, 1);
  const { blob, filename } = await captureDownload(t, () => exportBankPaymentFile(snapshot, bankOptions));
  const content = await blob.text();
  const lines = content.split("\r\n");
  assert.equal(filename, "INPAAF671.PRN");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].slice(43, 56), "0000000151328");
  assert.equal(lines[0].slice(56, 61), "00001");
  assert.equal(lines[1].slice(10, 26).trim(), carlosId);
  assert.equal(lines[1].slice(43, 56), "0000000151328");
  assert.equal(content.includes(hectorId), false);
  assert.equal(content.includes(retiredIds[0]), false);
  assert.ok(lines.every((line) => line.length === 122));
  assert.throws(() => exportBankPaymentFile({ ...snapshot, summaryRows: [snapshot.summaryRows.at(-2)] }, bankOptions), /No hay pagos/);
});

test("a missing salary is identified before downloading a bank file", () => {
  const geesel = collaborators.find((worker) => worker.id === "2011206750006K");
  const snapshot = buildPayrollSnapshot(collaborators, [directHours(geesel.id), directHours(carlosId)], settings);
  assert.equal(geesel.salary, null);
  assert.throws(() => exportBankPaymentFile(snapshot, bankOptions), /Falta definir el salario de: Geesel/);
});

test("Excel keeps Hector's hours informative and omits his payment slip", async (t) => {
  const geeselId = "2011206750006K";
  const snapshot = buildPayrollSnapshot(collaborators, [directHours(hectorId), directHours(carlosId), directHours(geeselId)], settings);
  const consolidated = await captureDownload(t, () => exportConsolidatedWorkbook(snapshot, { branch: "Granada" }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await consolidated.blob.arrayBuffer());
  const sheet = workbook.getWorksheet("Consolidado");
  const rows = [];
  sheet.eachRow((row) => rows.push(row));
  const hector = rows.find((row) => row.getCell("C").value === "201-291095-0003L");
  assert.match(hector.getCell("B").value, /Solo control de horas/);
  assert.equal(hector.getCell("D").value, 16);
  assert.equal(hector.getCell("G").value, null);
  assert.equal(hector.getCell("H").value, null);
  const carlos = rows.find((row) => row.getCell("C").value === "201-211069-0003K");
  assert.equal(carlos.getCell("H").value.formula, `F${carlos.number}*G${carlos.number}`);
  const geesel = rows.find((row) => row.getCell("C").value === "201-120675-0006K");
  assert.match(geesel.getCell("B").value, /Salario pendiente/);
  assert.equal(geesel.getCell("G").value, null);
  assert.equal(geesel.getCell("H").value.formula, `IF(ISNUMBER(G${geesel.number}),F${geesel.number}*G${geesel.number},"")`);
  const slips = await captureDownload(t, () => exportAllSlipsWorkbook(snapshot, { branch: "Granada" }));
  const slipWorkbook = new ExcelJS.Workbook();
  await slipWorkbook.xlsx.load(await slips.blob.arrayBuffer());
  assert.equal(slipWorkbook.worksheets.length, 2);
  assert.ok(slipWorkbook.worksheets.some((sheet) => sheet.name.includes("CARLOS")));
  const pendingSlip = slipWorkbook.worksheets.find((sheet) => sheet.name.includes("Geesel"));
  assert.match(pendingSlip.getCell("B7").value, /Salario pendiente/);
  assert.equal(pendingSlip.getCell("F10").value, null);
  assert.equal(pendingSlip.getCell("F11").value.formula, 'IF(ISNUMBER(F10),F9*F10,"")');
  await assert.rejects(exportIndividualSlipWorkbook(snapshot, hectorId), /solo control de horas/);
});
