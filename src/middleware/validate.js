/**
 * Express middleware to validate request data against a Zod schema.
 * Rejects invalid or unknown fields when schema.strict() is used.
 *
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} [source='body']
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const target = req[source];
    const result = schema.safeParse(target);

    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.length ? issue.path.join('.') + ': ' : ''}${issue.message}`)
        .join('; ');
      return res.status(400).json({ error: message || 'Validation error' });
    }

    req[source] = result.data;
    next();
  };
}

module.exports = {
  validate,
};
