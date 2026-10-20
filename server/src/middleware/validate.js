const { badRequest } = require('../utils/errors');

/**
 * Validate req[part] against a zod schema and replace it with the parsed value.
 * Usage: validate(schema) for body, validate(schema, 'query') for query string.
 */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(badRequest(details[0] ? `${details[0].path || part}: ${details[0].message}` : 'Invalid input', details));
    }
    if (part === 'query') {
      // req.query is a getter in Express 5-style setups; store parsed copy separately.
      req.validQuery = result.data;
    } else {
      req[part] = result.data;
    }
    next();
  };
}

module.exports = { validate };
