const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function requireAuth(req, res, next) {
  const token = req.cookies?.session;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const secret = process.env.JWT_SECRET || config.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const user = db.prepare('SELECT id, name, email, token_version FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userTokenVersion = user.token_version ?? 0;
    const decodedTokenVersion = decoded.tokenVersion ?? 0;
    if (userTokenVersion !== decodedTokenVersion) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = {
  requireAuth,
};
