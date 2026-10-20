/**
 * CSV bulk import for real institution data: students, parents, staff and parent-student links.
 *
 * preview(type, csvText)            -> per-row status without writing anything
 * commit(type, csvText, opts, req)  -> re-validates and inserts only rows that pass, in one transaction
 *
 * Row status: 'ok' (will be created), 'duplicate' (already exists, skipped), 'error' (fix and re-upload).
 * Imported users get a bcrypt-hashed temporary password and must change it on first login.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { badRequest } = require('../utils/errors');

const MAX_ROWS = 5000;

const TEMPLATES = {
  students: {
    columns: ['name', 'roll_no', 'email', 'phone', 'department', 'hostel'],
    required: ['name', 'roll_no', 'email'],
    example: [['Priya Raman', '21CS045', 'priya.raman@yourcollege.edu', '+919876543210', 'Computer Science & Engineering', 'Girls Hostel']],
  },
  parents: {
    columns: ['name', 'email', 'phone'],
    required: ['name', 'email'],
    example: [['Raman K', 'raman.k@gmail.com', '+919812345678']],
  },
  staff: {
    columns: ['name', 'role', 'email', 'phone', 'hostel'],
    required: ['name', 'role', 'email'],
    example: [
      ['Dr. S. Kumar', 'warden', 'skumar@yourcollege.edu', '+919800011122', 'Boys Hostel'],
      ['Prof. A. Devi', 'faculty', 'adevi@yourcollege.edu', '+919800011133', ''],
      ['Main Gate 1', 'security', 'gate1@yourcollege.edu', '+919800011144', ''],
    ],
  },
  links: {
    columns: ['student_roll_no', 'parent_phone_or_email', 'relation', 'verified'],
    required: ['student_roll_no', 'parent_phone_or_email', 'verified'],
    example: [['21CS045', 'raman.k@gmail.com', 'Father', 'true']],
  },
};

const STAFF_ROLES = ['warden', 'faculty', 'security'];
const TRUE = ['true', 'yes', 'y', '1'];
const FALSE = ['false', 'no', 'n', '0'];

const norm = (s) => String(s ?? '').trim();
const lower = (s) => norm(s).toLowerCase();
const digits = (s) => norm(s).replace(/\D/g, '');
const zodErrors = (r, field) => (r.success ? [] : r.error.issues.map((i) => `${field}: ${i.message.replace(new RegExp('^' + field + ' '), '')}`));

const emailSchema = z.string().trim().toLowerCase().email('not a valid email address').max(190);
const nameSchema = z.string().trim().min(2, 'must be at least 2 characters').max(120);
const phoneSchema = z.string().trim().max(30).regex(/^[+\d][\d\s-]{5,}$/, 'not a valid phone number').optional().or(z.literal(''));

function templateCsv(type) {
  const t = TEMPLATES[type];
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.columns.join(','), ...t.example.map((r) => r.map(esc).join(','))].join('\r\n') + '\r\n';
}

function parseCsv(type, text) {
  const t = TEMPLATES[type];
  if (!t) throw badRequest('Unknown import type. Use students, parents, staff or links.');
  if (!text || !text.trim()) throw badRequest('The CSV file is empty');
  let records;
  try {
    records = parse(text, { columns: (h) => h.map((c) => lower(c)), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    throw badRequest(`Invalid CSV: ${err.message}`);
  }
  if (!records.length) throw badRequest('The CSV has a header but no data rows');
  if (records.length > MAX_ROWS) throw badRequest(`Too many rows (${records.length}). Split the file into batches of ${MAX_ROWS}.`);
  const header = Object.keys(records[0]);
  const missing = t.required.filter((c) => !header.includes(c));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}. Expected: ${t.columns.join(', ')}`);
  // line numbers as seen in a spreadsheet (header = line 1)
  return records.map((r, i) => ({ line: i + 2, raw: r }));
}

/** Load lookup data once per run. */
async function loadContext(conn = db) {
  const [departments, hostels, users, links] = await Promise.all([
    conn.query('SELECT id, name, code FROM departments'),
    conn.query('SELECT h.id, h.name, h.warden_id, w.name AS warden_name FROM hostels h LEFT JOIN users w ON w.id = h.warden_id'),
    conn.query('SELECT id, role, name, email, phone, roll_no FROM users'),
    conn.query('SELECT parent_id, student_id FROM parent_student_links'),
  ]);
  return {
    deptByKey: new Map(departments.flatMap((d) => [[lower(d.name), d], [lower(d.code), d]])),
    hostelByName: new Map(hostels.map((h) => [lower(h.name), h])),
    emails: new Map(users.map((u) => [lower(u.email), u])),
    rolls: new Map(users.filter((u) => u.roll_no).map((u) => [lower(u.roll_no), u])),
    parents: users.filter((u) => u.role === 'parent'),
    links: new Set(links.map((l) => `${l.parent_id}:${l.student_id}`)),
  };
}

/** Validate every row. Returns rows with { line, status, data, errors, warnings, message }. */
function validateRows(type, rows, ctx) {
  const seen = new Map(); // in-file duplicate detection
  const firstSeen = (key, line) => {
    if (seen.has(key)) return seen.get(key);
    seen.set(key, line);
    return null;
  };

  return rows.map(({ line, raw }) => {
    const errors = [];
    const warnings = [];
    let data = {};
    let duplicate = null;

    if (type === 'students' || type === 'parents' || type === 'staff') {
      const name = nameSchema.safeParse(norm(raw.name));
      const email = emailSchema.safeParse(norm(raw.email));
      const phone = phoneSchema.safeParse(norm(raw.phone));
      errors.push(...zodErrors(name, 'name'), ...zodErrors(email, 'email'), ...zodErrors(phone, 'phone'));
      data = { name: name.data, email: email.data, phone: norm(raw.phone) || null };

      if (type === 'students') {
        const roll = norm(raw.roll_no).toUpperCase();
        if (!roll) errors.push('roll_no is required');
        else if (roll.length > 40) errors.push('roll_no is too long');
        data.roll_no = roll;
        data.role = 'student';
        if (norm(raw.department)) {
          const d = ctx.deptByKey.get(lower(raw.department));
          if (!d) errors.push(`unknown department "${norm(raw.department)}"`);
          else data.department_id = d.id;
        }
        if (norm(raw.hostel)) {
          const h = ctx.hostelByName.get(lower(raw.hostel));
          if (!h) errors.push(`unknown hostel "${norm(raw.hostel)}"`);
          else data.hostel_id = h.id;
        }
        if (roll) {
          if (ctx.rolls.has(lower(roll))) duplicate = `roll_no ${roll} already exists`;
          const prev = firstSeen(`roll:${lower(roll)}`, line);
          if (prev) errors.push(`roll_no repeated (first on line ${prev})`);
        }
      } else if (type === 'parents') {
        data.role = 'parent';
      } else {
        const role = lower(raw.role);
        if (!STAFF_ROLES.includes(role)) errors.push(`role must be one of ${STAFF_ROLES.join(', ')}`);
        data.role = role;
        if (norm(raw.hostel)) {
          if (role !== 'warden') errors.push('hostel can only be set for wardens');
          else {
            const h = ctx.hostelByName.get(lower(raw.hostel));
            if (!h) errors.push(`unknown hostel "${norm(raw.hostel)}"`);
            else {
              data.hostel_id = h.id;
              if (h.warden_id) warnings.push(`hostel "${h.name}" is currently assigned to ${h.warden_name}; it will be reassigned`);
              const prev = firstSeen(`hostel:${h.id}`, line);
              if (prev) errors.push(`hostel "${h.name}" already assigned to the warden on line ${prev}`);
            }
          }
        }
      }

      if (data.email) {
        if (ctx.emails.has(data.email)) duplicate = duplicate || `email ${data.email} already exists`;
        const prev = firstSeen(`email:${data.email}`, line);
        if (prev) errors.push(`email repeated (first on line ${prev})`);
      }
    } else if (type === 'links') {
      const roll = norm(raw.student_roll_no).toUpperCase();
      const key = norm(raw.parent_phone_or_email);
      const relation = norm(raw.relation);
      const verifiedRaw = lower(raw.verified);

      const student = roll ? ctx.rolls.get(lower(roll)) : null;
      if (!roll) errors.push('student_roll_no is required');
      else if (!student || student.role !== 'student') errors.push(`no student with roll_no ${roll}`);

      let parent = null;
      if (!key) errors.push('parent_phone_or_email is required');
      else if (key.includes('@')) {
        const u = ctx.emails.get(lower(key));
        if (!u || u.role !== 'parent') errors.push(`no parent with email ${key}`);
        else parent = u;
      } else {
        const d = digits(key);
        // Match on the last 10 digits so +91 / 0 prefixes don't matter.
        const matches = d.length >= 6 ? ctx.parents.filter((p) => p.phone && digits(p.phone).slice(-10) === d.slice(-10)) : [];
        if (!matches.length) errors.push(`no parent with phone ${key}`);
        else if (matches.length > 1) errors.push(`phone ${key} matches ${matches.length} parents; use the email instead`);
        else parent = matches[0];
      }

      let verified = null;
      if (TRUE.includes(verifiedRaw)) verified = true;
      else if (FALSE.includes(verifiedRaw)) verified = false;
      else errors.push('verified must be true/false (or yes/no, 1/0)');
      if (relation.length > 40) errors.push('relation is too long (max 40)');

      data = {
        student_roll_no: roll,
        student_id: student?.id,
        student_name: student?.name,
        parent_id: parent?.id,
        parent_name: parent?.name,
        relation: relation || null,
        verified,
      };
      if (student && parent) {
        if (ctx.links.has(`${parent.id}:${student.id}`)) duplicate = 'this parent is already linked to this student';
        const prev = firstSeen(`link:${parent.id}:${student.id}`, line);
        if (prev) errors.push(`same link repeated (first on line ${prev})`);
      }
    }

    const status = errors.length ? 'error' : duplicate ? 'duplicate' : 'ok';
    return { line, status, data, errors, warnings, message: errors.length ? errors.join('; ') : duplicate || (warnings.join('; ') || null) };
  });
}

function summarize(rows) {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: rows.filter((r) => r.status === 'error').length,
  };
}

async function preview(type, text) {
  const rows = parseCsv(type, text);
  const validated = validateRows(type, rows, await loadContext());
  return { type, columns: TEMPLATES[type].columns, summary: summarize(validated), rows: validated };
}

/** Readable random temporary password: 10 chars, no ambiguous characters, always mixed. */
function randomPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < 10) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * opts.tempPassword: one temporary password for everyone in this file (min 8 chars);
 * if omitted a random one is generated per user and returned once in `credentials`.
 */
async function commit(type, text, { tempPassword } = {}, actorId = null) {
  const parsed = parseCsv(type, text);
  if (tempPassword != null && tempPassword !== '' && String(tempPassword).length < 8) {
    throw badRequest('Temporary password must be at least 8 characters');
  }
  const sharedHash = tempPassword ? await bcrypt.hash(String(tempPassword), config.bcryptRounds) : null;

  return db.transaction(async (tx) => {
    // Validate against the state inside the transaction so nothing changed since preview slips through.
    const rows = validateRows(type, parsed, await loadContext(tx));
    const credentials = [];
    let created = 0;

    for (const row of rows) {
      if (row.status !== 'ok') continue;
      const d = row.data;
      if (type === 'links') {
        await tx.query(
          'INSERT INTO parent_student_links (parent_id, student_id, relation, verified, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
          [d.parent_id, d.student_id, d.relation, d.verified ? 1 : 0, d.verified ? actorId : null, d.verified ? new Date() : null],
        );
      } else {
        const plain = tempPassword ? null : randomPassword();
        const hash = sharedHash || (await bcrypt.hash(plain, config.bcryptRounds));
        const r = await tx.query(
          `INSERT INTO users (role, name, email, phone, password_hash, roll_no, department_id, hostel_id, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [d.role, d.name, d.email, d.phone, hash, d.roll_no || null, d.department_id || null, d.hostel_id || null],
        );
        if (d.role === 'warden' && d.hostel_id) await tx.query('UPDATE hostels SET warden_id = ? WHERE id = ?', [r.insertId, d.hostel_id]);
        credentials.push({ line: row.line, name: d.name, role: d.role, login: d.roll_no || d.email, email: d.email, temporary_password: plain || '(shared password)' });
      }
      row.result = 'created';
      created++;
    }

    return {
      type,
      created,
      skipped: rows.filter((r) => r.status === 'duplicate').length,
      failed: rows.filter((r) => r.status === 'error').length,
      summary: summarize(rows),
      rows,
      credentials,
    };
  });
}

module.exports = { TEMPLATES, templateCsv, preview, commit, randomPassword, validateRows, parseCsv };
