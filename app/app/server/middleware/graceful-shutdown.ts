// server/middleware/graceful-shutdown.ts
// ═══════════════════════════════════════════════════════════════
// QA/QC Master Plan §10.1 DEP-08, §11.1 DR-01
// Graceful shutdown: in-flight requests complete before termination
// ═══════════════════════════════════════════════════════════════

import type { Server } from 'http';

let isShuttingDown = false;
const activeConnections = new Set<any>();

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

export function trackConnection(socket: any): void {
  activeConnections.add(socket);
  socket.on('close', () => activeConnections.delete(socket));
}

export function setupGracefulShutdown(server: Server, options?: { timeout?: number }): void {
  const shutdownTimeout = options?.timeout ?? 30000; // 30s default

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n🛑 Received ${signal} — starting graceful shutdown...`);
    console.log(`   Active connections: ${activeConnections.size}`);
    console.log(`   Shutdown timeout: ${shutdownTimeout}ms`);

    // Stop accepting new connections
    server.close((err) => {
      if (err) {
        console.error('❌ Error closing server:', err);
        process.exit(1);
      }
      console.log('✅ Server closed — all in-flight requests completed');
      process.exit(0);
    });

    // Close idle keep-alive connections
    for (const socket of activeConnections) {
      if (!(socket as any)._httpMessage) {
        socket.destroy();
        activeConnections.delete(socket);
      }
    }

    // Force shutdown after timeout
    setTimeout(() => {
      console.warn(`⚠️ Forced shutdown after ${shutdownTimeout}ms — ${activeConnections.size} connections still active`);
      for (const socket of activeConnections) {
        socket.destroy();
      }
      process.exit(1);
    }, shutdownTimeout).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Track connections for graceful drain
  server.on('connection', (socket) => trackConnection(socket));

  console.log('✅ Graceful shutdown handlers registered (SIGTERM, SIGINT)');
}
