import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const RUNNING = ['scanning', 'validating']

export function openPublicationJobs(dataRoot) {
  mkdirSync(dataRoot, { recursive: true })
  const db = new DatabaseSync(join(dataRoot, 'unified.sqlite'))
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      BEGIN IMMEDIATE;
    `)
    const { user_version: version } = db.prepare('PRAGMA user_version').get()
    if (version > 5) throw new Error('无法打开较新版本的统一数据 SQLite')
    if (version === 0) db.exec(`
      CREATE TABLE publication_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        vault_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        attempt TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('scanning', 'validating', 'ready', 'invalid', 'unavailable')),
        result TEXT NOT NULL,
        UNIQUE (vault_id, account_id, idempotency_key)
      ) STRICT;
      CREATE UNIQUE INDEX publication_jobs_single_writer ON publication_jobs ((1))
        WHERE state IN ('scanning', 'validating');
      CREATE TABLE publication_grants (
        vault_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (vault_id, account_id)
      ) STRICT;
      PRAGMA user_version = 1;
    `)
    if (version < 2) db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        account_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sessions (
        digest TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX sessions_seen ON sessions(last_seen_at);
      CREATE INDEX sessions_account ON sessions(account_id);
      CREATE TABLE runtime_metadata (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
      PRAGMA user_version = 2;
    `)
    if (version < 3) db.exec(`
      CREATE TABLE learning_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id), vault_id TEXT NOT NULL,
        change_id TEXT NOT NULL, event_json TEXT NOT NULL,
        UNIQUE (account_id, change_id)
      ) STRICT;
      CREATE INDEX learning_events_scope ON learning_events(account_id, vault_id, sequence);
      CREATE TABLE learning_idempotency (
        account_id TEXT NOT NULL REFERENCES accounts(id), change_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
        PRIMARY KEY (account_id, change_id)
      ) STRICT;
      CREATE TABLE learning_revisions (
        account_id TEXT NOT NULL REFERENCES accounts(id), vault_id TEXT NOT NULL,
        entity_key TEXT NOT NULL, sequence INTEGER NOT NULL REFERENCES learning_events(sequence),
        PRIMARY KEY (account_id, vault_id, entity_key)
      ) STRICT;
      CREATE TABLE learning_conflicts (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id), vault_id TEXT NOT NULL,
        details_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX learning_conflicts_scope ON learning_conflicts(account_id, vault_id);
      PRAGMA user_version = 3;
    `)
    if (version < 4) db.exec(`
      CREATE TABLE vault_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        record_json TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 4;
    `)
    if (version < 5) db.exec(`
      CREATE TABLE learning_checkins (
        account_id TEXT NOT NULL REFERENCES accounts(id), vault_id TEXT NOT NULL,
        local_date TEXT NOT NULL, time_zone TEXT NOT NULL,
        sequence INTEGER NOT NULL REFERENCES learning_events(sequence),
        PRIMARY KEY (account_id, vault_id, local_date, time_zone)
      ) STRICT;
      INSERT INTO learning_checkins
      SELECT account_id, vault_id, json_extract(event_json, '$.change.localDate'),
        json_extract(event_json, '$.change.timeZone'), min(sequence)
      FROM learning_events
      WHERE json_extract(event_json, '$.change.kind') = 'learning.checkin.recorded'
      GROUP BY account_id, vault_id, json_extract(event_json, '$.change.localDate'),
        json_extract(event_json, '$.change.timeZone');
      PRAGMA user_version = 5;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.close()
    throw error
  }

  const locate = db.prepare('SELECT id, request_hash, result FROM publication_jobs WHERE vault_id = ? AND account_id = ? AND idempotency_key = ?')
  const running = db.prepare("SELECT id, attempt, result FROM publication_jobs WHERE state IN ('scanning', 'validating')")
  const insert = db.prepare('INSERT INTO publication_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const select = db.prepare('SELECT account_id, vault_id, state, result FROM publication_jobs WHERE id = ?')
  const finish = db.prepare("UPDATE publication_jobs SET state = ?, result = ? WHERE id = ? AND attempt = ? AND state IN ('scanning', 'validating')")
  const getAttempt = db.prepare('SELECT attempt, state, result FROM publication_jobs WHERE id = ?')

  function reserve({ vaultId, accountId, key, requestHash, dryRun, rateLimited = false, active = false }) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const prior = locate.get(vaultId, accountId, key)
      let outcome
      if (prior) {
        outcome = prior.request_hash === requestHash
          ? { reused: true, job: JSON.parse(prior.result) }
          : { code: 'idempotency_conflict' }
      } else if (rateLimited) {
        outcome = { code: 'sync_rate_limited' }
      } else if (active || running.get()) {
        outcome = { code: 'publish_busy' }
      } else {
        const job = {
          jobId: randomUUID(), status: 'scanning', dryRun, published: false,
          startedAt: new Date().toISOString(), finishedAt: null, error: null, summary: null,
        }
        const attempt = randomUUID()
        insert.run(job.jobId, vaultId, accountId, key, requestHash, attempt, job.status, JSON.stringify(job))
        outcome = { reused: false, job, attempt }
      }
      db.exec('COMMIT')
      return outcome
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function complete(jobId, attempt, result) {
    if (RUNNING.includes(result.status)) throw new Error('发布作业缺少终态')
    const updated = finish.run(result.status, JSON.stringify(result), jobId, attempt)
    if (updated.changes === 1) return
    const prior = getAttempt.get(jobId)
    if (prior?.attempt !== attempt || prior?.state !== result.status || prior?.result !== JSON.stringify(result)) {
      throw new Error('发布作业已失效或终态不一致')
    }
  }

  function get(jobId, { vaultId, accountId, isOwner }) {
    const row = select.get(jobId)
    if (!row || row.vault_id !== vaultId || (!isOwner && row.account_id !== accountId)) return null
    return JSON.parse(row.result)
  }

  function recoverInterrupted() {
    const prior = running.get()
    if (!prior) return
    complete(prior.id, prior.attempt, {
      ...JSON.parse(prior.result), status: 'unavailable', finishedAt: new Date().toISOString(),
      error: { code: 'publish_interrupted', message: '服务重启前作业未完成，请重新提交' },
    })
  }

  const findGrant = db.prepare('SELECT 1 FROM publication_grants WHERE vault_id = ? AND account_id = ?')
  return { database: db, reserve, complete, get, recoverInterrupted, canPublish: (vaultId, accountId) => Boolean(findGrant.get(vaultId, accountId)), close: () => db.close() }
}
