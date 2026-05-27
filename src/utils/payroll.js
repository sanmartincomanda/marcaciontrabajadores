import {
  calculateWorkedHours,
  formatCompactHours,
  getDayLabel,
  getMonday,
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

function sortChronologicalRecords(left, right) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const checkInDiff = (left.checkIn || "").localeCompare(right.checkIn || "");
  if (checkInDiff !== 0) {
    return checkInDiff;
  }

  return (left.createdAt || "").localeCompare(right.createdAt || "");
}

function getWeeklyHoursLimit(settings) {
  if (settings.standardHoursPerWeek != null) {
    return Number(settings.standardHoursPerWeek);
  }

  if (settings.standardHoursPerDay != null) {
    return Number(settings.standardHoursPerDay || 8) * 6;
  }

  return 48;
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

function applyWeeklyOvertime(processedRecords, settings) {
  const recordsByEmployee = new Map();
  const weeklyHoursLimit = Math.max(getWeeklyHoursLimit(settings), 0);

  for (const record of processedRecords) {
    const employeeRecords = recordsByEmployee.get(record.employeeId) ?? [];
    employeeRecords.push(record);
    recordsByEmployee.set(record.employeeId, employeeRecords);
  }

  const allocatedRecords = [];

  for (const employeeRecords of recordsByEmployee.values()) {
    const orderedRecords = [...employeeRecords].sort(sortChronologicalRecords);
    let accumulatedWorkedHours = 0;

    for (const record of orderedRecords) {
      const availableOrdinaryHours = Math.max(
        weeklyHoursLimit - accumulatedWorkedHours,
        0
      );
      const ordinaryHours = Math.min(record.workedHours, availableOrdinaryHours);
      const overtimeHours = Math.max(record.workedHours - ordinaryHours, 0);

      accumulatedWorkedHours += record.workedHours;

      allocatedRecords.push({
        ...record,
        ordinaryHours: round(ordinaryHours),
        overtimeHours: round(overtimeHours),
        overtimePay: round(overtimeHours * record.overtimeRate),
        accumulatedWorkedHours: round(accumulatedWorkedHours),
      });
    }
  }

  return allocatedRecords.sort(sortProcessedRecords);
}

function buildDailySummaries(processedRecords) {
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
        ordinaryHours: 0,
        overtimeHours: 0,
        overtimePay: 0,
        totalBreakMinutes: 0,
        lastMovementAt: "",
        lastMovementType: "",
      };

    current.records.push(record);
    current.totalWorkedHours += record.workedHours;
    current.ordinaryHours += Number(record.ordinaryHours || 0);
    current.overtimeHours += Number(record.overtimeHours || 0);
    current.overtimePay += Number(record.overtimePay || 0);
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
        ordinaryHours: round(entry.ordinaryHours),
        overtimeHours: round(entry.overtimeHours),
        overtimePay: round(entry.overtimePay),
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
  const weekRecords = applyWeeklyOvertime(
    processedRecords.filter((record) =>
      isDateInWeek(record.date, settings.weekStart)
    ),
    settings
  );
  const dailySummaries = buildDailySummaries(weekRecords);

  const summaryRows = collaborators.map((collaborator) => {
    const employeeDays = dailySummaries.filter(
      (summary) => summary.employeeId === collaborator.id
    );

    const totalWorkedHours = sumNumbers(
      employeeDays.map((summary) => summary.totalWorkedHours)
    );
    const ordinaryHours = sumNumbers(
      employeeDays.map((summary) => summary.ordinaryHours)
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
      ordinaryHours: round(ordinaryHours),
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
      ordinaryHours: round(sumNumbers(summaryRows.map((row) => row.ordinaryHours))),
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
      weeklyHoursLimit: round(getWeeklyHoursLimit(settings)),
    },
  };
}

export function buildDailyMarkingSnapshot(
  collaborators,
  records,
  settings,
  reportDate
) {
  const processedRecords = enrichRecords(collaborators, records, settings);
  const reportWeekStart = getMonday(reportDate || new Date());
  const reportWeekRecords = applyWeeklyOvertime(
    processedRecords.filter((record) =>
      isDateInWeek(record.date, reportWeekStart)
    ),
    settings
  );
  const reportDayRecords = reportWeekRecords.filter(
    (record) => record.date === reportDate
  );
  const summaryRows = buildDailySummaries(reportDayRecords).sort(
    (left, right) =>
      left.collaborator.name.localeCompare(right.collaborator.name) ||
      left.date.localeCompare(right.date)
  );

  return {
    reportDate,
    weekStart: reportWeekStart,
    weekEnd: getWeekEnd(reportWeekStart),
    processedRecords: reportDayRecords,
    summaryRows,
    totals: {
      employeeCount: summaryRows.length,
      recordCount: reportDayRecords.length,
      openCount: reportDayRecords.filter((record) => !record.checkOut).length,
      completedCount: reportDayRecords.filter((record) => record.checkOut).length,
      workedHours: round(sumNumbers(summaryRows.map((row) => row.totalWorkedHours))),
      ordinaryHours: round(sumNumbers(summaryRows.map((row) => row.ordinaryHours))),
      overtimeHours: round(sumNumbers(summaryRows.map((row) => row.overtimeHours))),
      totalPay: round(sumNumbers(summaryRows.map((row) => row.overtimePay))),
      weeklyHoursLimit: round(getWeeklyHoursLimit(settings)),
    },
  };
}
