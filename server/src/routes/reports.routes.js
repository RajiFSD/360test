const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();

function range(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Invalid from/to date');
  // Treat a bare YYYY-MM-DD "to" as inclusive end of day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

const LATE = 'COALESCE(t.entry_at, t.completed_at) > DATE_ADD(o.expected_return_at, INTERVAL 15 MINUTE)';

router.get(
  '/summary',
  authenticate(),
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const { from, to } = range(req.query);
    const p = [from, to];
    const byStatus = await db.query('SELECT status, COUNT(*) AS count FROM outpass_requests WHERE created_at BETWEEN ? AND ? GROUP BY status', p);
    const byDay = await db.query(
      `SELECT DATE(DATE_ADD(o.created_at, INTERVAL 330 MINUTE)) AS d, COUNT(*) AS requests,
              SUM(o.status IN ('APPROVED','ACTIVE','OVERDUE','COMPLETED')) AS approved,
              SUM(t.status = 'COMPLETED' AND ${LATE}) AS late
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id
       WHERE o.created_at BETWEEN ? AND ? GROUP BY d ORDER BY d`,
      p,
    );
    const byCat = await db.query(
      `SELECT o.reason_category AS category, COUNT(*) AS count,
              AVG(CASE WHEN t.status = 'COMPLETED' THEN ${LATE} END) AS late_rate
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id
       WHERE o.created_at BETWEEN ? AND ? GROUP BY o.reason_category ORDER BY count DESC`,
      p,
    );
    const k = await db.one(
      `SELECT AVG(CASE WHEN o.reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, o.created_at, o.reviewed_at) END) / 60 AS avg_approval,
              AVG(CASE WHEN t.status = 'COMPLETED' THEN NOT (${LATE}) END) AS on_time, COUNT(*) AS total
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id WHERE o.created_at BETWEEN ? AND ?`,
      p,
    );
    ok(res, {
      from: from.toISOString(),
      to: to.toISOString(),
      total: Number(k.total),
      by_status: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      by_day: byDay.map((r) => ({
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        requests: Number(r.requests),
        approved: Number(r.approved || 0),
        late: Number(r.late || 0),
      })),
      by_category: byCat.map((r) => ({ category: r.category, count: Number(r.count), late_rate: Number(Number(r.late_rate || 0).toFixed(3)) })),
      avg_approval_minutes: k.avg_approval != null ? Math.round(Number(k.avg_approval)) : null,
      on_time_rate: k.on_time != null ? Number(Number(k.on_time).toFixed(3)) : null,
    });
  }),
);

const EXPORTS = {
  outpasses: {
    title: 'Outpass requests',
    sql: `SELECT o.id, s.roll_no, s.name AS student, o.reason_category, o.destination_type, o.dest_address, o.status,
                 o.depart_at, o.expected_return_at, o.risk_score, rv.name AS reviewer, o.reviewed_at, o.remarks, o.created_at
          FROM outpass_requests o JOIN users s ON s.id = o.student_id LEFT JOIN users rv ON rv.id = o.reviewed_by
          WHERE o.created_at BETWEEN ? AND ? ORDER BY o.created_at DESC LIMIT 20000`,
    pdfCols: ['id', 'roll_no', 'student', 'reason_category', 'status', 'depart_at', 'expected_return_at', 'risk_score'],
  },
  trips: {
    title: 'Trips',
    sql: `SELECT t.id, s.roll_no, s.name AS student, t.status, t.exit_at, t.reached_destination_at, t.returned_at, t.entry_at,
                 o.expected_return_at, GREATEST(0, TIMESTAMPDIFF(MINUTE, o.expected_return_at, COALESCE(t.entry_at, t.completed_at))) AS delay_min,
                 t.escalation_level
          FROM trips t JOIN outpass_requests o ON o.id = t.request_id JOIN users s ON s.id = o.student_id
          WHERE t.created_at BETWEEN ? AND ? ORDER BY t.id DESC LIMIT 20000`,
    pdfCols: ['id', 'roll_no', 'student', 'status', 'exit_at', 'entry_at', 'expected_return_at', 'delay_min'],
  },
  gate_logs: {
    title: 'Gate logs',
    sql: `SELECT g.id, g.scanned_at, g.type, g.result, g.method, gu.name AS guard, s.roll_no, s.name AS student, g.trip_id
          FROM gate_logs g JOIN users gu ON gu.id = g.guard_id LEFT JOIN trips t ON t.id = g.trip_id
          LEFT JOIN outpass_requests o ON o.id = t.request_id LEFT JOIN users s ON s.id = o.student_id
          WHERE g.scanned_at BETWEEN ? AND ? ORDER BY g.scanned_at DESC LIMIT 20000`,
    pdfCols: ['id', 'scanned_at', 'type', 'result', 'guard', 'roll_no', 'student'],
  },
};

const fmt = (v) => (v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 16) : v == null ? '' : String(v));
const csvCell = (v) => {
  const s = fmt(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

router.get(
  '/export',
  authenticate({ allowQueryToken: true }),
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const spec = EXPORTS[req.query.type];
    if (!spec) throw badRequest('type must be outpasses, trips or gate_logs');
    const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
    const { from, to } = range(req.query);
    const rows = await db.query(spec.sql, [from, to]);
    const filename = `smartoutpass-${req.query.type}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.${format}`;
    await audit(req, 'REPORT_EXPORTED', 'report', req.query.type, { format, rows: rows.length });

    if (format === 'csv') {
      const cols = rows.length ? Object.keys(rows[0]) : spec.pdfCols;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send([cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n'));
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    doc.pipe(res);
    doc.fontSize(16).text(`SmartOutpass — ${spec.title}`);
    doc.fontSize(9).fillColor('#555').text(`${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} · ${rows.length} rows · generated ${new Date().toISOString()}`);
    doc.moveDown();
    const cols = spec.pdfCols;
    const width = (doc.page.width - 60) / cols.length;
    const drawRow = (values, bold) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111');
      values.forEach((v, i) => doc.text(fmt(v).slice(0, 40), 30 + i * width, y, { width: width - 4, height: 12, ellipsis: true, lineBreak: false }));
      doc.y = y + 14;
      if (doc.y > doc.page.height - 40) {
        doc.addPage();
        drawHeader();
      }
    };
    const drawHeader = () => drawRow(cols, true);
    drawHeader();
    rows.slice(0, 2000).forEach((r) => drawRow(cols.map((c) => r[c])));
    if (rows.length > 2000) doc.moveDown().text(`… ${rows.length - 2000} more rows: use CSV export for the full data.`, 30);
    doc.end();
  }),
);

module.exports = router;
