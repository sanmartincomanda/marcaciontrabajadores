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

export function buildPayrollSnapshot(collaborators, records, settings) {
  const collaboratorById = Object.fromEntries(
    collaborators.map((collaborator) => [collaborator.id, collaborator])
  );

  const weekRecords = records
    .filter((record) => isDateInWeek(record.date, settings.weekStart))
    .map((record) => {
      const collaborator = collaboratorById[record.employeeId];
      if (!collaborator) {
        return null;
      }

      const ordinaryRate = collaborator.salary / 30 / 8;
      const overtimeRate = ordinaryRate * Number(settings.overtimeMultiplier || 2);
      const workedHours = calculateWorkedHours(record);

      return {
        ...record,
        collaborator,
        dayLabel: getDayLabel(record.date),
        ordinaryRate: round(ordinaryRate),
        overtimeRate: round(overtimeRate),
        workedHours: round(workedHours),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
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

      return (left.checkIn || "").localeCompare(right.checkIn || "");
    });

  const dailyMap = new Map();
  for (const record of weekRecords) {
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
      };

    current.records.push(record);
    current.totalWorkedHours += record.workedHours;
    current.totalBreakMinutes += Number(record.breakMinutes || 0);
    dailyMap.set(key, current);
  }

  const dailySummaries = Array.from(dailyMap.values())
    .map((entry) => {
      const overtimeHours = Math.max(
        entry.totalWorkedHours - Number(settings.standardHoursPerDay || 8),
        0
      );
      const overtimePay = overtimeHours * entry.overtimeRate;

      return {
        ...entry,
        totalWorkedHours: round(entry.totalWorkedHours),
        overtimeHours: round(overtimeHours),
        overtimePay: round(overtimePay),
        scheduleLabel: entry.records
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
    const ordinaryRate = collaborator.salary / 30 / 8;
    const overtimeRate = ordinaryRate * Number(settings.overtimeMultiplier || 2);

    return {
      collaborator,
      salary: round(collaborator.salary),
      ordinaryRate: round(ordinaryRate),
      overtimeRate: round(overtimeRate),
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
