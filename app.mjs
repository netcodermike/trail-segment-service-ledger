import { readFileSync } from 'node:fs'

const millisecondsPerDay = 86_400_000;

function dateNumber(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    throw new Error('Calendar dates must use YYYY-MM-DD.');
  }
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date: ' + value);
  }
  return date.getTime() / millisecondsPerDay;
}

function dateText(day) {
  return new Date(day * millisecondsPerDay).toISOString().split('T')[0];
}

function analyze(data) {
  if (!Array.isArray(data?.segments) || !data.segments.length) {
    throw new Error('Supply at least one trail segment.');
  }
  const asOf = dateNumber(data.as_of);
  const names = new Set();
  const worklist = data.segments.map(segment => {
    if (typeof segment?.segment !== 'string' || !segment.segment.trim()) {
      throw new Error('Each segment needs a nonempty name.');
    }
    const name = segment.segment.trim();
    if (names.has(name)) throw new Error('Repeated segment: ' + name);
    names.add(name);
    const start = dateNumber(segment.tracked_from);
    const cadence = segment.interval_days;
    if (!Number.isInteger(cadence) || cadence < 1 || cadence > 3660 ||
        start > asOf || !Array.isArray(segment.services)) {
      throw new Error('Invalid tracking start, interval, or service list for ' + name);
    }
    const visits = [...new Set(segment.services.map(dateNumber))].sort((a, b) => a - b);
    if (visits.some(day => day < start || day > asOf)) {
      throw new Error('Service dates must be in the tracked window for ' + name);
    }

    let previous = start;
    const lateVisits = [];
    for (const visit of visits) {
      const due = previous + cadence;
      if (visit > due) lateVisits.push({
        due: dateText(due), serviced: dateText(visit), days_late: visit - due,
      });
      previous = visit;
    }
    const due = previous + cadence;
    return {
      due,
      row: {
        segment: name, due_date: dateText(due),
        status: due < asOf ? 'overdue' : due === asOf ? 'due_today' : 'upcoming',
        days_overdue: Math.max(0, asOf - due), visit_count: visits.length,
        last_serviced: visits.length ? dateText(previous) : null, late_visits: lateVisits,
      },
    };
  });
  worklist.sort((a, b) => a.due - b.due);
  const rows = worklist.map(item => item.row);
  return {
    as_of: data.as_of,
    overdue_segments: rows.filter(row => row.status === 'overdue').length,
    due_today_segments: rows.filter(row => row.status === 'due_today').length,
    historical_late_visits: rows.reduce((count, row) => count + row.late_visits.length, 0),
    worklist: rows,
  };
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node app.mjs input.json')
  console.log(JSON.stringify(analyze(JSON.parse(readFileSync(process.argv[2], 'utf8')))))
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}
