import mongoose from 'mongoose';

// All Mongo access is centralized here. Swapping the connection target later
// (Atlas -> DocumentDB on AWS, adding TLS/SRV options, IAM auth, etc.) means
// touching only this file and MONGO_URI — nothing in models/controllers changes.

const RETRY_MS = 5000;
const MAX_STARTUP_ATTEMPTS = 12; // ~60s of retries on boot before giving up

let reconnectTimer = null;
let intentionalClose = false;

function mongoOptions() {
  return {
    // How long to try selecting a server before failing a single operation
    serverSelectionTimeoutMS: 15_000,
    // How long a socket can stay idle before being closed
    socketTimeoutMS: 45_000,
    // Prefer IPv4 — avoids some Windows DNS dual-stack ENOTFOUND flakes
    family: 4,
    // Keep trying to reach the cluster after transient network loss
    maxPoolSize: 10,
    minPoolSize: 0,
    // Heartbeats help detect dead connections faster
    heartbeatFrequencyMS: 10_000,
  };
}

function scheduleReconnect(uri) {
  if (intentionalClose) return;
  if (reconnectTimer) return;
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) return;

  console.warn(`[db] will retry connection in ${RETRY_MS / 1000}s…`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (intentionalClose) return;
    if (mongoose.connection.readyState === 1) return;
    try {
      await mongoose.connect(uri, mongoOptions());
      console.log(`[db] reconnected to MongoDB (${mongoose.connection.name})`);
    } catch (err) {
      console.error('[db] reconnect failed:', err.message);
      scheduleReconnect(uri);
    }
  }, RETRY_MS);
  if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
}

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
  }

  mongoose.set('strictQuery', true);
  // Do not buffer commands forever while offline — fail fast so the API
  // can return 503 instead of hanging the client.
  mongoose.set('bufferCommands', false);

  intentionalClose = false;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_STARTUP_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(uri, mongoOptions());
      console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.error(
        `[db] connection attempt ${attempt}/${MAX_STARTUP_ATTEMPTS} failed:`,
        err.message
      );
      if (attempt < MAX_STARTUP_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
  }

  if (lastErr) {
    console.error('[db] giving up on startup connection:', lastErr.message);
    console.error(
      '[db] Check: internet, Atlas cluster status, Network Access IP allowlist, MONGO_URI in .env'
    );
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected');
    scheduleReconnect(uri);
  });

  mongoose.connection.on('error', (err) => {
    console.error('[db] error:', err.message);
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[db] reconnected');
  });
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await mongoose.disconnect();
}
