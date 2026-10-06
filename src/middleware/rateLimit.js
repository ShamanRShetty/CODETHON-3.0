const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

function createLimiter(windowMs, max, message) {
  if (isTest) {
    // In test mode, allow high limits to avoid flaky test suites
    return (req, res, next) => next();
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || 'Too many requests, please try again later' },
  });
}

const loginLimiter = createLimiter(15 * 60 * 1000, 20, 'Too many login attempts. Please try again later.');
const registerLimiter = createLimiter(60 * 60 * 1000, 10, 'Too many registration attempts. Please try again later.');
const otpRequestLimiter = createLimiter(15 * 60 * 1000, 15, 'Too many OTP requests. Please try again later.');
const otpVerifyLimiter = createLimiter(15 * 60 * 1000, 20, 'Too many OTP verification attempts. Please try again later.');
const downloadLimiter = createLimiter(60 * 1000, 30, 'Too many download requests. Please try again later.');

module.exports = {
  loginLimiter,
  registerLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  downloadLimiter,
  createLimiter,
};
