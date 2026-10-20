const { AppError } = require('../utils/errors');
const config = require('../config');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'File too large' } });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists' } });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Related record constraint failed' } });
  }
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', details: config.env === 'development' ? err.message : undefined },
  });
}

module.exports = { notFoundHandler, errorHandler };
