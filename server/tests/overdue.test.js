const test = require('node:test');
const assert = require('node:assert/strict');
const { runOverdueCheck, escalationLevelFor } = require('../src/jobs/overdue.job');

const SETTINGS = { overdue_grace_min: 15, escalation_student_min: 15, escalation_warden_min: 30, escalation_parent_min: 60 };
const NOW = new Date('2026-10-20T18:00:00Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000);

/** In-memory fake of the job's data layer. */
function fakeDeps(trips) {
  const calls = { overdue: [], notified: [], levels: [] };
  return {
    calls,
    deps: {
      getSettings: async () => SETTINGS,
      findCandidates: async (now) => trips.filter((t) => ['ACTIVE', 'OVERDUE'].includes(t.status) && new Date(t.expected_return_at) < now),
      markOverdue: async (trip) => {
        calls.overdue.push(trip.id);
        trip.status = 'OVERDUE';
      },
      setEscalationLevel: async (id, level) => {
        calls.levels.push([id, level]);
        trips.find((t) => t.id === id).escalation_level = level;
      },
      notifyLevel: async (trip, level, minutesLate) => calls.notified.push({ id: trip.id, level, minutesLate }),
    },
  };
}

test('escalationLevelFor thresholds', () => {
  assert.equal(escalationLevelFor(5, SETTINGS), 0);
  assert.equal(escalationLevelFor(15, SETTINGS), 1);
  assert.equal(escalationLevelFor(45, SETTINGS), 2);
  assert.equal(escalationLevelFor(60, SETTINGS), 3);
  assert.equal(escalationLevelFor(600, SETTINGS), 3);
});

test('within grace: not overdue, no notifications', async () => {
  const trips = [{ id: 1, status: 'ACTIVE', escalation_level: 0, expected_return_at: minutesAgo(10) }];
  const { deps, calls } = fakeDeps(trips);
  const r = await runOverdueCheck({ now: NOW, deps });
  assert.equal(r.markedOverdue, 0);
  assert.deepEqual(calls.notified, []);
  assert.equal(trips[0].status, 'ACTIVE');
});

test('+20 min: marked OVERDUE and student notified (level 1)', async () => {
  const trips = [{ id: 2, status: 'ACTIVE', escalation_level: 0, expected_return_at: minutesAgo(20) }];
  const { deps, calls } = fakeDeps(trips);
  await runOverdueCheck({ now: NOW, deps });
  assert.deepEqual(calls.overdue, [2]);
  assert.deepEqual(calls.notified.map((n) => n.level), [1]);
  assert.equal(trips[0].escalation_level, 1);
});

test('first seen at +70 min: all three levels sent in order, once', async () => {
  const trips = [{ id: 3, status: 'ACTIVE', escalation_level: 0, expected_return_at: minutesAgo(70) }];
  const { deps, calls } = fakeDeps(trips);
  await runOverdueCheck({ now: NOW, deps });
  assert.deepEqual(calls.notified.map((n) => n.level), [1, 2, 3]);
  // second run: nothing new
  await runOverdueCheck({ now: NOW, deps });
  assert.deepEqual(calls.notified.map((n) => n.level), [1, 2, 3]);
  assert.deepEqual(calls.overdue, [3], 'marked overdue only once');
});

test('progressive escalation across runs (cron every 5 min)', async () => {
  const trips = [{ id: 4, status: 'ACTIVE', escalation_level: 0, expected_return_at: minutesAgo(16) }];
  const { deps, calls } = fakeDeps(trips);
  await runOverdueCheck({ now: NOW, deps });
  await runOverdueCheck({ now: new Date(NOW.getTime() + 5 * 60_000), deps }); // +21
  await runOverdueCheck({ now: new Date(NOW.getTime() + 15 * 60_000), deps }); // +31 -> warden
  await runOverdueCheck({ now: new Date(NOW.getTime() + 45 * 60_000), deps }); // +61 -> parent+security
  assert.deepEqual(calls.notified.map((n) => n.level), [1, 2, 3]);
  assert.deepEqual(calls.notified.map((n) => n.minutesLate), [16, 31, 61]);
});

test('completed / not-yet-due trips are ignored', async () => {
  const trips = [
    { id: 5, status: 'COMPLETED', escalation_level: 0, expected_return_at: minutesAgo(90) },
    { id: 6, status: 'ACTIVE', escalation_level: 0, expected_return_at: new Date(NOW.getTime() + 60_000) },
  ];
  const { deps, calls } = fakeDeps(trips);
  const r = await runOverdueCheck({ now: NOW, deps });
  assert.equal(r.checked, 0);
  assert.deepEqual(calls.notified, []);
});
