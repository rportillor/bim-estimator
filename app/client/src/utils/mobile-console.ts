/**
 * 📱 MOBILE CONSOLE LOGGER
 * Since iPhone doesn't show console logs easily, create visible error display
 */

interface MobileLogEntry {
  id: string;
  message: string;
  type: 'log' | 'error' | 'warn' | 'info';
  timestamp: Date;
}

class MobileConsole {
  private logs: MobileLogEntry[] = [];
  private maxLogs = 20;
  private logElement: HTMLElement | null = null;

  constructor() {
    this.createLogDisplay();
    this.interceptConsole();
  }

  private createLogDisplay() {
    // Only create on mobile devices
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      return;
    }

    const logContainer = document.createElement('div');
    logContainer.id = 'mobile-console';
    logContainer.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 300px;
      max-height: 200px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      font-family: monospace;
      font-size: 11px;
      padding: 8px;
      border-radius: 4px;
      z-index: 9999;
      overflow-y: auto;
      display: none;
    `;

    // Add toggle button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = '🐛';
    toggleButton.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 40px;
      height: 40px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      border: none;
      border-radius: 50%;
      z-index: 10000;
      font-size: 16px;
    `;

    toggleButton.onclick = () => {
      const isVisible = logContainer.style.display === 'block';
      logContainer.style.display = isVisible ? 'none' : 'block';
      toggleButton.style.right = isVisible ? '10px' : '320px';
    };

    document.body.appendChild(logContainer);
    document.body.appendChild(toggleButton);
    this.logElement = logContainer;
  }

  private interceptConsole() {
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      return;
    }

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    console.log = (...args) => {
      originalLog.apply(console, args);
      this.addLog(args.join(' '), 'log');
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      this.addLog(args.join(' '), 'error');
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      this.addLog(args.join(' '), 'warn');
    };

    console.info = (...args) => {
      originalInfo.apply(console, args);
      this.addLog(args.join(' '), 'info');
    };
  }

  private addLog(message: string, type: MobileLogEntry['type']) {
    const logEntry: MobileLogEntry = {
      id: `log_${Date.now()}`,
      message,
      type,
      timestamp: new Date()
    };

    this.logs.unshift(logEntry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    this.updateDisplay();
  }

  // SECURITY FIX: Escape HTML to prevent XSS via log messages
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private updateDisplay() {
    if (!this.logElement) return;

    const html = this.logs.map(log => {
      const color = {
        log: '#fff',
        error: '#ff6b6b',
        warn: '#ffd93d',
        info: '#74c0fc'
      }[log.type];

      const time = log.timestamp.toLocaleTimeString();
      const safeMessage = this.escapeHtml(log.message);
      return `<div style="color: ${color}; margin-bottom: 4px; border-bottom: 1px solid #333; padding-bottom: 2px;">
        <div style="font-size: 9px; opacity: 0.7;">${time}</div>
        <div>${safeMessage}</div>
      </div>`;
    }).join('');

    this.logElement.innerHTML = html;
  }

  public clear() {
    this.logs = [];
    this.updateDisplay();
  }

  public getLogs() {
    return this.logs;
  }
}

// Initialize mobile console
export const mobileConsole = new MobileConsole();

// Helper function for mobile debugging
export const mobileLog = (message: string, data?: any) => {
  const fullMessage = data ? `${message}: ${JSON.stringify(data)}` : message;
  console.log(`📱 ${fullMessage}`);
};