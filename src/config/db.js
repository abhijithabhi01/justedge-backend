import mongoose from 'mongoose';

// All Mongo access is centralized here. Swapping the connection target later
// (Atlas -> DocumentDB on AWS, adding TLS/SRV options, IAM auth, etc.) means
// touching only this file and MONGO_URI — nothing in models/controllers changes.
export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('error', (err) => console.error('[db] error:', err.message));
}
