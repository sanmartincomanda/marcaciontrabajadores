import { useEffect, useEffectEvent, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import {
  collaborators,
  getCollaboratorByClockCode,
  normalizeDocumentId,
} from "./data/collaborators";
import {
  exportAllSlipsWorkbook,
  exportBankPaymentFile,
  exportConsolidatedWorkbook,
  exportDailyMarkingWorkbook,
  exportIndividualSlipWorkbook,
} from "./utils/exporters";
import {
  buildDailyMarkingSnapshot,
  buildPayrollSnapshot,
} from "./utils/payroll";
import {
  deleteRecordFromCloud,
  ensureCloudSession,
  getCloudSyncError,
  isCloudSyncEnabled,
  saveRecordToCloud,
  saveSettingsToCloud,
  subscribeToCloudData,
} from "./services/firebaseStore";
import {
  addDays,
  calculateWorkedHours,
  dayNames,
  formatCompactHours,
  formatCurrency,
  formatDateLabel,
  formatHours,
  getMonday,
  getWeekEnd,
  isDateInWeek,
  roundWorkedHours,
  toInputDate,
  toInputTime,
} from "./utils/time";

const WEEKLY_SHIFT_FIELDS = [
  {
    checkIn: "slot1CheckIn",
    checkOut: "slot1CheckOut",
    label: "Turno 1",
  },
  {
    checkIn: "slot2CheckIn",
    checkOut: "slot2CheckOut",
    label: "Turno 2",
  },
];

const tabs = [
  { id: "marcacion", label: "Terminal de marcacion" },
  { id: "resumen", label: "Resumen semanal" },
  { id: "manual", label: "Ingreso manual" },
  { id: "reportes", label: "Reportes y descargas" },
];

const APP_USERS = {
  admin: {
    username: "admin",
    password: "159sanmartin",
    label: "Administrador",
    subtitle: "Acceso completo a reportes, ajustes y terminal.",
    allowedTabs: tabs.map((tab) => tab.id),
  },
  marcar: {
    username: "marcar",
    password: "marcar",
    label: "Terminal de marcacion",
    subtitle: "Acceso exclusivo para entrada y salida por cedula o ultimos 5.",
    allowedTabs: ["marcacion"],
  },
};

function buildDefaultSettings(date = new Date()) {
  return {
    weekStart: getMonday(date),
    standardHoursPerWeek: 48,
    overtimeMultiplier: 2,
  };
}

function roundHours(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getWeeklyCellKey(employeeId, date) {
  return `${employeeId}__${date}`;
}

function buildWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function formatDayHeader(dayName) {
  return dayName.charAt(0).toUpperCase() + dayName.slice(1);
}

function formatCompactDayMonth(value) {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) {
    return "";
  }

  return `${day}${month}`;
}

function buildWeeklyRecordMap(records, weekStart) {
  const weekMap = {};

  for (const record of records) {
    if (!isDateInWeek(record.date, weekStart)) {
      continue;
    }

    const key = getWeeklyCellKey(record.employeeId, record.date);
    const current = weekMap[key] ?? [];
    current.push(record);
    current.sort((left, right) => {
      const leftTime = `${left.checkIn || ""}${left.createdAt || ""}`;
      const rightTime = `${right.checkIn || ""}${right.createdAt || ""}`;
      return leftTime.localeCompare(rightTime);
    });
    weekMap[key] = current;
  }

  return weekMap;
}

function createWeeklyDayDraft(records = []) {
  const [firstRecord, secondRecord] = records;
  return {
    slot1CheckIn: firstRecord?.checkIn || "",
    slot1CheckOut: firstRecord?.checkOut || "",
    slot2CheckIn: secondRecord?.checkIn || "",
    slot2CheckOut: secondRecord?.checkOut || "",
  };
}

function calculateGapHours(date, startTime, endTime) {
  if (!date || !startTime || !endTime) {
    return 0;
  }

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  return roundHours((end.getTime() - start.getTime()) / 36e5);
}

function buildWeeklyDayStats(date, draft, accumulatedBefore, weeklyLimit) {
  const firstShiftHours = calculateWorkedHours({
    date,
    checkIn: draft.slot1CheckIn,
    checkOut: draft.slot1CheckOut,
    breakMinutes: 0,
  });
  const secondShiftHours = calculateWorkedHours({
    date,
    checkIn: draft.slot2CheckIn,
    checkOut: draft.slot2CheckOut,
    breakMinutes: 0,
  });
  const lunchHours = calculateGapHours(
    date,
    draft.slot1CheckOut,
    draft.slot2CheckIn
  );
  const workedHours = roundHours(
    roundWorkedHours(firstShiftHours + secondShiftHours)
  );
  const accumulatedWorkedHours = roundHours(accumulatedBefore + workedHours);
  const previousAccumulatedOvertime = Math.max(accumulatedBefore - weeklyLimit, 0);
  const accumulatedOvertimeHours = Math.max(
    accumulatedWorkedHours - weeklyLimit,
    0
  );
  const overtimeHours = roundHours(
    accumulatedOvertimeHours - previousAccumulatedOvertime
  );

  return {
    workedHours,
    lunchHours,
    accumulatedWorkedHours,
    overtimeHours,
    accumulatedOvertimeHours: roundHours(accumulatedOvertimeHours),
  };
}

function validateWeeklyDayDraft(draft) {
  if (draft.slot1CheckOut && !draft.slot1CheckIn) {
    return "La salida 1 necesita una entrada 1.";
  }

  if (draft.slot2CheckIn && (!draft.slot1CheckIn || !draft.slot1CheckOut)) {
    return "Completa el primer turno antes de registrar el segundo.";
  }

  if (draft.slot2CheckOut && !draft.slot2CheckIn) {
    return "La salida 2 necesita una entrada 2.";
  }

  if (
    draft.slot1CheckOut &&
    draft.slot2CheckIn &&
    calculateGapHours("2000-01-01", draft.slot1CheckOut, draft.slot2CheckIn) === 0
  ) {
    return "La segunda entrada debe ser despues de la primera salida.";
  }

  return "";
}

function buildOpenRecordMap(records, targetDate) {
  return records.reduce((collection, record) => {
    if (record.checkOut || (targetDate && record.date !== targetDate)) {
      return collection;
    }

    const current = collection[record.employeeId];
    const currentTime = current
      ? new Date(`${current.date}T${current.checkIn || "00:00"}:00`).getTime()
      : -Infinity;
    const nextTime = new Date(
      `${record.date}T${record.checkIn || "00:00"}:00`
    ).getTime();

    if (!current || nextTime >= currentTime) {
      collection[record.employeeId] = record;
    }

    return collection;
  }, {});
}

function getInitialTab() {
  const availableTabs = new Set(tabs.map((tab) => tab.id));
  const hash = window.location.hash.replace("#", "").trim().toLowerCase();
  return availableTabs.has(hash) ? hash : "marcacion";
}

function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getAllowedTabs(username) {
  const account = APP_USERS[normalizeUsername(username)];
  return tabs.filter((tab) => account?.allowedTabs.includes(tab.id));
}

function resolveAccessibleTab(tabId, username) {
  const allowedTabs = getAllowedTabs(username);
  return allowedTabs.some((tab) => tab.id === tabId)
    ? tabId
    : (allowedTabs[0]?.id ?? "marcacion");
}

function createManualForm(weekStart, employeeId = collaborators[0]?.id ?? "") {
  return {
    employeeId,
    date: weekStart,
    checkIn: "",
    checkOut: "",
    breakMinutes: "0",
    source: "manual",
  };
}

function StatCard({ label, value, caption }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-caption">{caption}</span>
    </article>
  );
}

function describeCameraError(error) {
  const name = error?.name ?? "";
  if (name === "NotAllowedError") {
    return "La cámara fue bloqueada. Permite el acceso a la cámara en la tablet o navegador.";
  }

  if (name === "NotFoundError") {
    return "No encontré una cámara disponible en este dispositivo.";
  }

  if (name === "NotReadableError") {
    return "La cámara ya está siendo usada por otra aplicación o pestaña.";
  }

  return "No pude iniciar la cámara. Revisa permisos o vuelve a intentarlo.";
}

function describeCloudSyncError(error) {
  const code = String(error?.code || "");

  if (code === "auth/configuration-not-found") {
    return "En Firebase Console debes activar Authentication y habilitar el metodo Anonymous para esta app.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Activa el acceso anonimo en Firebase Authentication para conectar la app.";
  }

  if (code === "permission-denied") {
    return "Firebase rechazo el acceso. Revisa las reglas de Firestore.";
  }

  if (code === "unavailable") {
    return "No pude conectar con Firebase en este momento. Revisa la red.";
  }

  if (code === "unauthenticated") {
    return "La sesion con Firebase no esta autorizada. Vuelve a cargar la app.";
  }

  return error?.message || "No pude sincronizar la informacion con Firebase.";
}

async function optimizeCameraTrackForSmallBarcode(videoElement) {
  const stream = videoElement?.srcObject;
  const track = stream?.getVideoTracks?.()?.[0];

  if (!track || typeof track.getCapabilities !== "function") {
    return false;
  }

  const capabilities = track.getCapabilities();
  const advanced = [];

  if (
    Array.isArray(capabilities.focusMode) &&
    capabilities.focusMode.includes("continuous")
  ) {
    advanced.push({ focusMode: "continuous" });
  }

  if (capabilities.zoom) {
    const targetZoom = Math.min(
      capabilities.zoom.max,
      Math.max(capabilities.zoom.min, 2)
    );

    if (Number.isFinite(targetZoom)) {
      advanced.push({ zoom: targetZoom });
    }
  }

  if (advanced.length === 0) {
    return false;
  }

  await track.applyConstraints({ advanced });
  return true;
}

function App() {
  const [defaultSettings] = useState(() => buildDefaultSettings());
  const [selectedTab, setSelectedTab] = useState(getInitialTab);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({
    username: "",
    password: "",
  });
  const [authError, setAuthError] = useState("");
  const [settings, setSettings] = useState(defaultSettings);
  const [records, setRecords] = useState([]);
  const [manualForm, setManualForm] = useState(() =>
    createManualForm(defaultSettings.weekStart)
  );
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [selectedSlipEmployeeId, setSelectedSlipEmployeeId] = useState(
    collaborators[0]?.id ?? ""
  );
  const [selectedReportDate, setSelectedReportDate] = useState(() =>
    toInputDate(new Date())
  );
  const [bankPaymentForm, setBankPaymentForm] = useState(() => ({
    paymentDate: toInputDate(new Date()),
    shipmentNumber: "",
  }));
  const [selectedReportEmployeeId, setSelectedReportEmployeeId] = useState("all");
  const [weeklyManualDraft, setWeeklyManualDraft] = useState({});
  const [selectedWeeklyInfo, setSelectedWeeklyInfo] = useState(null);
  const [notice, setNotice] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState(
    "Usa la cámara de la tablet para leer el código de barras de la cédula."
  );
  const [cameraError, setCameraError] = useState("");
  const [syncState, setSyncState] = useState(() => ({
    loading: isCloudSyncEnabled(),
    ready: false,
    error: isCloudSyncEnabled() ? "" : getCloudSyncError(),
  }));
  const [now, setNow] = useState(() => Date.now());
  const scanInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraReaderRef = useRef(null);
  const cameraControlsRef = useRef(null);
  const cameraLockRef = useRef(false);
  const activeUser = currentUser ? APP_USERS[currentUser.username] : null;
  const availableTabs = currentUser ? getAllowedTabs(currentUser.username) : [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handleHashChange = () => {
      const nextTab = getInitialTab();
      const safeTab = currentUser
        ? resolveAccessibleTab(nextTab, currentUser.username)
        : nextTab;
      setSelectedTab(safeTab);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [currentUser]);

  useEffect(() => {
    const nextHash = `#${selectedTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab !== "marcacion" || isCameraOpen) {
      return undefined;
    }

    const timer = window.setTimeout(() => scanInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [selectedTab, scanResult, isCameraOpen]);

  useEffect(() => {
    if (!isCloudSyncEnabled()) {
      return undefined;
    }

    let isCancelled = false;
    let hasLoadedSettings = false;
    let hasLoadedRecords = false;
    let unsubscribe = () => {};

    const markSyncReady = () => {
      if (hasLoadedSettings && hasLoadedRecords && !isCancelled) {
        setSyncState({
          loading: false,
          ready: true,
          error: "",
        });
      }
    };

    ensureCloudSession()
      .then(() => {
        if (isCancelled) {
          return;
        }

        unsubscribe = subscribeToCloudData({
          defaultSettings,
          onSettings: (nextSettings) => {
            hasLoadedSettings = true;
            setSettings(nextSettings);
            setManualForm((current) =>
              !current.date || !isDateInWeek(current.date, nextSettings.weekStart)
                ? { ...current, date: nextSettings.weekStart }
                : current
            );
            markSyncReady();
          },
          onRecords: (nextRecords) => {
            hasLoadedRecords = true;
            setRecords(nextRecords);
            markSyncReady();
          },
          onError: (error) => {
            if (isCancelled) {
              return;
            }

            setSyncState({
              loading: false,
              ready: false,
              error: describeCloudSyncError(error),
            });
          },
        });
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setSyncState({
          loading: false,
          ready: false,
          error: describeCloudSyncError(error),
        });
      });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [defaultSettings]);

  const payroll = buildPayrollSnapshot(collaborators, records, settings);
  const currentWeekEnd = getWeekEnd(settings.weekStart);
  const dailyMarkingSnapshot = buildDailyMarkingSnapshot(
    collaborators,
    records,
    settings,
    selectedReportDate
  );
  const weekDates = buildWeekDates(settings.weekStart);
  const weeklyRecordsByCell = buildWeeklyRecordMap(records, settings.weekStart);
  const weeklyHoursLimit = Number(
    settings.standardHoursPerWeek ?? payroll.totals.weeklyHoursLimit ?? 48
  );
  const weeklyMatrixRows = collaborators.map((collaborator) => {
    let accumulatedWorkedHours = 0;

    return {
      collaborator,
      days: weekDates.map((date, index) => {
        const key = getWeeklyCellKey(collaborator.id, date);
        const existingRecords = weeklyRecordsByCell[key] || [];
        const draft =
          weeklyManualDraft[key] ?? createWeeklyDayDraft(existingRecords.slice(0, 2));
        const stats = buildWeeklyDayStats(
          date,
          draft,
          accumulatedWorkedHours,
          weeklyHoursLimit
        );

        accumulatedWorkedHours = stats.accumulatedWorkedHours;

        return {
          key,
          date,
          dayName: dayNames[index],
          draft,
          stats,
          visibleRecords: existingRecords.slice(0, 2),
          hiddenRecordCount: Math.max(existingRecords.length - 2, 0),
        };
      }),
    };
  });
  const selectedReportCollaborator =
    selectedReportEmployeeId === "all"
      ? null
      : collaborators.find(
          (collaborator) => collaborator.id === selectedReportEmployeeId
        ) ?? null;
  const filteredDailySummaryRows = dailyMarkingSnapshot.summaryRows.filter((row) =>
    selectedReportEmployeeId === "all" || row.employeeId === selectedReportEmployeeId
  );
  const filteredDailyRecords = dailyMarkingSnapshot.processedRecords.filter(
    (record) =>
      selectedReportEmployeeId === "all" ||
      record.employeeId === selectedReportEmployeeId
  );
  const dailyReportSnapshot = {
    ...dailyMarkingSnapshot,
    summaryRows: filteredDailySummaryRows,
    processedRecords: filteredDailyRecords,
    totals: {
      employeeCount: filteredDailySummaryRows.length,
      recordCount: filteredDailyRecords.length,
      openCount: filteredDailyRecords.filter((record) => !record.checkOut).length,
      completedCount: filteredDailyRecords.filter((record) => record.checkOut)
        .length,
      workedHours: filteredDailySummaryRows.reduce(
        (total, row) => total + row.totalWorkedHours,
        0
      ),
      ordinaryHours: filteredDailySummaryRows.reduce(
        (total, row) => total + row.weeklyOrdinaryHours,
        0
      ),
      overtimeHours: filteredDailySummaryRows.reduce(
        (total, row) => total + row.weeklyOvertimeHours,
        0
      ),
      totalPay: filteredDailySummaryRows.reduce(
        (total, row) => total + row.weeklyOvertimePay,
        0
      ),
    },
  };
  const visibleSummaryRows = payroll.summaryRows.filter(
    (row) => row.recordCount > 0 || row.overtimeHours > 0
  );
  const currentClockDate = toInputDate(now);
  const activeRecords = buildOpenRecordMap(records, currentClockDate);
  const topWorkers = [...payroll.summaryRows]
    .sort((left, right) => right.totalPay - left.totalPay)
    .slice(0, 5);
  const selectedSlipSummary =
    payroll.summaryRows.find(
      (row) => row.collaborator.id === selectedSlipEmployeeId
    ) ?? payroll.summaryRows[0];
  const selectedSlipDays = payroll.dailySummaries.filter(
    (day) => day.employeeId === selectedSlipSummary?.collaborator.id
  );
  const bankPaymentRows = payroll.summaryRows.filter(
    (row) => Number(row.totalPay || 0) > 0
  );
  const bankPaymentDetail = `Horas extras ${formatCompactDayMonth(
    payroll.weekStart
  )} al ${formatCompactDayMonth(payroll.weekEnd)}`;
  const bankPaymentTotal = bankPaymentRows.reduce(
    (total, row) => total + Number(row.totalPay || 0),
    0
  );
  const selectedWeeklyInfoEntry = selectedWeeklyInfo
    ? weeklyMatrixRows
        .find((row) => row.collaborator.id === selectedWeeklyInfo.employeeId)
        ?.days.find((day) => day.date === selectedWeeklyInfo.date) ?? null
    : null;
  const clockTime = new Date(now).toLocaleTimeString("es-NI", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const isMarkingMode = selectedTab === "marcacion";
  const canSyncData = syncState.ready && !syncState.error;

  function showNotice(type, text) {
    setNotice({ id: crypto.randomUUID(), type, text });
  }

  function handleTabChange(tabId) {
    if (
      currentUser &&
      !availableTabs.some((tab) => tab.id === tabId)
    ) {
      return;
    }

    if (tabId !== "marcacion") {
      cameraControlsRef.current?.stop?.();
      cameraControlsRef.current = null;
      cameraLockRef.current = false;
      setIsCameraOpen(false);
      setCameraError("");
      setCameraStatus(
        "Usa la cámara de la tablet para leer el código de barras de la cédula."
      );
    }
    setSelectedTab(tabId);
  }

  async function handleWeekStartChange(nextWeekStart) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    const previousSettings = settings;
    const nextSettings = {
      ...settings,
      weekStart: nextWeekStart,
    };

    setSettings(nextSettings);
    setWeeklyManualDraft({});
    setSelectedWeeklyInfo(null);
    setManualForm((current) =>
      !current.date || !isDateInWeek(current.date, nextWeekStart)
        ? { ...current, date: nextWeekStart }
        : current
    );

    try {
      await saveSettingsToCloud(nextSettings);
    } catch (error) {
      setSettings(previousSettings);
      showNotice("error", describeCloudSyncError(error));
    }
  }

  function handleWeeklyDraftChange(employeeId, date, field, value) {
    const key = getWeeklyCellKey(employeeId, date);

    setWeeklyManualDraft((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? createWeeklyDayDraft(weeklyRecordsByCell[key] || [])),
        [field]: value,
      },
    }));
  }

  async function handleSaveWeeklyDay(employeeId, date) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    const key = getWeeklyCellKey(employeeId, date);
    const existingRecords = (weeklyRecordsByCell[key] || []).slice(0, 2);
    const draft =
      weeklyManualDraft[key] ?? createWeeklyDayDraft(existingRecords);
    const validationError = validateWeeklyDayDraft(draft);

    if (validationError) {
      showNotice("error", validationError);
      return;
    }

    const timestamp = new Date().toISOString();

    try {
      for (const [index, shiftField] of WEEKLY_SHIFT_FIELDS.entries()) {
        const currentRecord = existingRecords[index];
        const checkIn = draft[shiftField.checkIn];
        const checkOut = draft[shiftField.checkOut];

        if (!checkIn && !checkOut) {
          if (currentRecord) {
            await deleteRecordFromCloud(currentRecord.id);
          }
          continue;
        }

        await saveRecordToCloud({
          id: currentRecord?.id ?? crypto.randomUUID(),
          employeeId,
          date,
          checkIn,
          checkOut,
          breakMinutes: 0,
          source: currentRecord?.source ?? "manual",
          createdAt: currentRecord?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
      }
    } catch (error) {
      showNotice("error", describeCloudSyncError(error));
      return;
    }

    const collaboratorName =
      collaborators.find((collaborator) => collaborator.id === employeeId)?.name ??
      "Colaborador";
    showNotice(
      "success",
      `${collaboratorName}: registro guardado para ${formatDateLabel(date)}.`
    );
  }

  async function handleStandardHoursChange(rawValue) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    const previousSettings = settings;
    const nextSettings = {
      ...settings,
      standardHoursPerWeek: Number(rawValue || 0),
    };

    setSettings(nextSettings);

    try {
      await saveSettingsToCloud(nextSettings);
    } catch (error) {
      setSettings(previousSettings);
      showNotice("error", describeCloudSyncError(error));
    }
  }

  async function handleOvertimeMultiplierChange(rawValue) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    const previousSettings = settings;
    const nextSettings = {
      ...settings,
      overtimeMultiplier: Number(rawValue || 0),
    };

    setSettings(nextSettings);

    try {
      await saveSettingsToCloud(nextSettings);
    } catch (error) {
      setSettings(previousSettings);
      showNotice("error", describeCloudSyncError(error));
    }
  }

  function resetManualForm() {
    setEditingRecordId(null);
    setManualForm(createManualForm(settings.weekStart, manualForm.employeeId));
  }

  async function handleManualSubmit(event) {
    event.preventDefault();

    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    if (!manualForm.employeeId || !manualForm.date || !manualForm.checkIn) {
      showNotice(
        "error",
        "Completa colaborador, fecha y hora de entrada para guardar el registro."
      );
      return;
    }

    const timestamp = new Date().toISOString();
    const existingRecord = editingRecordId
      ? records.find((record) => record.id === editingRecordId)
      : null;
    const payload = {
      id: editingRecordId ?? crypto.randomUUID(),
      employeeId: manualForm.employeeId,
      date: manualForm.date,
      checkIn: manualForm.checkIn,
      checkOut: manualForm.checkOut,
      breakMinutes: Number(manualForm.breakMinutes || 0),
      source: manualForm.source,
      updatedAt: timestamp,
      createdAt: existingRecord?.createdAt || timestamp,
    };

    try {
      await saveRecordToCloud(payload);
    } catch (error) {
      showNotice("error", describeCloudSyncError(error));
      return;
    }

    showNotice(
      "success",
      editingRecordId
        ? "Registro actualizado correctamente."
        : "Registro manual guardado."
    );
    setEditingRecordId(null);
    setManualForm(createManualForm(settings.weekStart, manualForm.employeeId));
  }

  function handleEditRecord(record) {
    setEditingRecordId(record.id);
    setSelectedTab("manual");
    setManualForm({
      employeeId: record.employeeId,
      date: record.date,
      checkIn: record.checkIn || "",
      checkOut: record.checkOut || "",
      breakMinutes: String(record.breakMinutes || 0),
      source: record.source || "manual",
    });
  }

  async function handleDeleteRecord(recordId) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    try {
      await deleteRecordFromCloud(recordId);
    } catch (error) {
      showNotice("error", describeCloudSyncError(error));
      return;
    }

    if (editingRecordId === recordId) {
      resetManualForm();
    }
    showNotice("success", "Registro eliminado.");
  }

  async function processClockScan(rawValue) {
    if (!canSyncData) {
      setScanResult({
        type: "error",
        title: "Firebase no disponible",
        detail: syncState.error || "Firebase aun no esta listo.",
      });
      return false;
    }

    const normalizedDocument = normalizeDocumentId(rawValue);
    if (!normalizedDocument) {
      setScanResult({
        type: "error",
        title: "Escaneo vacio",
        detail:
          "Escanea la cedula o escribe la cedula completa o sus ultimos 5 caracteres.",
      });
      setScanValue("");
      return false;
    }

    const collaborator = getCollaboratorByClockCode(normalizedDocument);
    if (!collaborator) {
      setScanResult({
        type: "error",
        title: "Cedula no encontrada",
        detail: `La cedula o terminacion ${String(rawValue).trim()} no esta registrada en el sistema.`,
      });
      setScanValue("");
      return false;
    }

    const timestamp = new Date();
    const nextDate = toInputDate(timestamp);
    const nextTime = toInputTime(timestamp);
    const activeRecord = buildOpenRecordMap(records, nextDate)[collaborator.id];
    const movement = activeRecord ? "Salida" : "Entrada";

    try {
      if (activeRecord) {
        await saveRecordToCloud({
          ...activeRecord,
          checkOut: nextTime,
          updatedAt: timestamp.toISOString(),
        });
      } else {
        await saveRecordToCloud({
          id: crypto.randomUUID(),
          employeeId: collaborator.id,
          date: nextDate,
          checkIn: nextTime,
          checkOut: "",
          breakMinutes: 0,
          source: "clock",
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
        });
      }
    } catch (error) {
      setScanResult({
        type: "error",
        title: "No pude guardar la marcacion",
        detail: describeCloudSyncError(error),
      });
      setScanValue("");
      return false;
    }

    setScanResult({
      type: "success",
      title: `${movement} registrada`,
      detail: `${collaborator.name} - ${collaborator.documentId}`,
      movement,
      timeLabel: nextTime,
      dateLabel: formatDateLabel(nextDate),
    });
    setScanValue("");
    window.navigator.vibrate?.(90);
    return true;
  }

  const handleDetectedBarcode = useEffectEvent(async (barcodeText) => {
    if (cameraLockRef.current) {
      return;
    }

    cameraLockRef.current = true;
    setCameraStatus("Código detectado. Registrando marcación...");
    const didProcess = await processClockScan(barcodeText);

    if (didProcess) {
      cameraControlsRef.current?.stop?.();
      cameraControlsRef.current = null;
      setIsCameraOpen(false);
      setCameraError("");
      setCameraStatus(
        "Cámara lista. Puedes volver a abrirla para la siguiente cédula."
      );
      return;
    }

    cameraLockRef.current = false;
  });

  useEffect(() => {
    if (!isMarkingMode || !isCameraOpen || !cameraVideoRef.current) {
      return undefined;
    }

    let isCancelled = false;

    const startCameraScanner = async () => {
      if (!window.navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Este navegador no soporta acceso a cámara. Usa Chrome, Edge o Safari moderno."
        );
        setCameraStatus("La cámara no está disponible en este navegador.");
        return;
      }

      try {
        setCameraError("");
        setCameraStatus("Solicitando cámara trasera...");

        if (!cameraReaderRef.current) {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.CODABAR,
            BarcodeFormat.ITF,
            BarcodeFormat.PDF_417,
          ]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          cameraReaderRef.current = new BrowserMultiFormatReader(hints, {
            delayBetweenScanAttempts: 120,
            delayBetweenScanSuccess: 900,
          });
        }

        const controls = await cameraReaderRef.current.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              aspectRatio: { ideal: 1.7777777778 },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              resizeMode: { ideal: "crop-and-scale" },
            },
          },
          cameraVideoRef.current,
          (result, error) => {
            if (result) {
              handleDetectedBarcode(result.getText());
              return;
            }

            if (
              error &&
              !(error instanceof NotFoundException) &&
              error?.name !== "NotFoundException"
            ) {
              setCameraStatus("Cámara activa. Alinea mejor el código de barras.");
            }
          }
        );

        if (isCancelled) {
          controls.stop();
          return;
        }

        cameraControlsRef.current = controls;
        cameraLockRef.current = false;
        setCameraStatus(
          "Cámara activa. Apunta al código de barras de la cédula."
        );

        let didOptimizeForSmallBarcode = false;

        try {
          didOptimizeForSmallBarcode = await optimizeCameraTrackForSmallBarcode(
            cameraVideoRef.current
          );
        } catch {
          didOptimizeForSmallBarcode = false;
        }

        setCameraStatus(
          didOptimizeForSmallBarcode
            ? "Camara activa. Pon el codigo horizontal dentro de la franja."
            : "Camara activa. Acerca la cedula y centra el codigo en la franja."
        );
      } catch (error) {
        setCameraError(describeCameraError(error));
        setCameraStatus("No pude activar la cámara.");
      }
    };

    startCameraScanner();

    return () => {
      isCancelled = true;
      cameraControlsRef.current?.stop?.();
      cameraControlsRef.current = null;
      cameraLockRef.current = false;
    };
  }, [isCameraOpen, isMarkingMode]);

  async function handleClockScan(event) {
    event.preventDefault();
    await processClockScan(scanValue);
  }

  function handleCameraToggle() {
    if (isCameraOpen) {
      cameraControlsRef.current?.stop?.();
      cameraControlsRef.current = null;
      cameraLockRef.current = false;
      setIsCameraOpen(false);
      setCameraError("");
      setCameraStatus(
        "Cámara lista. Puedes volver a abrirla cuando necesites escanear otra cédula."
      );
      return;
    }

    setCameraError("");
    setCameraStatus("Preparando cámara...");
    setIsCameraOpen(true);
  }

  function handleLoginSubmit(event) {
    event.preventDefault();

    const username = normalizeUsername(loginForm.username);
    const account = APP_USERS[username];

    if (!account || loginForm.password !== account.password) {
      setAuthError("Usuario o contraseña incorrectos.");
      return;
    }

    setCurrentUser({ username: account.username });
    setAuthError("");
    setNotice(null);
    setScanResult(null);
    setSelectedTab(resolveAccessibleTab(getInitialTab(), account.username));
    setLoginForm({
      username: account.username,
      password: "",
    });
  }

  function handleLogout() {
    cameraControlsRef.current?.stop?.();
    cameraControlsRef.current = null;
    cameraLockRef.current = false;
    setIsCameraOpen(false);
    setCameraError("");
    setCameraStatus(
      "Usa la cámara de la tablet para leer el código de barras de la cédula."
    );
    setCurrentUser(null);
    setSelectedTab("marcacion");
    setNotice(null);
    setAuthError("");
    setScanValue("");
    setScanResult(null);
    setLoginForm({
      username: "",
      password: "",
    });
  }

  async function exportConsolidated() {
    try {
      await exportConsolidatedWorkbook(payroll);
      showNotice("success", "Consolidado exportado a Excel.");
    } catch (error) {
      showNotice("error", error?.message || "No pude exportar el consolidado.");
    }
  }

  function exportDailyReport() {
    exportDailyMarkingWorkbook(dailyReportSnapshot);
    showNotice("success", "Reporte diario de marcaciones exportado.");
  }

  async function exportSlip() {
    if (!selectedSlipSummary) {
      showNotice("error", "Selecciona un colaborador para generar la colilla.");
      return;
    }

    try {
      await exportIndividualSlipWorkbook(
        payroll,
        selectedSlipSummary.collaborator.id
      );
      showNotice("success", "Colilla individual exportada.");
    } catch (error) {
      showNotice("error", error?.message || "No pude exportar la colilla.");
    }
  }

  async function exportSlipPack() {
    try {
      await exportAllSlipsWorkbook(payroll);
      showNotice("success", "Paquete completo de colillas exportado.");
    } catch (error) {
      showNotice(
        "error",
        error?.message || "No pude exportar el paquete de colillas."
      );
    }
  }

  function exportBankFile() {
    try {
      exportBankPaymentFile(payroll, bankPaymentForm);
      showNotice("success", "Archivo del banco exportado.");
    } catch (error) {
      showNotice(
        "error",
        error?.message || "No pude exportar el archivo de pago del banco."
      );
    }
  }

  if (!currentUser || !activeUser) {
    return (
      <div className="auth-shell">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <section className="auth-card">
          <span className="eyebrow">CARNES SAN MARTIN GRANADA</span>
          <h1>Ingresa al sistema de marcacion y horas extras</h1>
          <p>
            Admin entra a toda la aplicacion. Marcar solo puede usar la
            terminal de marcacion para entrada y salida.
          </p>

          <div className="auth-user-grid">
            {Object.values(APP_USERS).map((account) => (
              <button
                key={account.username}
                type="button"
                className={
                  normalizeUsername(loginForm.username) === account.username
                    ? "auth-user-card active"
                    : "auth-user-card"
                }
                onClick={() => {
                  setAuthError("");
                  setLoginForm((current) => ({
                    ...current,
                    username: account.username,
                  }));
                }}
              >
                <strong>{account.username}</strong>
                <span>{account.label}</span>
                <small>{account.subtitle}</small>
              </button>
            ))}
          </div>

          <form className="login-form" onSubmit={handleLoginSubmit}>
            <label>
              Usuario
              <input
                type="text"
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) => {
                  setAuthError("");
                  setLoginForm((current) => ({
                    ...current,
                    username: event.target.value,
                  }));
                }}
              />
            </label>

            <label>
              Contraseña
              <input
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) => {
                  setAuthError("");
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }));
                }}
              />
            </label>

            {authError ? (
              <div className="notice notice-error auth-notice">{authError}</div>
            ) : null}

            {syncState.loading ? (
              <div className="notice auth-notice">
                Conectando la app con Firebase...
              </div>
            ) : null}

            {syncState.error ? (
              <div className="notice notice-error auth-notice">
                {syncState.error}
              </div>
            ) : null}

            <button type="submit" className="primary-button">
              Entrar
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className={isMarkingMode ? "app-shell marking-mode" : "app-shell"}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {!isMarkingMode ? (
        <>
          <header className="hero-panel">
            <div className="hero-copy">
              <span className="eyebrow">CARNES SAN MARTIN GRANADA</span>
              <h1>Control semanal de horas extras listo para Netlify</h1>
              <p>
                Registra entradas y salidas, marca asistencia por trabajador y
                descarga el consolidado semanal con colillas individuales sin volver
                a pelear con el Excel.
              </p>

              <div className="hero-tags">
                <span>Base de calculo cargada</span>
                <span>Marcacion por cedula o ultimos 5</span>
                <span>Exportacion a Excel</span>
              </div>
            </div>

            <aside className="hero-summary">
              <div className="week-card">
                <span className="week-card-label">Semana activa</span>
                <strong>
                  {formatDateLabel(settings.weekStart)} al{" "}
                  {formatDateLabel(currentWeekEnd)}
                </strong>
                <span>
                  {payroll.processedRecords.length} registro(s) cargado(s) esta
                  semana
                </span>
              </div>

              <div className="hero-grid">
                <StatCard
                  label="Horas extra"
                  value={formatHours(payroll.totals.overtimeHours)}
                  caption="Calculadas segun el acumulado semanal configurado"
                />
                <StatCard
                  label="Pago estimado"
                  value={formatCurrency(payroll.totals.totalPay)}
                  caption="Con tarifa de hora extra aplicada automaticamente"
                />
                <StatCard
                  label="Trabajadores con extra"
                  value={String(payroll.workersWithOvertime)}
                  caption="Solo quienes superaron la jornada ordinaria semanal"
                />
                <StatCard
                  label="Marcaciones abiertas"
                  value={String(Object.keys(activeRecords).length)}
                  caption="Entradas pendientes de salida solo de hoy"
                />
              </div>
            </aside>
          </header>

          <section className="control-strip">
            <div className="control-card">
              <label>
                Semana inicia
                <input
                  type="date"
                  value={settings.weekStart}
                  disabled={!canSyncData}
                  onChange={(event) => handleWeekStartChange(event.target.value)}
                />
              </label>

              <label>
                Jornada ordinaria semanal (horas)
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={settings.standardHoursPerWeek}
                  disabled={!canSyncData}
                  onChange={(event) =>
                    handleStandardHoursChange(event.target.value)
                  }
                />
              </label>

              <label>
                Multiplicador de hora extra
                <input
                  type="number"
                  min="1"
                  step="0.25"
                  value={settings.overtimeMultiplier}
                  disabled={!canSyncData}
                  onChange={(event) =>
                    handleOvertimeMultiplierChange(event.target.value)
                  }
                />
              </label>
            </div>

            <div className="control-note">
              <strong>Regla actual</strong>
              <p>
                La app toma el salario mensual ya cargado, calcula la hora ordinaria
                como salario/30/8. Las horas extra se activan cuando el
                colaborador supera {formatCompactHours(settings.standardHoursPerWeek)}{" "}
                horas en la semana y se multiplican por{" "}
                {formatCompactHours(settings.overtimeMultiplier)}.
              </p>
            </div>
          </section>
        </>
      ) : null}

      <header
        className={
          isMarkingMode
            ? "session-strip session-strip-terminal"
            : "session-strip"
        }
      >
        <div className="session-copy">
          <span className="panel-kicker">Sesion activa</span>
          <strong>{activeUser.label}</strong>
          <span>{activeUser.subtitle}</span>
        </div>

        <div className="session-actions">
          <span className="session-pill">{currentUser.username}</span>
          <button
            type="button"
            className={isMarkingMode ? "camera-button" : "ghost-button"}
            onClick={handleLogout}
          >
            Cerrar sesion
          </button>
        </div>
      </header>

      {availableTabs.length > 1 ? (
        <nav
          className={isMarkingMode ? "tab-bar tab-bar-terminal" : "tab-bar"}
          aria-label="Secciones principales"
        >
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === selectedTab ? "tab-button active" : "tab-button"}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      ) : null}

      {notice && !isMarkingMode ? (
        <div className={`notice notice-${notice.type}`}>{notice.text}</div>
      ) : null}

      {syncState.loading ? (
        <div className="notice">Sincronizando informacion con Firebase...</div>
      ) : null}

      {syncState.error ? (
        <div className="notice notice-error">{syncState.error}</div>
      ) : null}

      {isMarkingMode ? (
        <main className="marking-shell">
          <section className="marking-terminal">
            <div className="clock-display terminal-clock">
              <span>Hora</span>
              <strong>{clockTime}</strong>
            </div>

            <section className="scanner-card scanner-card-compact">
              <div className="scanner-top">
                <span className="scanner-badge">Entrada y salida automatica</span>
                <span className="scanner-meta">Escaner listo</span>
              </div>

              <div className="scanner-stage">
                <div className="scanner-stage-head">
                  <span>Zona de lectura</span>
                  <span>Sistema activo</span>
                </div>

                <form className="scanner-form scanner-form-compact" onSubmit={handleClockScan}>
                  <label className="scanner-label" htmlFor="document-scan">
                    Cedula o ultimos 5
                  </label>
                  <div className="scanner-input-shell">
                    <span className="scanner-corner scanner-corner-top-left" aria-hidden="true" />
                    <span className="scanner-corner scanner-corner-top-right" aria-hidden="true" />
                    <span className="scanner-corner scanner-corner-bottom-left" aria-hidden="true" />
                    <span className="scanner-corner scanner-corner-bottom-right" aria-hidden="true" />
                    <span className="scanner-line" aria-hidden="true" />
                    <input
                      id="document-scan"
                      ref={scanInputRef}
                      className="scanner-input"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      enterKeyHint="go"
                      inputMode="text"
                      placeholder="CEDULA O ULTIMOS 5"
                      value={scanValue}
                      disabled={!canSyncData}
                      onChange={(event) =>
                        setScanValue(event.target.value.toUpperCase())
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className={isCameraOpen ? "camera-button active" : "camera-button"}
                    disabled={!canSyncData}
                    onClick={handleCameraToggle}
                  >
                    {isCameraOpen ? "Cerrar camara" : "Escanear con la camara"}
                  </button>
                </form>
              </div>

              <div className={isCameraOpen ? "camera-panel live compact" : "camera-panel compact"}>
                <div className="camera-panel-head compact">
                  <span className="scan-feedback-kicker">Camara</span>
                  <strong>
                    {isCameraOpen
                      ? "Acerca bien el código de barras de la cédula"
                      : "Pulsa el boton para abrir la camara"}
                  </strong>
                </div>

                {isCameraOpen ? (
                  <div className="camera-viewport compact">
                    <video
                      ref={cameraVideoRef}
                      className="camera-video"
                      autoPlay
                      muted
                      playsInline
                    />
                    <div className="camera-target compact" aria-hidden="true">
                      <span className="camera-target-corner top-left" />
                      <span className="camera-target-corner top-right" />
                      <span className="camera-target-corner bottom-left" />
                      <span className="camera-target-corner bottom-right" />
                      <span className="camera-target-line" />
                    </div>
                  </div>
                ) : (
                  <div className="camera-placeholder compact">
                    <span>Vista pequena para enfocar mejor codigos de barra chicos.</span>
                  </div>
                )}

                <div className="camera-status-box compact">
                  <span>{cameraStatus}</span>
                  {cameraError ? (
                    <strong className="camera-error">{cameraError}</strong>
                  ) : null}
                </div>
              </div>

              {scanResult ? (
                <div className={`scan-feedback ${scanResult.type}`}>
                  <span className="scan-feedback-kicker">{scanResult.title}</span>
                  <strong>{scanResult.detail}</strong>
                  <span>
                    {scanResult.movement
                      ? `${scanResult.movement} a las ${scanResult.timeLabel}`
                      : scanResult.detail}
                  </span>
                </div>
              ) : null}
            </section>
          </section>

        </main>
      ) : null}

      {!isMarkingMode ? (
        <main className="content-grid">
          {selectedTab === "resumen" ? (
            <>
              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Vista central</span>
                    <h2>Resumen semanal por colaborador</h2>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={exportConsolidated}
                  >
                    Descargar consolidado
                  </button>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Cedula</th>
                        <th>Dias con registro</th>
                        <th>Total horas semana</th>
                        <th>Horas ordinarias</th>
                        <th>Horas extra</th>
                        <th>Valor hora extra</th>
                        <th>Pago horas extra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payroll.summaryRows.map((row) => (
                        <tr key={row.collaborator.id}>
                          <td>{row.collaborator.name}</td>
                          <td>{row.collaborator.documentId}</td>
                          <td>{row.dayCount}</td>
                          <td>{formatHours(row.totalWorkedHours)}</td>
                          <td>{formatHours(row.ordinaryHours)}</td>
                          <td>{formatHours(row.overtimeHours)}</td>
                          <td>{formatCurrency(row.overtimeRate)}</td>
                          <td>{formatCurrency(row.totalPay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Radar de pago</span>
                    <h2>Quienes mas acumulan esta semana</h2>
                  </div>
                </div>

                <div className="leaderboard">
                  {topWorkers.map((row, index) => {
                    const width =
                      payroll.totals.totalPay > 0
                        ? Math.max((row.totalPay / payroll.totals.totalPay) * 100, 8)
                        : 8;

                    return (
                      <div key={row.collaborator.id} className="leader-row">
                        <div className="leader-copy">
                          <span className="leader-rank">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>{row.collaborator.name}</strong>
                            <span>{formatHours(row.overtimeHours)}</span>
                          </div>
                        </div>
                        <div className="leader-bar">
                          <span style={{ width: `${width}%` }} />
                        </div>
                        <strong className="leader-value">
                          {formatCurrency(row.totalPay)}
                        </strong>
                      </div>
                    );
                  })}
                  {topWorkers.length === 0 ? (
                    <p className="empty-state">
                      Aun no hay horas extras registradas en la semana seleccionada.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Lectura rapida</span>
                    <h2>Actividad de la semana</h2>
                  </div>
                </div>

                <div className="metric-stack">
                  <div className="metric-line">
                    <span>Registros cerrados</span>
                    <strong>
                      {
                        payroll.processedRecords.filter((record) => record.checkOut)
                          .length
                      }
                    </strong>
                  </div>
                  <div className="metric-line">
                    <span>Registros pendientes</span>
                    <strong>
                      {
                        payroll.processedRecords.filter((record) => !record.checkOut)
                          .length
                      }
                    </strong>
                  </div>
                  <div className="metric-line">
                    <span>Horas trabajadas</span>
                    <strong>{formatHours(payroll.totals.workedHours)}</strong>
                  </div>
                  <div className="metric-line">
                    <span>Horas ordinarias</span>
                    <strong>{formatHours(payroll.totals.ordinaryHours)}</strong>
                  </div>
                  <div className="metric-line">
                    <span>Colaboradores con actividad</span>
                    <strong>{String(visibleSummaryRows.length)}</strong>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {selectedTab === "manual" ? (
            <>
              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Registro semanal</span>
                    <h2>Cuadro manual por colaborador</h2>
                  </div>
                  <span className="panel-meta">
                    {formatDateLabel(settings.weekStart)} al{" "}
                    {formatDateLabel(currentWeekEnd)}
                  </span>
                </div>

                <p className="weekly-entry-copy">
                  Registra hasta dos entradas y dos salidas por dia. Usa el
                  cuadrito de informacion para ver horas trabajadas, almuerzo y
                  el acumulado semanal hasta ese dia.
                </p>

                <div className="table-wrap weekly-entry-wrap">
                  <table className="weekly-entry-table">
                    <thead>
                      <tr>
                        <th>Colaboradores</th>
                        {weekDates.map((date, index) => (
                          <th key={date}>
                            <div className="weekly-entry-head">
                              <strong>{formatDayHeader(dayNames[index])}</strong>
                              <span>{formatDateLabel(date)}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyMatrixRows.map((row) => (
                        <tr key={row.collaborator.id}>
                          <td className="weekly-collaborator-cell">
                            <strong>{row.collaborator.name}</strong>
                            <span className="cell-meta">
                              {row.collaborator.documentId}
                            </span>
                          </td>
                          {row.days.map((day) => (
                            <td key={day.key}>
                              <div className="weekly-entry-cell">
                                <div className="weekly-entry-inputs">
                                  {WEEKLY_SHIFT_FIELDS.map((shiftField, index) => (
                                    <div
                                      key={`${day.key}-${shiftField.label}`}
                                      className="weekly-shift-pair"
                                    >
                                      <label>
                                        <span>E{index + 1}</span>
                                        <input
                                          type="time"
                                          value={day.draft[shiftField.checkIn]}
                                          disabled={!canSyncData}
                                          onChange={(event) =>
                                            handleWeeklyDraftChange(
                                              row.collaborator.id,
                                              day.date,
                                              shiftField.checkIn,
                                              event.target.value
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>S{index + 1}</span>
                                        <input
                                          type="time"
                                          value={day.draft[shiftField.checkOut]}
                                          disabled={!canSyncData}
                                          onChange={(event) =>
                                            handleWeeklyDraftChange(
                                              row.collaborator.id,
                                              day.date,
                                              shiftField.checkOut,
                                              event.target.value
                                            )
                                          }
                                        />
                                      </label>
                                    </div>
                                  ))}
                                </div>

                                <div className="weekly-entry-meta">
                                  <strong>{formatCompactHours(day.stats.workedHours)} h</strong>
                                  <span>
                                    Almuerzo {formatCompactHours(day.stats.lunchHours)} h
                                  </span>
                                  {day.hiddenRecordCount > 0 ? (
                                    <span>
                                      +{day.hiddenRecordCount} tramo(s) adicional(es)
                                    </span>
                                  ) : null}
                                </div>

                                <div className="weekly-entry-actions">
                                  <button
                                    type="button"
                                    className="mini-button weekly-info-button"
                                    aria-label="Ver resumen del dia"
                                    title="Ver resumen del dia"
                                    onClick={() =>
                                      setSelectedWeeklyInfo({
                                        employeeId: row.collaborator.id,
                                        date: day.date,
                                      })
                                    }
                                  >
                                    i
                                  </button>
                                  <button
                                    type="button"
                                    className="mini-button"
                                    disabled={!canSyncData}
                                    onClick={() =>
                                      handleSaveWeeklyDay(
                                        row.collaborator.id,
                                        day.date
                                      )
                                    }
                                  >
                                    Guardar
                                  </button>
                                </div>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Ajuste individual</span>
                    <h2>
                      {editingRecordId ? "Editar registro" : "Agregar registro"}
                    </h2>
                  </div>
                </div>

                <form className="manual-form" onSubmit={handleManualSubmit}>
                  <label>
                    Colaborador
                    <select
                      value={manualForm.employeeId}
                      disabled={!canSyncData}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          employeeId: event.target.value,
                        }))
                      }
                    >
                      {collaborators.map((collaborator) => (
                        <option key={collaborator.id} value={collaborator.id}>
                          {collaborator.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="form-grid">
                    <label>
                      Fecha
                      <input
                        type="date"
                        value={manualForm.date}
                        disabled={!canSyncData}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            date: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      Descanso (min)
                      <input
                        type="number"
                        min="0"
                        step="15"
                        value={manualForm.breakMinutes}
                        disabled={!canSyncData}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            breakMinutes: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="form-grid">
                    <label>
                      Hora de entrada
                      <input
                        type="time"
                        value={manualForm.checkIn}
                        disabled={!canSyncData}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            checkIn: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      Hora de salida
                      <input
                        type="time"
                        value={manualForm.checkOut}
                        disabled={!canSyncData}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            checkOut: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label>
                    Tipo de registro
                    <select
                      value={manualForm.source}
                      disabled={!canSyncData}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          source: event.target.value,
                        }))
                      }
                    >
                      <option value="manual">Manual</option>
                      <option value="clock">Marcacion</option>
                    </select>
                  </label>

                  <div className="button-row">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={!canSyncData}
                    >
                      {editingRecordId ? "Guardar cambios" : "Agregar registro"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={resetManualForm}
                    >
                      Limpiar
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Semana activa</span>
                    <h2>Registros cargados</h2>
                  </div>
                  <span className="panel-meta">
                    {formatDateLabel(settings.weekStart)} al{" "}
                    {formatDateLabel(currentWeekEnd)}
                  </span>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Colaborador</th>
                        <th>Cedula</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                        <th>Descanso</th>
                        <th>Horas del tramo</th>
                        <th>Horas del dia</th>
                        <th>Fuente</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payroll.processedRecords.map((record) => (
                        <tr key={record.id}>
                          <td>
                            {formatDateLabel(record.date)}
                            <div className="cell-meta">{record.dayLabel}</div>
                          </td>
                          <td>{record.collaborator.name}</td>
                          <td>{record.collaborator.documentId}</td>
                          <td>{record.checkIn || "--"}</td>
                          <td>{record.checkOut || "Pendiente"}</td>
                          <td>{Number(record.breakMinutes || 0)} min</td>
                          <td>{formatHours(record.workedHours)}</td>
                          <td>{formatHours(record.dayWorkedHours)}</td>
                          <td>{record.source === "clock" ? "Marcacion" : "Manual"}</td>
                          <td>
                            <div className="mini-actions">
                              <button
                                type="button"
                                className="mini-button"
                                onClick={() => handleEditRecord(record)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="mini-button danger"
                                disabled={!canSyncData}
                                onClick={() => handleDeleteRecord(record.id)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}

          {selectedTab === "reportes" ? (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Reporte diario</span>
                    <h2>Marcaciones y exportaciones</h2>
                  </div>
                </div>

                <div className="form-grid">
                  <label>
                    Fecha de marcacion
                    <input
                      type="date"
                      value={selectedReportDate}
                      onChange={(event) => setSelectedReportDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Colaborador en reporte
                    <select
                      value={selectedReportEmployeeId}
                      onChange={(event) =>
                        setSelectedReportEmployeeId(event.target.value)
                      }
                    >
                      <option value="all">Todos los colaboradores</option>
                      {collaborators.map((collaborator) => (
                        <option key={collaborator.id} value={collaborator.id}>
                          {collaborator.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="report-stack">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={exportDailyReport}
                  >
                    Descargar reporte diario
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={exportConsolidated}
                  >
                    Descargar consolidado semanal
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={exportSlipPack}
                  >
                    Descargar paquete de colillas
                  </button>
                </div>

                <div className="panel inset-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">Archivo banco</span>
                      <h2>Generar envio PRN para BAC</h2>
                    </div>
                    <span className="panel-meta">Plan fijo AAF6</span>
                  </div>

                  <div className="form-grid">
                    <label>
                      Fecha de pago
                      <input
                        type="date"
                        value={bankPaymentForm.paymentDate}
                        onChange={(event) =>
                          setBankPaymentForm((current) => ({
                            ...current,
                            paymentDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Numero de envio
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="175"
                        value={bankPaymentForm.shipmentNumber}
                        onChange={(event) =>
                          setBankPaymentForm((current) => ({
                            ...current,
                            shipmentNumber: event.target.value.replace(/\D/g, ""),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="slip-summary slip-summary-compact">
                    <StatCard
                      label="Planilla"
                      value="AAF6"
                      caption="Numero de plan de planilla"
                    />
                    <StatCard
                      label="Detalle"
                      value={bankPaymentDetail}
                      caption="Concepto que viaja en el archivo"
                    />
                    <StatCard
                      label="Registros"
                      value={String(bankPaymentRows.length)}
                      caption="Colaboradores con pago de horas extras"
                    />
                    <StatCard
                      label="Total envio"
                      value={formatCurrency(bankPaymentTotal)}
                      caption="Total acumulado del archivo PRN"
                    />
                  </div>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={exportBankFile}
                  >
                    Descargar archivo banco (.PRN)
                  </button>
                </div>

                <label className="full-width">
                  Colaborador para colilla individual
                  <select
                    value={selectedSlipEmployeeId}
                    onChange={(event) => setSelectedSlipEmployeeId(event.target.value)}
                  >
                    {collaborators.map((collaborator) => (
                      <option key={collaborator.id} value={collaborator.id}>
                        {collaborator.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="button" className="primary-button" onClick={exportSlip}>
                  Descargar colilla individual
                </button>
              </section>

              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Fecha seleccionada</span>
                    <h2>Resumen de marcaciones del dia</h2>
                  </div>
                  <span className="panel-meta">
                    {selectedReportCollaborator
                      ? `${formatDateLabel(selectedReportDate)} - ${selectedReportCollaborator.name}`
                      : formatDateLabel(selectedReportDate)}{" "}
                    | Semana del {formatDateLabel(dailyReportSnapshot.weekStart)} al{" "}
                    {formatDateLabel(dailyReportSnapshot.weekEnd)}
                  </span>
                </div>

                <div className="slip-summary slip-summary-compact report-summary-grid">
                  <StatCard
                    label="Colaboradores"
                    value={String(dailyReportSnapshot.totals.employeeCount)}
                    caption="Personas con al menos una marcacion en el dia"
                  />
                  <StatCard
                    label="Tramos"
                    value={String(dailyReportSnapshot.totals.recordCount)}
                    caption="Entradas y salidas registradas por bloques"
                  />
                  <StatCard
                    label="Entradas abiertas"
                    value={String(dailyReportSnapshot.totals.openCount)}
                    caption="Sirve para ver quien marco entrada y no ha salido"
                  />
                  <StatCard
                    label="Horas trabajadas"
                    value={formatHours(dailyReportSnapshot.totals.workedHours)}
                    caption="Suma del dia con cortes como almuerzo incluidos"
                  />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Cedula</th>
                        <th>Tramos</th>
                        <th>Horario(s) del dia</th>
                        <th>Horas del dia</th>
                        <th>Total semana</th>
                        <th>Horas ordinarias semana</th>
                        <th>Horas extra semana</th>
                        <th>Pago horas extra</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReportSnapshot.summaryRows.map((row) => (
                        <tr key={`${row.employeeId}-${row.date}`}>
                          <td>{row.collaborator.name}</td>
                          <td>{row.collaborator.documentId}</td>
                          <td>{row.recordCount}</td>
                          <td>{row.scheduleLabel}</td>
                          <td>{formatHours(row.totalWorkedHours)}</td>
                          <td>{formatHours(row.weeklyTotalWorkedHours)}</td>
                          <td>{formatHours(row.weeklyOrdinaryHours)}</td>
                          <td>{formatHours(row.weeklyOvertimeHours)}</td>
                          <td>{formatCurrency(row.weeklyOvertimePay)}</td>
                          <td>{row.statusLabel}</td>
                        </tr>
                      ))}
                      {dailyReportSnapshot.summaryRows.length === 0 ? (
                        <tr>
                          <td colSpan="10">
                            <span className="empty-state">
                              No hay marcaciones registradas para esta fecha.
                            </span>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Detalle crudo</span>
                    <h2>Marcaciones del dia</h2>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Cedula</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                        <th>Descanso</th>
                        <th>Horas del tramo</th>
                        <th>Horas del dia</th>
                        <th>Total semana</th>
                        <th>Fuente</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReportSnapshot.processedRecords.map((record) => (
                        <tr key={record.id}>
                          <td>{record.collaborator.name}</td>
                          <td>{record.collaborator.documentId}</td>
                          <td>{record.checkIn || "--"}</td>
                          <td>{record.checkOut || "Pendiente"}</td>
                          <td>{Number(record.breakMinutes || 0)} min</td>
                          <td>{formatHours(record.workedHours)}</td>
                          <td>{formatHours(record.dayWorkedHours)}</td>
                          <td>{formatHours(record.weeklyTotalWorkedHours)}</td>
                          <td>{record.source === "clock" ? "Marcacion" : "Manual"}</td>
                          <td>{record.checkOut ? "Completo" : "Entrada abierta"}</td>
                        </tr>
                      ))}
                      {dailyReportSnapshot.processedRecords.length === 0 ? (
                        <tr>
                          <td colSpan="10">
                            <span className="empty-state">
                              Aun no hay entradas ni salidas para la fecha seleccionada.
                            </span>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Vista previa</span>
                    <h2>Colilla de {selectedSlipSummary?.collaborator.name}</h2>
                  </div>
                </div>

                {selectedSlipSummary ? (
                  <>
                    <div className="slip-summary slip-summary-compact">
                      <StatCard
                        label="Total semana"
                        value={formatHours(selectedSlipSummary.totalWorkedHours)}
                        caption="Horas reportadas con redondeo diario aplicado"
                      />
                      <StatCard
                        label="Horas ordinarias"
                        value={formatHours(selectedSlipSummary.ordinaryHours)}
                        caption="Hasta 48 horas semanales"
                      />
                      <StatCard
                        label="Hora extra"
                        value={formatCurrency(selectedSlipSummary.overtimeRate)}
                        caption={selectedSlipSummary.collaborator.documentId}
                      />
                      <StatCard
                        label="Horas extra"
                        value={formatHours(selectedSlipSummary.overtimeHours)}
                        caption="Total de la semana seleccionada"
                      />
                      <StatCard
                        label="Total a pagar"
                        value={formatCurrency(selectedSlipSummary.totalPay)}
                        caption="Monto que saldra en la colilla"
                      />
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Dia</th>
                            <th>Horario(s)</th>
                            <th>Horas trabajadas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSlipDays.map((day) => (
                            <tr key={`${day.employeeId}-${day.date}`}>
                              <td>{formatDateLabel(day.date)}</td>
                              <td>{day.dayLabel}</td>
                              <td>{day.scheduleLabel}</td>
                              <td>{formatHours(day.totalWorkedHours)}</td>
                            </tr>
                          ))}
                          {selectedSlipDays.length === 0 ? (
                            <tr>
                              <td colSpan="4">
                                <span className="empty-state">
                                  Este colaborador no tiene jornadas registradas en la
                                  semana seleccionada.
                                </span>
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </section>
            </>
          ) : null}
        </main>
      ) : null}

      {selectedWeeklyInfoEntry ? (
        <div
          className="weekly-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedWeeklyInfo(null)}
        >
          <section
            className="weekly-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-info-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Resumen del dia</span>
                <h2 id="weekly-info-title">
                  {
                    collaborators.find(
                      (collaborator) =>
                        collaborator.id === selectedWeeklyInfo.employeeId
                    )?.name
                  }
                </h2>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedWeeklyInfo(null)}
              >
                Cerrar
              </button>
            </div>

            <div className="weekly-modal-copy">
              <strong>
                {formatDateLabel(selectedWeeklyInfoEntry.date)} |{" "}
                {formatDayHeader(selectedWeeklyInfoEntry.dayName)}
              </strong>
              <span>
                Semana del {formatDateLabel(settings.weekStart)} al{" "}
                {formatDateLabel(currentWeekEnd)}
              </span>
            </div>

            <div className="slip-summary slip-summary-compact weekly-modal-stats">
              <StatCard
                label="Horas trabajadas"
                value={formatHours(selectedWeeklyInfoEntry.stats.workedHours)}
                caption="Suma de los dos tramos del dia"
              />
              <StatCard
                label="Almuerzo"
                value={formatHours(selectedWeeklyInfoEntry.stats.lunchHours)}
                caption="Tiempo entre salida y regreso"
              />
              <StatCard
                label="Acumulado"
                value={formatHours(
                  selectedWeeklyInfoEntry.stats.accumulatedWorkedHours
                )}
                caption="Horas trabajadas acumuladas hasta este dia"
              />
              <StatCard
                label="Extra acumulada"
                value={formatHours(
                  selectedWeeklyInfoEntry.stats.accumulatedOvertimeHours
                )}
                caption="Horas extra ya activadas en la semana"
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tramo</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKLY_SHIFT_FIELDS.map((shiftField) => (
                    <tr key={`${selectedWeeklyInfoEntry.key}-${shiftField.label}`}>
                      <td>{shiftField.label}</td>
                      <td>{selectedWeeklyInfoEntry.draft[shiftField.checkIn] || "--"}</td>
                      <td>{selectedWeeklyInfoEntry.draft[shiftField.checkOut] || "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedWeeklyInfoEntry.hiddenRecordCount > 0 ? (
              <p className="empty-state">
                Hay {selectedWeeklyInfoEntry.hiddenRecordCount} tramo(s)
                adicional(es) guardado(s) ese dia fuera de este cuadro.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
