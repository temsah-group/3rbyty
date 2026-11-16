import dns from 'node:dns';
import { setTimeout as sleep } from 'node:timers/promises';

import mongoose from 'mongoose';

import { createApp } from './app.js';
import { logger } from './common/logger.js';
import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { syncAdminAccounts } from './modules/admin/admin-accounts.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const STARTUP_ATTEMPTS = 6;

/**
 * Runs a startup step again when it fails (a flaky network to MongoDB
 * Atlas), waiting a little longer each time, before giving up.
 */
async function withRetry<T>(step: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= STARTUP_ATTEMPTS) throw error;
      const waitMs = attempt * 2_000;
      logger.warn('Startup step failed, retrying', {
        step,
        attempt,
        of: STARTUP_ATTEMPTS,
        retryInMs: waitMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(waitMs);
    }
  }
}

async function main() {
  const env = loadEnv();
  const connection = await withRetry('connect to MongoDB', async () => {
    const attempt = mongoose.createConnection(env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    try {
      return await attempt.asPromise();
    } catch (error) {
      await attempt.close().catch(() => {});
      throw error;
    }
  });
  const container = createContainer(connection, env);
  // Unique indexes (one account per email) must exist before the first write.
  await withRetry('sync indexes', () =>
    Promise.all(Object.values(container.models).map((model) => model.syncIndexes())),
  );
  if (env.ADMIN_ACCOUNTS.length) {
    if (!container.adminAuth) logger.warn('ADMIN_ACCOUNTS is set but ADMIN_JWT_SECRET is not; /admin is off');
    const { created, updated } = await withRetry('sync admin accounts', () =>
      syncAdminAccounts(container.models.Admin, env.ADMIN_ACCOUNTS),
    );
    if (created.length || updated.length) logger.info('Admin accounts from ADMIN_ACCOUNTS', { created, updated });
  }
  // The cars owners saved, before the first part is checked against them;
  // then every minute, in case another server saved new ones.
  await withRetry('load settings', () => container.settings.current());
  setInterval(() => void container.settings.current().catch(() => {}), 60_000).unref();

  const app = createApp(container);
  const server = app.listen(env.PORT, () => {
    logger.info('3arabity API listening', { port: env.PORT, env: env.NODE_ENV });
  });
  // Above typical load-balancer idle timeouts, so they close first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      connection.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('Startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
