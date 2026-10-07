const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const BrevoProvider = require('./BrevoProvider');
const DevelopmentEmailProvider = require('./DevelopmentEmailProvider');

function getEmailProvider() {
  if (env.BREVO_API_KEY) {
    logger.info('[email] Using BrevoProvider');
    return new BrevoProvider();
  }
  if (env.isProduction) {
    throw new Error('BREVO_API_KEY required in production. Refusing DevelopmentEmailProvider.');
  }
  logger.warn('[email] No BREVO_API_KEY — using DevelopmentEmailProvider (dev only)');
  return new DevelopmentEmailProvider();
}

module.exports = { getEmailProvider };