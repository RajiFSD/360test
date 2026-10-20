/** Parse ?page & ?pageSize into SQL limit/offset. */
function pagination(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

const ok = (res, data, meta, status = 200) => res.status(status).json(meta ? { data, meta } : { data });

/** "A,B , C" -> ['A','B','C'] filtered by an allow-list */
function csvList(value, allowed) {
  if (!value) return [];
  const list = String(value).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return allowed ? list.filter((v) => allowed.includes(v)) : list;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

module.exports = { pagination, ok, csvList, iso };
