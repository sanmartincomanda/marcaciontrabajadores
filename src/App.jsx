import { useEffect, useRef, useState } from "react";
import {
  collaboratorByDocumentId,
  collaboratorMap,
  collaborators,
  normalizeDocumentId,
} from "./data/collaborators";
import {
  exportAllSlipsWorkbook,
  exportConsolidatedWorkbook,
  exportIndividualSlipWorkbook,
} from "./utils/exporters";
import { buildPayrollSnapshot } from "./utils/payroll";
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

const SETTINGS_KEY = "horas-extras/settings-v1";
const RECORDS_KEY = "horas-extras/records-v1";

const tabs = [
  { id: "marcacion", label: "Terminal de marcacion" },
  { id: "resumen", label: "Resumen semanal" },
  { id: "manual", label: "Ingreso manual" },
  { id: "reportes", label: "Reportes y descargas" },
];

function loadStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getInitialTab() {
  const availableTabs = new Set(tabs.map((tab) => tab.id));
  const hash = window.location.hash.replace("#", "").trim().toLowerCase();
  return availableTabs.has(hash) ? hash : "marcacion";
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

function App() {
  const defaultWeekStart = getMonday(new Date());
  const [selectedTab, setSelectedTab] = useState(getInitialTab);
  const [settings, setSettings] = useState(() =>
    loadStored(SETTINGS_KEY, {
      weekStart: defaultWeekStart,
      standardHoursPerDay: 8,
      overtimeMultiplier: 2,
    })
  );
  const [records, setRecords] = useState(() => loadStored(RECORDS_KEY, []));
  const [manualForm, setManualForm] = useState(() =>
    createManualForm(defaultWeekStart)
  );
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [selectedSlipEmployeeId, setSelectedSlipEmployeeId] = useState(
    collaborators[0]?.id ?? ""
  );
  const [notice, setNotice] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const scanInputRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  }, [records]);

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
      setSelectedTab(nextTab);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const nextHash = `#${selectedTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab !== "marcacion") {
      return undefined;
    }

    const timer = window.setTimeout(() => scanInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [selectedTab, scanResult]);

  const payroll = buildPayrollSnapshot(collaborators, records, settings);
  const currentWeekEnd = getWeekEnd(settings.weekStart);
  const visibleSummaryRows = payroll.summaryRows.filter(
    (row) => row.recordCount > 0 || row.overtimeHours > 0
  );
  const activeRecords = records.reduce((collection, record) => {
    if (!record.checkOut) {
      collection[record.employeeId] = record;
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
  const recentMovements = records
    .flatMap((record) => {
      const collaborator = collaboratorMap[record.employeeId];
      if (!collaborator) {
        return [];
      }

      const movementItems = [
        {
          id: `${record.id}-entrada`,
          collaborator,
          movement: "Entrada",
          timestamp:
            record.createdAt ??
            new Date(`${record.date}T${record.checkIn || "00:00"}:00`).toISOString(),
          timeLabel: record.checkIn || "--:--",
          dateLabel: formatDateLabel(record.date),
        },
      ];

      if (record.checkOut) {
        movementItems.push({
          id: `${record.id}-salida`,
          collaborator,
          movement: "Salida",
          timestamp:
            record.updatedAt ??
            new Date(`${record.date}T${record.checkOut}:00`).toISOString(),
          timeLabel: record.checkOut,
          dateLabel: formatDateLabel(record.date),
        });
      }

      return movementItems;
    })
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    )
    .slice(0, 8);
  const openShiftRows = Object.values(activeRecords)
    .map((record) => ({
      collaborator: collaboratorMap[record.employeeId],
      dateLabel: formatDateLabel(record.date),
      timeLabel: record.checkIn || "--:--",
    }))
    .filter((entry) => entry.collaborator);
  const clockTime = new Date(now).toLocaleTimeString("es-NI", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const clockDate = new Date(now).toLocaleDateString("es-NI", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const isMarkingMode = selectedTab === "marcacion";

  function showNotice(type, text) {
    setNotice({ id: crypto.randomUUID(), type, text });
  }

  function handleTabChange(tabId) {
    setSelectedTab(tabId);
  }

  function handleWeekStartChange(nextWeekStart) {
    setSettings((current) => ({
      ...current,
      weekStart: nextWeekStart,
    }));

    setManualForm((current) =>
      !current.date || !isDateInWeek(current.date, nextWeekStart)
        ? { ...current, date: nextWeekStart }
        : current
    );
  }

  function resetManualForm() {
    setEditingRecordId(null);
    setManualForm(createManualForm(settings.weekStart, manualForm.employeeId));
  }

  function handleManualSubmit(event) {
    event.preventDefault();

    if (!manualForm.employeeId || !manualForm.date || !manualForm.checkIn) {
      showNotice(
        "error",
        "Completa colaborador, fecha y hora de entrada para guardar el registro."
      );
      return;
    }

    const timestamp = new Date().toISOString();
    const payload = {
      id: editingRecordId ?? crypto.randomUUID(),
      employeeId: manualForm.employeeId,
      date: manualForm.date,
      checkIn: manualForm.checkIn,
      checkOut: manualForm.checkOut,
      breakMinutes: Number(manualForm.breakMinutes || 0),
      source: manualForm.source,
      updatedAt: timestamp,
      createdAt: timestamp,
    };

    setRecords((current) => {
      if (editingRecordId) {
        return current.map((record) =>
          record.id === editingRecordId
            ? { ...record, ...payload, createdAt: record.createdAt }
            : record
        );
      }
      return [payload, ...current];
    });

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

  function handleDeleteRecord(recordId) {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    if (editingRecordId === recordId) {
      resetManualForm();
    }
    showNotice("success", "Registro eliminado.");
  }

  function handleClockScan(event) {
    event.preventDefault();

    const normalizedDocument = normalizeDocumentId(scanValue);
    if (!normalizedDocument) {
      setScanResult({
        type: "error",
        title: "Escaneo vacio",
        detail: "Escanea o escribe una cedula para registrar la marcacion.",
      });
      setScanValue("");
      return;
    }

    const collaborator = collaboratorByDocumentId[normalizedDocument];
    if (!collaborator) {
      setScanResult({
        type: "error",
        title: "Cedula no encontrada",
        detail: `La cedula ${scanValue.trim()} no esta registrada en el sistema.`,
      });
      setScanValue("");
      return;
    }

    const activeRecord = activeRecords[collaborator.id];
    const timestamp = new Date();
    const nextDate = toInputDate(timestamp);
    const nextTime = toInputTime(timestamp);
    const movement = activeRecord ? "Salida" : "Entrada";

    if (activeRecord) {
      setRecords((current) =>
        current.map((record) =>
          record.id === activeRecord.id
            ? {
                ...record,
                checkOut: nextTime,
                updatedAt: timestamp.toISOString(),
              }
            : record
        )
      );
    } else {
      setRecords((current) => [
        {
          id: crypto.randomUUID(),
          employeeId: collaborator.id,
          date: nextDate,
          checkIn: nextTime,
          checkOut: "",
          breakMinutes: 0,
          source: "clock",
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
        },
        ...current,
      ]);
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
  }

  function exportConsolidated() {
    exportConsolidatedWorkbook(payroll);
    showNotice("success", "Consolidado exportado a Excel.");
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
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      standardHoursPerDay: Number(event.target.value || 0),
                    }))
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
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      overtimeMultiplier: Number(event.target.value || 0),
                    }))
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

      <nav
        className={isMarkingMode ? "tab-bar tab-bar-terminal" : "tab-bar"}
        aria-label="Secciones principales"
      >
        {tabs.map((tab) => (
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

      {notice && !isMarkingMode ? (
        <div className={`notice notice-${notice.type}`}>{notice.text}</div>
      ) : null}

      {isMarkingMode ? (
        <main className="marking-shell">
          <section className="marking-hero">
            <div className="marking-copy">
              <span className="eyebrow">Terminal de marcacion</span>
              <h1>ESCANEA TU CEDULA</h1>
              <p>
                Esta pantalla esta dedicada solo a marcar entrada o salida.
                Escanea la cedula del colaborador y el sistema decide
                automaticamente si abre o cierra el turno.
              </p>

              <div className="clock-display">
                <span>{clockDate}</span>
                <strong>{clockTime}</strong>
              </div>

              <div className="terminal-strip">
                <span>{Object.keys(activeRecords).length} turno(s) abiertos</span>
                <span>{payroll.processedRecords.length} registros esta semana</span>
              </div>
            </div>

            <section className="scanner-card">
              <div className="scanner-top">
                <span className="scanner-badge">Entrada y salida automatica</span>
                <span className="scanner-meta">Escaner listo</span>
              </div>

              <form className="scanner-form" onSubmit={handleClockScan}>
                <label className="scanner-label" htmlFor="document-scan">
                  Cedula
                </label>
                <input
                  id="document-scan"
                  ref={scanInputRef}
                  className="scanner-input"
                  type="text"
                  autoComplete="off"
                  inputMode="text"
                  placeholder="Escanea tu cedula"
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value.toUpperCase())}
                />
                <button type="submit" className="scan-button">
                  Registrar marcacion
                </button>
              </form>

              <div
                className={
                  scanResult
                    ? `scan-feedback ${scanResult.type}`
                    : "scan-feedback idle"
                }
              >
                {scanResult ? (
                  <>
                    <span className="scan-feedback-kicker">{scanResult.title}</span>
                    <strong>{scanResult.detail}</strong>
                    <span>
                      {scanResult.movement
                        ? `${scanResult.movement} a las ${scanResult.timeLabel} - ${scanResult.dateLabel}`
                        : scanResult.detail}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="scan-feedback-kicker">Escaner activo</span>
                    <strong>Pasa la cedula del colaborador</strong>
                    <span>
                      Si no tiene turno abierto, marca entrada. Si ya entro,
                      marca salida.
                    </span>
                  </>
                )}
              </div>
            </section>
          </section>

          <section className="marking-grid">
            <article className="terminal-panel">
              <div className="terminal-panel-head">
                <div>
                  <span className="panel-kicker">Ultimos movimientos</span>
                  <h2>Marcaciones recientes</h2>
                </div>
              </div>

              <div className="movement-list">
                {recentMovements.map((movement) => (
                  <div key={movement.id} className="movement-row">
                    <div>
                      <strong>{movement.collaborator.name}</strong>
                      <span>
                        {movement.collaborator.documentId} - {movement.dateLabel}
                      </span>
                    </div>
                    <div className="movement-meta">
                      <span
                        className={
                          movement.movement === "Entrada"
                            ? "movement-chip entry"
                            : "movement-chip exit"
                        }
                      >
                        {movement.movement}
                      </span>
                      <strong>{movement.timeLabel}</strong>
                    </div>
                  </div>
                ))}

                {recentMovements.length === 0 ? (
                  <p className="empty-state">
                    Aun no hay marcaciones registradas en esta terminal.
                  </p>
                ) : null}
              </div>
            </article>

            <article className="terminal-panel">
              <div className="terminal-panel-head">
                <div>
                  <span className="panel-kicker">Turnos abiertos</span>
                  <h2>Colaboradores dentro</h2>
                </div>
              </div>

              <div className="open-shift-list">
                {openShiftRows.map((entry) => (
                  <div key={`${entry.collaborator.id}-${entry.timeLabel}`} className="open-shift-row">
                    <div>
                      <strong>{entry.collaborator.name}</strong>
                      <span>{entry.collaborator.documentId}</span>
                    </div>
                    <div className="open-shift-time">
                      <span>{entry.dateLabel}</span>
                      <strong>{entry.timeLabel}</strong>
                    </div>
                  </div>
                ))}

                {openShiftRows.length === 0 ? (
                  <p className="empty-state">
                    No hay entradas pendientes de salida en este momento.
                  </p>
                ) : null}
              </div>
            </article>
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
                    <button type="submit" className="primary-button">
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
                    <span className="panel-kicker">Descargas</span>
                    <h2>Excel y colillas</h2>
                  </div>
                </div>

                <div className="report-stack">
                  <button
                    type="button"
                    className="primary-button"
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
