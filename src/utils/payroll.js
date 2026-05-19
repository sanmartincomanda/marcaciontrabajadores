import {
  calculateWorkedHours,
  formatCompactHours,
  getDayLabel,
  getWeekEnd,
  isDateInWeek,
  sumNumbers,
} from "./time";

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildCollaboratorById(collaborators) {
  return Object.fromEntries(
    collaborators.map((collaborator) => [collaborator.id, collaborator])
  );
}

function buildRates(collaborator, settings) {
  const ordinaryRate = collaborator.salary / 30 / 8;
  const overtimeRate = ordinaryRate * Number(settings.overtimeMultiplier || 2);

  return {
    ordinaryRate: round(ordinaryRate),
    overtimeRate: round(overtimeRate),
  };
}

function getRecordSortTime(record, field = "checkIn") {
  const timeValue = record?.[field] || record?.checkIn || "00:00";
  return new Date(`${record.date}T${timeValue}:00`).getTime();
}

function sortProcessedRecords(left, right) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const collaboratorDiff = left.collaborator.name.localeCompare(
    right.collaborator.name
  );
  if (collaboratorDiff !== 0) {
    return collaboratorDiff;
  }

  const checkInDiff = (left.checkIn || "").localeCompare(right.checkIn || "");
  if (checkInDiff !== 0) {
    return checkInDiff;
  }

  return (left.createdAt || "").localeCompare(right.createdAt || "");
}

function enrichRecords(collaborators, records, settings) {
  const collaboratorById = buildCollaboratorById(collaborators);

  return records
    .map((record) => {
      const collaborator = collaboratorById[record.employeeId];
      if (!collaborator) {
        return null;
      }

      const { ordinaryRate, overtimeRate } = buildRates(collaborator, settings);
      const workedHours = calculateWorkedHours(record);

      return {
        ...record,
        collaborator,
        dayLabel: getDayLabel(record.date),
        ordinaryRate,
        overtimeRate,
        workedHours: round(workedHours),
      };
    })
    .filter(Boolean)
    .sort(sortProcessedRecords);
}

function buildDailySummaries(processedRecords, settings) {
  const dailyMap = new Map();

  for (const record of processedRecords) {
    const key = `${record.employeeId}__${record.date}`;
    const current =
      dailyMap.get(key) ??
      {
        employeeId: record.employeeId,
        collaborator: record.collaborator,
        date: record.date,
        dayLabel: record.dayLabel,
        ordinaryRate: record.ordinaryRate,
        overtimeRate: record.overtimeRate,
        records: [],
        totalWorkedHours: 0,
        totalBreakMinutes: 0,
        lastMovementAt: "",
        lastMovementType: "",
      };

    current.records.push(record);
    current.totalWorkedHours += record.workedHours;
    current.totalBreakMinutes += Number(record.breakMinutes || 0);

    const lastMovementAt = record.checkOut
      ? new Date(`${record.date}T${record.checkOut}:00`).toISOString()
      : new Date(`${record.date}T${record.checkIn || "00:00"}:00`).toISOString();

    if (!current.lastMovementAt || lastMovementAt > current.lastMovementAt) {
      current.lastMovementAt = lastMovementAt;
      current.lastMovementType = record.checkOut ? "Salida" : "Entrada";
    }

    dailyMap.set(key, current);
  }

  return Array.from(dailyMap.values())
    .map((entry) => {
      const records = [...entry.records].sort((left, right) =>
        getRecordSortTime(left) - getRecordSortTime(right)
      );
      const overtimeHours = Math.max(
        entry.totalWorkedHours - Number(settings.standardHoursPerDay || 8),
        0
      );
      const overtimePay = overtimeHours * entry.overtimeRate;
      const openRecordCount = records.filter((record) => !record.checkOut).length;
      const completedRecordCount = records.length - openRecordCount;

      let statusLabel = "Completo";
      if (openRecordCount > 0 && completedRecordCount > 0) {
        statusLabel = "Con turno abierto";
      } else if (openRecordCount > 0) {
        statusLabel = "Entrada abierta";
      } else if (records.length > 1) {
        statusLabel = "Varios tramos";
      }

      return {
        ...entry,
        records,
        recordCount: records.length,
        openRecordCount,
        completedRecordCount,
        statusLabel,
        totalWorkedHours: round(entry.totalWorkedHours),
        overtimeHours: round(overtimeHours),
        overtimePay: round(overtimePay),
        scheduleLabel: records
          .map((record) =>
            record.checkOut
              ? `${record.checkIn} - ${record.checkOut}`
              : `${record.checkIn} - abierta`
          )
          .join(" / "),
      };
    })
    .sort((left, right) => {
      const dateDiff = left.date.localeCompare(right.date);
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return left.collaborator.name.localeCompare(right.collaborator.name);
    });
}

export function buildPayrollSnapshot(collaborators, records, settings) {
  const processedRecords = enrichRecords(collaborators, records, settings);
  const weekRecords = processedRecords.filter((record) =>
    isDateInWeek(record.date, settings.weekStart)
  );
  const dailySummaries = buildDailySummaries(weekRecords, settings);

  const summaryRows = collaborators.map((collaborator) => {
    const employeeDays = dailySummaries.filter(
      (summary) => summary.employeeId === collaborator.id
    );

    const totalWorkedHours = sumNumbers(
      employeeDays.map((summary) => summary.totalWorkedHours)
    );
    const overtimeHours = sumNumbers(
      employeeDays.map((summary) => summary.overtimeHours)
    );
    const totalPay = sumNumbers(employeeDays.map((summary) => summary.overtimePay));
    const { ordinaryRate, overtimeRate } = buildRates(collaborator, settings);

    return {
      collaborator,
      salary: round(collaborator.salary),
      ordinaryRate,
      overtimeRate,
      totalWorkedHours: round(totalWorkedHours),
      overtimeHours: round(overtimeHours),
      totalPay: round(totalPay),
      dayCount: employeeDays.length,
      recordCount: employeeDays.reduce(
        (total, day) => total + day.records.length,
        0
      ),
    };
  });

  const activeClockCount = records.filter((record) => !record.checkOut).length;
  const workersWithOvertime = summaryRows.filter((row) => row.overtimeHours > 0).length;

  return {
    processedRecords: weekRecords,
    dailySummaries,
    summaryRows,
    activeClockCount,
    workersWithOvertime,
    weekStart: settings.weekStart,
    weekEnd: getWeekEnd(settings.weekStart),
    totals: {
      workedHours: round(sumNumbers(summaryRows.map((row) => row.totalWorkedHours))),
      overtimeHours: round(sumNumbers(summaryRows.map((row) => row.overtimeHours))),
      totalPay: round(sumNumbers(summaryRows.map((row) => row.totalPay))),
      activeClockCount,
      workersWithOvertime,
      activeRecordsLabel: formatCompactHours(
        sumNumbers(
          weekRecords
            .filter((record) => !record.checkOut)
            .map((record) => record.workedHours)
        )
      ),
    },
  };
}

export function buildDailyMarkingSnapshot(
  collaborators,
  records,
  settings,
  reportDate
) {
  const processedRecords = enrichRecords(collaborators, records, settings).filter(
    (record) => record.date === reportDate
  );
  const summaryRows = buildDailySummaries(processedRecords, settings).sort(
    (left, right) =>
      left.collaborator.name.localeCompare(right.collaborator.name) ||
      left.date.localeCompare(right.date)
  );

  return {
    reportDate,
    processedRecords,
    summaryRows,
    totals: {
      employeeCount: summaryRows.length,
      recordCount: processedRecords.length,
      openCount: processedRecords.filter((record) => !record.checkOut).length,
      completedCount: processedRecords.filter((record) => record.checkOut).length,
      workedHours: round(sumNumbers(summaryRows.map((row) => row.totalWorkedHours))),
      overtimeHours: round(sumNumbers(summaryRows.map((row) => row.overtimeHours))),
      totalPay: round(sumNumbers(summaryRows.map((row) => row.overtimePay))),
    },
  };
}
