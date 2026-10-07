/**
 * Who/what initiated an order. Always determined server-side from the
 * authenticated session/request context - never accepted as a client
 *-provided field.
 */
const ORDER_SOURCE = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  CLIENT: 'CLIENT',
  SYSTEM: 'SYSTEM',
});

const ALL_ORDER_SOURCES = Object.values(ORDER_SOURCE);

module.exports = { ORDER_SOURCE, ALL_ORDER_SOURCES };
