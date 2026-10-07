'use strict';

const { generateOrderCode } = require('./idGenerator.service');

/**
 * Race-safe order number generation using the centralized ID generator.
 * Format: LD-YYYY-MMDD-#### (e.g. LD-2026-1006-0001)
 */
async function nextOrderCode(date = new Date()) {
  return generateOrderCode(date);
}

module.exports = { nextOrderCode };
