import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

const KEY = 'qr-connect-sqlite'
const file = path.resolve('db.sqlite')

export function databaseFile() {
  return file
}

function serviceCredentials() {
  if (!process.env.VCAP_SERVICES) return null
  const vcap = JSON.parse(process.env.VCAP_SERVICES)
  const list = [...(vcap['redis-cache'] || []), ...(vcap.redis || [])]
  const service = list.find((item) => item.name === 'qr-connect-cache' || item.instance_name === 'qr-connect-cache') || list[0]
  return service?.credentials || null
}

function credentialFields() {
  const credentials = serviceCredentials()
  return credentials ? Object.keys(credentials).join(', ') : 'none'
}

async function client() {
  const credentials = serviceCredentials()
  if (!credentials) return null
  const { createClient } = await import('redis')
  const connection = createClient({
    url: redisUrl(credentials),
    socket: { reconnectStrategy: false, connectTimeout: 10000 },
  })
  connection.on('error', (error) => console.error(`Redis: ${error.message}`))
  await connection.connect()
  return connection
}

function redisUrl(credentials) {
  const raw = credentials.uri || credentials.url || credentials.redis_url
  if (typeof raw === 'string' && raw) {
    const tls = credentials.tls === true || credentials.ssl === true
    if (tls && raw.startsWith('redis://')) return `rediss://${raw.slice('redis://'.length)}`
    return raw
  }
  const host = credentials.hostname || credentials.host
  const port = credentials.port || 6379
  const username = encodeURIComponent(credentials.username || credentials.user || '')
  const password = encodeURIComponent(credentials.password || '')
  const scheme = credentials.tls === false || credentials.ssl === false ? 'redis' : 'rediss'
  const auth = username ? `${username}:${password}` : `:${password}`
  return `${scheme}://${auth}@${host}:${port}`
}

export async function restoreDatabase() {
  let connection
  try {
    connection = await client()
    if (!connection) return
    const saved = await connection.get(KEY)
    if (!saved) {
      console.log('No saved database yet.')
      return
    }
    rmSync(`${file}-wal`, { force: true })
    rmSync(`${file}-shm`, { force: true })
    writeFileSync(file, Buffer.from(saved, 'base64'))
    console.log('Restored the saved database.')
  } catch (error) {
    console.error(`Database restore failed: ${error.message} (credential fields: ${credentialFields()})`)
  } finally {
    await connection?.quit().catch(() => {})
  }
}

export async function backupDatabase(bytes) {
  const connection = await client()
  if (!connection) return
  const body = bytes || (existsSync(file) ? readFileSync(file) : null)
  if (!body?.length) return
  try {
    await connection.set(KEY, Buffer.from(body).toString('base64'))
    console.log('Saved the database.')
  } catch (error) {
    console.error(`Database save failed: ${error.message} (credential fields: ${credentialFields()})`)
    throw error
  } finally {
    await connection.quit().catch(() => {})
  }
}
