const env = require('../../config/portal');

function timestamp() {
  return new Date().toISOString();
}

function sanitise(arg) {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return env.isProduction
      ? { message: arg.message, code: arg.code }
      : { message: arg.message, stack: arg.stack, code: arg.code };
  }
  if (typeof arg === 'object') {
    const REDACT = new Set([
      'password','passwordHash','currentPassword','newPassword','confirmPassword',
      'token','refreshToken','accessToken','jwt','authorization','cookie',
      'apiKey','api_key','BREVO_API_KEY','MSG91_AUTH_KEY','RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET','STORAGE_SECRET_KEY','storageKey',
      'razorpaySignature','webhookSignature','secret',
    ]);
    const safe = {};
    for (const [k, v] of Object.entries(arg)) {
      safe[k] = REDACT.has(k) ? '[REDACTED]' : v;
    }
    return safe;
  }
  return arg;
}

function formatProd(level, args) {
  const sanitised = args.map(sanitise);
  return JSON.stringify({
    ts: timestamp(),
    level,
    msg: sanitised.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
  });
}

function formatDev(level, args) {
  return [`[${timestamp()}] ${level}`, ...args].join(' ');
}

const logger = {
  info(...args) {
    env.isProduction
      ? process.stdout.write(formatProd('INFO', args) + '\n')
      : console.log(formatDev('INFO', args));
  },
  warn(...args) {
    env.isProduction
      ? process.stdout.write(formatProd('WARN', args) + '\n')
      : console.warn(formatDev('WARN', args));
  },
  error(...args) {
    env.isProduction
      ? process.stderr.write(formatProd('ERROR', args) + '\n')
      : console.error(formatDev('ERROR', args));
  },
  debug(...args) {
    if (env.isDevelopment) console.debug(formatDev('DEBUG', args));
  },
};

module.exports = logger;