import {
  calculateWorkedHours,
  formatCompactHours,
  getDayLabel,
  getMonday,
  getWeekEnd,
  isDateInWeek,
  roundWorkedHours,
  sumNumbers,
} from "./time";

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function isDirectOvertimeRecord(record) {
  return (
    record?.source === "manual-overtime" ||
    Number(record?.manualOvertimeHours || 0) > 0
  );
}

function getRecordSourceLabel(record) {
  if (isDirectOvertimeRecord(record)) {
    return "Horas directas";
  }

  return record?.source === "clock" ? "Marcacion" : "Manual";
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
      const directOvertimeHours = round(Number(record.manualOvertimeHours || 0));
      const directOvertime = isDirectOvertimeRecord(record);
      const workedHours = directOvertime
        ? directOvertimeHours
        : calculateWorkedHours(record);

      return {
        ...record,
        collaborator,
        dayLabel: getDayLabel(record.date),
        ordinaryRate,
        overtimeRate,
        isDirectOvertime: directOvertime,
        manualOvertimeHours: directOvertimeHours,
        sourceLabel: getRecordSourceLabel(record),
        statusLabel: directOvertime
          ? "Horas extras directas"
          : record.checkOut
            ? "Completo"
            : "Entrada abierta",
        workedHours: round(workedHours),
      };
    })
    .filter(Boolean)
    .sort(sortProcessedRecords);
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
        totalTimedWorkedHoursRaw: 0,
        totalManualOvertimeHours: 0,
        totalBreakMinutes: 0,
        lastMovementAt: "",
        lastMovementType: "",
      };

    current.records.push(record);
    if (record.isDirectOvertime) {
      current.totalManualOvertimeHours += Number(
        record.manualOvertimeHours || record.workedHours || 0
      );
    } else {
      current.totalTimedWorkedHoursRaw += Number(record.workedHours || 0);
    }
    current.totalBreakMinutes += Number(record.breakMinutes || 0);

    if (!record.isDirectOvertime && (record.checkIn || record.checkOut)) {
      const lastMovementAt = record.checkOut
        ? new Date(`${record.date}T${record.checkOut}:00`).toISOString()
        : new Date(`${record.date}T${record.checkIn || "00:00"}:00`).toISOString();

      if (!current.lastMovementAt || lastMovementAt > current.lastMovementAt) {
        current.lastMovementAt = lastMovementAt;
        current.lastMovementType = record.checkOut ? "Salida" : "Entrada";
      }
    }

    dailyMap.set(key, current);
  }

  return Array.from(dailyMap.values())
    .map((entry) => {
      const records = [...entry.records].sort(
        (left, right) => getRecordSortTime(left) - getRecordSortTime(right)
      );
      const openRecordCount = records.filter(
        (record) => !record.isDirectOvertime && !record.checkOut
      ).length;
      const completedRecordCount = records.filter(
        (record) => record.isDirectOvertime || record.checkOut
      ).length;

      let statusLabel = "Completo";
      if (openRecordCount > 0 && completedRecordCount > 0) {
        statusLabel = "Con turno abierto";
      } else if (openRecordCount > 0) {
        statusLabel = "Entrada abierta";
      } else if (
        records.length > 0 &&
        records.every((record) => record.isDirectOvertime)
      ) {
        statusLabel = "Horas extras directas";
      } else if (records.some((record) => record.isDirectOvertime)) {
        statusLabel = "Completo + horas directas";
      } else if (records.length > 1) {
        statusLabel = "Varios tramos";
      }

      const totalWorkedHoursRaw = round(entry.totalTimedWorkedHoursRaw);
      const timedWorkedHours = round(roundWorkedHours(totalWorkedHoursRaw));
      const manualOvertimeHours = round(entry.totalManualOvertimeHours);
      const totalWorkedHours = round(timedWorkedHours + manualOvertimeHours);

      return {
        ...entry,
        records,
        recordCount: records.length,
        openRecordCount,
        completedRecordCount,
        statusLabel,
        totalWorkedHoursRaw,
        timedWorkedHours,
        manualOvertimeHours,
        totalWorkedHours,
        scheduleLabel: records
          .map((record) =>
            record.isDirectOvertime
              ? `Horas extras directas: ${formatCompactHours(record.manualOvertimeHours || record.workedHours)} h`
              : record.checkOut
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

function buildWeeklySummaryRows(collaborators, dailySummaries, settings) {
  const weeklyHoursLimit = Math.max(getWeeklyHoursLimit(settings), 0);

  return collaborators.map((collaborator) => {
    const employeeDays = dailySummaries.filter(
      (summary) => summary.employeeId === collaborator.id
    );
    const timedWorkedHours = round(
      sumNumbers(employeeDays.map((summary) => summary.timedWorkedHours))
    );
    const manualOvertimeHours = round(
      sumNumbers(employeeDays.map((summary) => summary.manualOvertimeHours))
    );
    const totalWorkedHours = round(
      timedWorkedHours + manualOvertimeHours
    );
    const ordinaryHours = round(Math.min(timedWorkedHours, weeklyHoursLimit));
    const calculatedOvertimeHours = round(
      Math.max(timedWorkedHours - weeklyHoursLimit, 0)
    );
    const overtimeHours = round(
      calculatedOvertimeHours + manualOvertimeHours
    );
    const { ordinaryRate, overtimeRate } = buildRates(collaborator, settings);
    const totalPay = round(overtimeHours * overtimeRate);

    return {
      collaborator,
      salary: round(collaborator.salary),
      ordinaryRate,
      overtimeRate,
      timedWorkedHours,
      manualOvertimeHours,
      totalWorkedHours,
      ordinaryHours,
      calculatedOvertimeHours,
      overtimeHours,
      totalPay,
      dayCount: employeeDays.length,
      recordCount: employeeDays.reduce(
        (total, day) => total + day.records.length,
        0
      ),
    };
  });
}

function buildSummaryMap(summaryRows) {
  return new Map(summaryRows.map((row) => [row.collaborator.id, row]));
}

function buildDailySummaryMap(dailySummaries) {
  return new Map(
    dailySummaries.map((summary) => [`${summary.employeeId}__${summary.date}`, summary])
  );
}

function attachWeeklySummaryToDailyRows(
  dailySummaries,
  weeklySummaryMap,
  weeklyHoursLimit
) {
  return dailySummaries.map((summary) => {
    const weeklySummary = weeklySummaryMap.get(summary.employeeId);

    return {
      ...summary,
      weeklyTotalWorkedHours: round(weeklySummary?.totalWorkedHours || 0),
      weeklyOrdinaryHours: round(weeklySummary?.ordinaryHours || 0),
      weeklyOvertimeHours: round(weeklySummary?.overtimeHours || 0),
      weeklyOvertimePay: round(weeklySummary?.totalPay || 0),
      weeklyOvertimeRate: round(weeklySummary?.overtimeRate || 0),
      weeklyHoursLimit: round(weeklyHoursLimit),
    };
  });
}

function attachSummaryDataToRecords(records, dailySummaryMap, weeklySummaryMap) {
  return records.map((record) => {
    const dailySummary = dailySummaryMap.get(`${record.employeeId}__${record.date}`);
    const weeklySummary = weeklySummaryMap.get(record.employeeId);

    return {
      ...record,
      dayWorkedHours: round(dailySummary?.totalWorkedHours || 0),
      dayWorkedHoursRaw: round(dailySummary?.totalWorkedHoursRaw || 0),
      weeklyTotalWorkedHours: round(weeklySummary?.totalWorkedHours || 0),
      weeklyOrdinaryHours: round(weeklySummary?.ordinaryHours || 0),
      weeklyOvertimeHours: round(weeklySummary?.overtimeHours || 0),
      weeklyOvertimePay: round(weeklySummary?.totalPay || 0),
    };
  });
}

export function buildPayrollSnapshot(collaborators, records, settings) {
  const processedRecords = enrichRecords(collaborators, records, settings);
  const weekRecords = processedRecords.filter((record) =>
    isDateInWeek(record.date, settings.weekStart)
  );
  const dailySummaries = buildDailySummaries(weekRecords);
  const summaryRows = buildWeeklySummaryRows(collaborators, dailySummaries, settings);
  const weeklySummaryMap = buildSummaryMap(summaryRows);
  const dailySummaryMap = buildDailySummaryMap(dailySummaries);
  const processedWeekRecords = attachSummaryDataToRecords(
    weekRecords,
    dailySummaryMap,
    weeklySummaryMap
  );
  const weeklyHoursLimit = round(Math.max(getWeeklyHoursLimit(settings), 0));

  const activeClockCount = records.filter(
    (record) => !isDirectOvertimeRecord(record) && !record.checkOut
  ).length;
  const workersWithOvertime = summaryRows.filter((row) => row.overtimeHours > 0).length;

  return {
    processedRecords: processedWeekRecords,
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
          processedWeekRecords
            .filter((record) => !record.isDirectOvertime && !record.checkOut)
            .map((record) => record.workedHours)
        )
      ),
      weeklyHoursLimit,
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
  const reportWeekRecords = processedRecords.filter((record) =>
    isDateInWeek(record.date, reportWeekStart)
  );
  const weeklyDailySummaries = buildDailySummaries(reportWeekRecords);
  const weeklySummaryRows = buildWeeklySummaryRows(
    collaborators,
    weeklyDailySummaries,
    settings
  );
  const weeklySummaryMap = buildSummaryMap(weeklySummaryRows);
  const weeklyHoursLimit = round(Math.max(getWeeklyHoursLimit(settings), 0));
  const reportDayRecords = reportWeekRecords.filter(
    (record) => record.date === reportDate
  );
  const reportDaySummaries = buildDailySummaries(reportDayRecords).sort(
    (left, right) =>
      left.collaborator.name.localeCompare(right.collaborator.name) ||
      left.date.localeCompare(right.date)
  );
  const dailySummaryRows = attachWeeklySummaryToDailyRows(
    reportDaySummaries,
    weeklySummaryMap,
    weeklyHoursLimit
  );
  const daySummaryMap = buildDailySummaryMap(reportDaySummaries);
  const processedDayRecords = attachSummaryDataToRecords(
    reportDayRecords,
    daySummaryMap,
    weeklySummaryMap
  );
  const activeWeeklySummaries = dailySummaryRows
    .map((row) => weeklySummaryMap.get(row.employeeId))
    .filter(Boolean);

  return {
    reportDate,
    weekStart: reportWeekStart,
    weekEnd: getWeekEnd(reportWeekStart),
    processedRecords: processedDayRecords,
    summaryRows: dailySummaryRows,
    weeklySummaryRows,
    totals: {
      employeeCount: dailySummaryRows.length,
      recordCount: reportDayRecords.length,
      openCount: reportDayRecords.filter(
        (record) => !record.isDirectOvertime && !record.checkOut
      ).length,
      completedCount: reportDayRecords.filter(
        (record) => record.isDirectOvertime || record.checkOut
      ).length,
      workedHours: round(sumNumbers(dailySummaryRows.map((row) => row.totalWorkedHours))),
      ordinaryHours: round(
        sumNumbers(activeWeeklySummaries.map((row) => row.ordinaryHours))
      ),
      overtimeHours: round(
        sumNumbers(activeWeeklySummaries.map((row) => row.overtimeHours))
      ),
      totalPay: round(sumNumbers(activeWeeklySummaries.map((row) => row.totalPay))),
      weeklyHoursLimit,
    },
  };
}
