import { useEffect, useEffectEvent, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import {
  collaboratorByDocumentId,
  collaborators,
  normalizeDocumentId,
} from "./data/collaborators";
import {
  exportAllSlipsWorkbook,
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
  formatCompactHours,
  formatCurrency,
  formatDateLabel,
  formatHours,
  getMonday,
  getWeekEnd,
  isDateInWeek,
  toInputDate,
  toInputTime,
} from "./utils/time";

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
    subtitle: "Acceso exclusivo para entrada y salida por cedula.",
    allowedTabs: ["marcacion"],
  },
};

function buildDefaultSettings(date = new Date()) {
  return {
    weekStart: getMonday(date),
    standardHoursPerDay: 8,
    overtimeMultiplier: 2,
  };
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
  const [selectedReportEmployeeId, setSelectedReportEmployeeId] = useState("all");
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
      overtimeHours: filteredDailySummaryRows.reduce(
        (total, row) => total + row.overtimeHours,
        0
      ),
      totalPay: filteredDailySummaryRows.reduce(
        (total, row) => total + row.overtimePay,
        0
      ),
    },
  };
  const visibleSummaryRows = payroll.summaryRows.filter(
    (row) => row.recordCount > 0 || row.overtimeHours > 0
  );
  const activeRecords = records.reduce((collection, record) => {
    if (!record.checkOut) {
      const current = collection[record.employeeId];
      const currentTime = current
        ? new Date(
            `${current.date}T${current.checkIn || "00:00"}:00`
          ).getTime()
        : -Infinity;
      const nextTime = new Date(
        `${record.date}T${record.checkIn || "00:00"}:00`
      ).getTime();

      if (!current || nextTime >= currentTime) {
        collection[record.employeeId] = record;
      }
    }
    return collection;
  }, {});
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

  async function handleStandardHoursChange(rawValue) {
    if (!canSyncData) {
      showNotice("error", syncState.error || "Firebase aun no esta listo.");
      return;
    }

    const previousSettings = settings;
    const nextSettings = {
      ...settings,
      standardHoursPerDay: Number(rawValue || 0),
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
        detail: "Escanea o escribe una cedula para registrar la marcacion.",
      });
      setScanValue("");
      return false;
    }

    const collaborator = collaboratorByDocumentId[normalizedDocument];
    if (!collaborator) {
      setScanResult({
        type: "error",
        title: "Cedula no encontrada",
        detail: `La cedula ${String(rawValue).trim()} no esta registrada en el sistema.`,
      });
      setScanValue("");
      return false;
    }

    const activeRecord = activeRecords[collaborator.id];
    const timestamp = new Date();
    const nextDate = toInputDate(timestamp);
    const nextTime = toInputTime(timestamp);
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

  function exportConsolidated() {
    exportConsolidatedWorkbook(payroll);
    showNotice("success", "Consolidado exportado a Excel.");
  }

  function exportDailyReport() {
    exportDailyMarkingWorkbook(dailyReportSnapshot);
    showNotice("success", "Reporte diario de marcaciones exportado.");
  }

  function exportSlip() {
    if (!selectedSlipSummary) {
      showNotice("error", "Selecciona un colaborador para generar la colilla.");
      return;
    }
    exportIndividualSlipWorkbook(payroll, selectedSlipSummary.collaborator.id);
    showNotice("success", "Colilla individual exportada.");
  }

  function exportSlipPack() {
    exportAllSlipsWorkbook(payroll);
    showNotice("success", "Paquete completo de colillas exportado.");
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
                <span>Marcacion por cedula</span>
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
                  caption="Calculadas con base en la jornada diaria configurada"
                />
                <StatCard
                  label="Pago estimado"
                  value={formatCurrency(payroll.totals.totalPay)}
                  caption="Con tarifa de hora extra aplicada automaticamente"
                />
                <StatCard
                  label="Trabajadores con extra"
                  value={String(payroll.workersWithOvertime)}
                  caption="Solo quienes superaron la jornada ordinaria"
                />
                <StatCard
                  label="Marcaciones abiertas"
                  value={String(Object.keys(activeRecords).length)}
                  caption="Entradas pendientes de salida"
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
                Jornada ordinaria (horas)
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={settings.standardHoursPerDay}
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
                como salario/30/8 y multiplica la hora extra por{" "}
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
                    Cedula
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
                      placeholder="ESCRIBE TU CEDULA"
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
                        <th>Hora ordinaria</th>
                        <th>Hora extra</th>
                        <th>Dias con registro</th>
                        <th>Horas trabajadas</th>
                        <th>Horas extra</th>
                        <th>Total a pagar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payroll.summaryRows.map((row) => (
                        <tr key={row.collaborator.id}>
                          <td>{row.collaborator.name}</td>
                          <td>{row.collaborator.documentId}</td>
                          <td>{formatCurrency(row.ordinaryRate)}</td>
                          <td>{formatCurrency(row.overtimeRate)}</td>
                          <td>{row.dayCount}</td>
                          <td>{formatHours(row.totalWorkedHours)}</td>
                          <td>{formatHours(row.overtimeHours)}</td>
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
                    <span>Colaboradores con actividad</span>
                    <strong>{String(visibleSummaryRows.length)}</strong>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {selectedTab === "manual" ? (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Entrada manual</span>
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
                        <th>Horas trabajadas</th>
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
                      : formatDateLabel(selectedReportDate)}
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
                        <th>Horas trabajadas</th>
                        <th>Horas extra</th>
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
                          <td>{formatHours(row.overtimeHours)}</td>
                          <td>{row.statusLabel}</td>
                        </tr>
                      ))}
                      {dailyReportSnapshot.summaryRows.length === 0 ? (
                        <tr>
                          <td colSpan="7">
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
                        <th>Horas trabajadas</th>
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
                          <td>{record.source === "clock" ? "Marcacion" : "Manual"}</td>
                          <td>{record.checkOut ? "Completo" : "Entrada abierta"}</td>
                        </tr>
                      ))}
                      {dailyReportSnapshot.processedRecords.length === 0 ? (
                        <tr>
                          <td colSpan="8">
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
                        label="Cedula"
                        value={selectedSlipSummary.collaborator.documentId}
                        caption="Identificador usado en la terminal de marcacion"
                      />
                      <StatCard
                        label="Hora extra"
                        value={formatCurrency(selectedSlipSummary.overtimeRate)}
                        caption="Se recalcula segun la configuracion semanal"
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
                            <th>Horas extra</th>
                            <th>Pago</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSlipDays.map((day) => (
                            <tr key={`${day.employeeId}-${day.date}`}>
                              <td>{formatDateLabel(day.date)}</td>
                              <td>{day.dayLabel}</td>
                              <td>{day.scheduleLabel}</td>
                              <td>{formatHours(day.totalWorkedHours)}</td>
                              <td>{formatHours(day.overtimeHours)}</td>
                              <td>{formatCurrency(day.overtimePay)}</td>
                            </tr>
                          ))}
                          {selectedSlipDays.length === 0 ? (
                            <tr>
                              <td colSpan="6">
                                <span className="empty-state">
                                  Este colaborador no tiene horas extras registradas en la
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
    </div>
  );
}

export default App;
