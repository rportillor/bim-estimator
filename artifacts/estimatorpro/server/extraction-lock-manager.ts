import { db } from './db';
import { sql } from 'drizzle-orm';

export class ExtractionLockManager {
  private static readonly LOCK_KEY = 'extraction_running';
  private static readonly LOCK_TIMEOUT = 900000; // 15 minutes (increased from 5)
  private static readonly HEARTBEAT_INTERVAL = 60000; // 1 minute heartbeat
  
  /**
   * Try to acquire extraction lock with enhanced timeout and heartbeat
   * Returns true if lock acquired, false if already locked
   */
  static async acquireLock(processId: string, timeoutMs: number = this.LOCK_TIMEOUT): Promise<boolean> {
    try {
      // SECURITY FIX: Use atomic INSERT ... ON CONFLICT with WHERE clause to prevent race condition.
      // The old check-then-insert pattern allowed two processes to both read "no lock"
      // and both insert, creating a race window.
      const lockData = {
        processId,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        timeoutMs
      };

      // Atomic lock acquisition: only acquire if no active lock exists or lock is stale
      const result = await db.execute(sql`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (
          ${this.LOCK_KEY},
          ${JSON.stringify(lockData)},
          NOW()
        )
        ON CONFLICT (key) DO UPDATE
        SET value = ${JSON.stringify(lockData)}, updated_at = NOW()
        WHERE
          -- Lock is stale (exceeded timeout)
          (NOW() - app_settings.updated_at) > (COALESCE((app_settings.value::jsonb->>'timeoutMs')::int, ${this.LOCK_TIMEOUT}) * interval '1 millisecond')
          -- OR heartbeat is too old (2x heartbeat interval)
          OR (NOW() - COALESCE(
            to_timestamp((app_settings.value::jsonb->>'lastHeartbeat')::text, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            app_settings.updated_at
          )) > (${this.HEARTBEAT_INTERVAL * 2} * interval '1 millisecond')
          -- OR same process re-acquiring
          OR app_settings.value::jsonb->>'processId' = ${processId}
      `);

      // If no rows were affected by the upsert, another active lock exists
      if ((result.rowCount ?? 0) === 0) {
        console.log(`⛔ Extraction already running by another process — lock not acquired`);
        return false;
      }
      
      console.log(`✅ Lock acquired for process: ${processId} (timeout: ${timeoutMs/1000}s)`);
      
      // Start heartbeat for this process
      this.startHeartbeat(processId);
      
      return true;
      
    } catch (error) {
      // Table might not exist, try to create it
      try {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS app_settings (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        
        // Try again
        return await this.acquireLock(processId, timeoutMs);
      } catch (_createError) {
        console.error('Failed to manage lock:', error);
        return false;
      }
    }
  }
  
  /**
   * Update heartbeat for active lock
   */
  static async updateHeartbeat(processId: string): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        UPDATE app_settings 
        SET value = jsonb_set(value::jsonb, '{lastHeartbeat}', to_jsonb(${new Date().toISOString()}::text)),
            updated_at = NOW()
        WHERE key = ${this.LOCK_KEY} 
        AND value::jsonb->>'processId' = ${processId}
      `);
      
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Failed to update heartbeat:', error);
      return false;
    }
  }
  
  /**
   * Start heartbeat for a process
   */
  private static heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  static startHeartbeat(processId: string): void {
    // Clear any existing heartbeat for this process
    const existing = this.heartbeatIntervals.get(processId);
    if (existing) {
      clearInterval(existing);
    }
    
    // Start new heartbeat
    const interval = setInterval(async () => {
      const success = await this.updateHeartbeat(processId);
      if (!success) {
        console.warn(`⚠️ Heartbeat failed for process ${processId} - may have lost lock`);
        clearInterval(interval);
        this.heartbeatIntervals.delete(processId);
      }
    }, this.HEARTBEAT_INTERVAL);
    
    this.heartbeatIntervals.set(processId, interval);
    console.log(`💓 Started heartbeat for process: ${processId}`);
  }
  
  /**
   * Stop heartbeat for a process
   */
  static stopHeartbeat(processId: string): void {
    const interval = this.heartbeatIntervals.get(processId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(processId);
      console.log(`💔 Stopped heartbeat for process: ${processId}`);
    }
  }
  
  /**
   * Release the extraction lock
   */
  static async releaseLock(processId: string): Promise<void> {
    try {
      // Stop heartbeat first
      this.stopHeartbeat(processId);
      
      await db.execute(sql`
        DELETE FROM app_settings 
        WHERE key = ${this.LOCK_KEY}
        AND value::jsonb->>'processId' = ${processId}
      `);
      console.log(`🔓 Lock released for process: ${processId}`);
    } catch (error) {
      console.error('Failed to release lock:', error);
    }
  }
  
  /**
   * Check if extraction is currently running with heartbeat validation
   */
  static async isLocked(): Promise<boolean> {
    try {
      const activeLock = await db.execute(sql`
        SELECT value, updated_at 
        FROM app_settings 
        WHERE key = ${this.LOCK_KEY}
      `);
      
      if (activeLock.rows.length === 0) return false;
      
      const lockData = JSON.parse(activeLock.rows[0].value as string);
      const lockAge = Date.now() - new Date(activeLock.rows[0].updated_at as string).getTime();
      const lastHeartbeat = Date.now() - new Date(lockData.lastHeartbeat || lockData.startedAt).getTime();
      
      // Lock is active if it's within timeout AND has recent heartbeat
      const isActive = lockAge < (lockData.timeoutMs || this.LOCK_TIMEOUT) && 
                       lastHeartbeat < this.HEARTBEAT_INTERVAL * 2;
      
      if (!isActive && activeLock.rows.length > 0) {
        console.log(`🧹 Cleaning up stale lock (age: ${Math.round(lockAge/1000)}s, heartbeat: ${Math.round(lastHeartbeat/1000)}s ago)`);
        await db.execute(sql`DELETE FROM app_settings WHERE key = ${this.LOCK_KEY}`);
      }
      
      return isActive;
      
    } catch (_error) {
      return false;
    }
  }
  
  /**
   * Get current lock status for debugging
   */
  static async getLockStatus(): Promise<any> {
    try {
      const activeLock = await db.execute(sql`
        SELECT value, updated_at 
        FROM app_settings 
        WHERE key = ${this.LOCK_KEY}
      `);
      
      if (activeLock.rows.length === 0) {
        return { locked: false };
      }
      
      const lockData = JSON.parse(activeLock.rows[0].value as string);
      const lockAge = Date.now() - new Date(activeLock.rows[0].updated_at as string).getTime();
      const lastHeartbeat = Date.now() - new Date(lockData.lastHeartbeat || lockData.startedAt).getTime();
      
      return {
        locked: true,
        processId: lockData.processId,
        startedAt: lockData.startedAt,
        ageSeconds: Math.round(lockAge / 1000),
        lastHeartbeatSeconds: Math.round(lastHeartbeat / 1000),
        timeoutSeconds: Math.round((lockData.timeoutMs || this.LOCK_TIMEOUT) / 1000)
      };
    } catch (error) {
      return { locked: false, error: (error as any)?.message || String(error) };
    }
  }

  /**
   * Force-release the lock regardless of which process owns it.
   * Used by startup cleanup when orphaned models are found — the server
   * restarted mid-generation so no legitimate lock holder exists.
   */
  static async forceReleaseLock(): Promise<void> {
    try {
      // Stop all in-memory heartbeats (server restarted so none should exist,
      // but be defensive in case this is called mid-run in tests)
      for (const [pid, interval] of this.heartbeatIntervals.entries()) {
        clearInterval(interval);
        this.heartbeatIntervals.delete(pid);
      }
      await db.execute(sql`DELETE FROM app_settings WHERE key = ${this.LOCK_KEY}`);
      console.log('🔓 Force-released extraction lock on startup (orphaned models detected)');
    } catch (error) {
      console.error('Failed to force-release lock on startup:', error);
    }
  }
}