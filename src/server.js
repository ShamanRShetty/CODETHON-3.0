const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { startCleanupJob } = require('./services/cleanup');

const authRoutes = require('./routes/auth');
const filesRoutes = require('./routes/files');
const sharesRoutes = require('./routes/shares');
const publicRoutes = require('./routes/public');
const dashboardRoutes = require('./routes/dashboard');
const notificationsRoutes = require('./routes/notifications');

const app = express();

// Trust proxy for proper IP handling behind reverse proxies (Render, Railway, Nginx, Fly)
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Mounted routers per ARCHITECTURE.md
app.use('/api/auth', authRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/shares', sharesRoutes);
app.use('/s', publicRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler - sanitize 500s in production
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = (process.env.NODE_ENV || config.NODE_ENV) === 'production';
  const message = status >= 500 && isProd ? 'Internal server error' : err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

if (require.main === module) {
  startCleanupJob();
  app.listen(config.PORT, () => {
    console.log(`VaultLink server listening on port ${config.PORT} (${config.BASE_URL})`);
  });
}

module.exports = app;

