import { createHash } from 'node:crypto'

function tokenDigest(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createAccountStore(db) {
  const list = db.prepare('SELECT account_json FROM accounts ORDER BY id')
  const put = db.prepare('INSERT INTO accounts (id, account_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET account_json = excluded.account_json')
  const imported = db.prepare("SELECT 1 FROM runtime_metadata WHERE name = 'legacy_users_imported'")
  const markImported = db.prepare("INSERT INTO runtime_metadata VALUES ('legacy_users_imported', '1')")
  const getSession = db.prepare('SELECT account_id AS userId, created_at AS createdAt, last_seen_at AS lastSeenAt FROM sessions WHERE digest = ?')
  const putSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?) ON CONFLICT(digest) DO UPDATE SET created_at = excluded.created_at, last_seen_at = excluded.last_seen_at')
  const deleteSession = db.prepare('DELETE FROM sessions WHERE digest = ?')
  const deleteOtherSessions = db.prepare('DELETE FROM sessions WHERE account_id = ? AND digest != ?')
  const countSessions = db.prepare('SELECT count(*) AS count FROM sessions')
  const expireSessions = db.prepare('DELETE FROM sessions WHERE last_seen_at < ?')
  const trimSessions = db.prepare('DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions ORDER BY last_seen_at DESC, created_at DESC, digest LIMIT -1 OFFSET ?)')

  function importLegacy(accounts) {
    if (imported.get()) return
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!imported.get()) {
        if (!list.get()) {
          for (const account of accounts) put.run(account.id, JSON.stringify(account))
        }
        markImported.run()
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    imported: () => Boolean(imported.get()),
    importLegacy,
    users: () => list.all().map((row) => JSON.parse(row.account_json)),
    put: (account) => put.run(account.id, JSON.stringify(account)),
    sessions: {
      get: (token) => token && getSession.get(tokenDigest(token)),
      set: (token, session) => putSession.run(tokenDigest(token), session.userId, session.createdAt, session.lastSeenAt),
      delete: (token) => deleteSession.run(tokenDigest(token)),
      deleteOthers: (accountId, token) => deleteOtherSessions.run(accountId, tokenDigest(token ?? '')),
      count: () => countSessions.get().count,
      expire: (before) => Number(expireSessions.run(before).changes),
      trim: (max) => trimSessions.run(max),
    },
  }
}
