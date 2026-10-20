/**
 * Fan-out notifications to IN_APP (Socket.IO + inbox), PUSH (Expo) and optional SMS.
 * Every delivery attempt is logged in `notifications`.
 */
const db = require('../db');
const config = require('../config');
const settings = require('./settings.service');
const { emitTo, rooms } = require('../realtime');
const { getSmsProvider } = require('./sms');
const { iso } = require('../utils/http');

/** Parents may only ever receive these event types (privacy rule, enforced here). */
const PARENT_ALLOWED = new Set(['REQUEST_APPROVED', 'DEPARTED', 'REACHED_DESTINATION', 'RETURNED_CAMPUS', 'OVERDUE']);

const isExpoToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t);

async function sendExpoPush(messages) {
  if (!messages.length || config.isTest) return messages.map(() => ({ status: 'SKIPPED', error: config.isTest ? 'test mode' : null }));
  const results = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(chunk),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        chunk.forEach(() => results.push({ status: 'FAILED', error: `Expo ${res.status}` }));
        continue;
      }
      (json.data || []).forEach((ticket) =>
        results.push(ticket.status === 'ok' ? { status: 'SENT' } : { status: 'FAILED', error: ticket.message || 'push error' }),
      );
    } catch (err) {
      chunk.forEach(() => results.push({ status: 'FAILED', error: err.message }));
    }
  }
  return results;
}

/**
 * @param {object} opts
 * @param {number[]} opts.userIds
 * @param {string} opts.type notification type
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {number} [opts.tripId]
 * @param {object} [opts.data]
 * @param {boolean} [opts.sms] also send SMS when sms_enabled
 * @returns {Promise<number>} number of users notified
 */
async function notify({ userIds, type, title, body, tripId = null, data = {}, sms = false }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const users = await db.query('SELECT id, role, phone, push_token FROM users WHERE id IN (?) AND is_active = 1', [ids]);
  const recipients = users.filter((u) => u.role !== 'parent' || PARENT_ALLOWED.has(type));
  if (!recipients.length) return 0;

  const payloadData = { ...data, type, ...(tripId ? { tripId } : {}) };
  const json = JSON.stringify(payloadData);

  // 1) In-app inbox + realtime
  for (const u of recipients) {
    const result = await db.query(
      "INSERT INTO notifications (user_id, trip_id, type, title, body, data, channel, status) VALUES (?, ?, ?, ?, ?, ?, 'IN_APP', 'SENT')",
      [u.id, tripId, type, title, body, json],
    );
    emitTo(rooms.user(u.id), 'notification', {
      id: result.insertId,
      type,
      title,
      body,
      trip_id: tripId,
      data: payloadData,
      read_at: null,
      created_at: iso(new Date()),
    });
  }

  // 2) Expo push
  const pushTargets = recipients.filter((u) => isExpoToken(u.push_token));
  if (pushTargets.length) {
    const messages = pushTargets.map((u) => ({ to: u.push_token, title, body, data: payloadData, sound: 'default', priority: 'high' }));
    const results = await sendExpoPush(messages);
    for (let i = 0; i < pushTargets.length; i++) {
      await db.query(
        "INSERT INTO notifications (user_id, trip_id, type, title, body, data, channel, status, error) VALUES (?, ?, ?, ?, ?, ?, 'PUSH', ?, ?)",
        [pushTargets[i].id, tripId, type, title, body, json, results[i]?.status || 'FAILED', results[i]?.error || null],
      );
    }
  }

  // 3) SMS (optional, high-priority events only)
  if (sms && (await settings.get('sms_enabled'))) {
    const provider = getSmsProvider();
    for (const u of recipients.filter((r) => r.phone)) {
      let status = 'SENT';
      let error = null;
      try {
        const r = await provider.send(u.phone, `${title}: ${body}`);
        if (r?.skipped) status = 'SKIPPED';
      } catch (err) {
        status = 'FAILED';
        error = err.message.slice(0, 500);
      }
      await db.query(
        "INSERT INTO notifications (user_id, trip_id, type, title, body, data, channel, status, error) VALUES (?, ?, ?, ?, ?, ?, 'SMS', ?, ?)",
        [u.id, tripId, type, title, body, json, status, error],
      );
    }
  }
  return recipients.length;
}

module.exports = { notify, PARENT_ALLOWED, isExpoToken, sendExpoPush };
