/**
 * Compute the status of a share.
 * Priority order: REVOKED > EXPIRED > LIMIT_REACHED > ACTIVE
 *
 * @param {Object} share
 * @param {number} [now]
 * @returns {'REVOKED' | 'EXPIRED' | 'LIMIT_REACHED' | 'ACTIVE'}
 */
function getStatus(share, now = Date.now()) {
  if (share.revoked_at != null) {
    return 'REVOKED';
  }
  if (now > share.expires_at) {
    return 'EXPIRED';
  }
  if (share.max_downloads != null && share.download_count >= share.max_downloads) {
    return 'LIMIT_REACHED';
  }
  return 'ACTIVE';
}

/**
 * Returns a parameterized SQL condition and parameters matching the status logic.
 *
 * @param {'REVOKED' | 'EXPIRED' | 'LIMIT_REACHED' | 'ACTIVE'} status
 * @param {number} [now]
 * @param {string} [tablePrefix]
 * @returns {{ sql: string, params: Array<number> }}
 */
function statusSqlCondition(status, now = Date.now(), tablePrefix = '') {
  const p = tablePrefix ? `${tablePrefix}.` : '';
  switch (status) {
    case 'REVOKED':
      return {
        sql: `${p}revoked_at IS NOT NULL`,
        params: [],
      };
    case 'EXPIRED':
      return {
        sql: `${p}revoked_at IS NULL AND ${p}expires_at < ?`,
        params: [now],
      };
    case 'LIMIT_REACHED':
      return {
        sql: `${p}revoked_at IS NULL AND ${p}expires_at >= ? AND ${p}max_downloads IS NOT NULL AND ${p}download_count >= ${p}max_downloads`,
        params: [now],
      };
    case 'ACTIVE':
      return {
        sql: `${p}revoked_at IS NULL AND ${p}expires_at >= ? AND (${p}max_downloads IS NULL OR ${p}download_count < ${p}max_downloads)`,
        params: [now],
      };
    default:
      throw new Error(`Invalid status: ${status}`);
  }
}

module.exports = {
  getStatus,
  statusSqlCondition,
  getStatusSqlFilter: statusSqlCondition,
};
