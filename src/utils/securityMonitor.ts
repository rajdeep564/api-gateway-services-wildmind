/**
 * Security Monitoring Utility
 * 
 * Detects and logs suspicious activity:
 * - Injection attempts
 * - Brute force attacks
 * - Unusual patterns
 */

export interface SecurityEvent {
  type: 'brute_force' | 'sql_injection' | 'xss_attempt' | 'unauthorized_access' | 'rate_limit' | 'blocked_ip';
  ip: string;
  endpoint: string;
  userAgent?: string;
  payload?: any;
timestamp: Date;
}

class SecurityMonitor {
  private events: SecurityEvent[] = [];
  private readonly MAX_EVENTS = 1000;

  /**
   * Log suspicious security event
   */
  logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date()
    };

    console.error('[SECURITY ALERT]', {
      type: event.type,
      ip: event.ip,
      endpoint: event.endpoint
    });

    // Store in memory (circular buffer)
    this.events.push(fullEvent);
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }

    // TODO: Integrate with external monitoring
    // - Send to Sentry
    // - Send to Slack/Discord webhook
    // - Email alerts for critical events
  }

  /**
   * Detect SQL injection patterns
   */
  detectSQLInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(--|;|\/\*|\*\/|xp_|sp_)/i,
      /(\bOR\b.*=.*)/i
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Detect XSS attempts
   */
  detectXSS(input: string): boolean {
    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /onerror=/i,
      /onclick=/i,
      /onload=/i,
      /<iframe/i
    ];

    return xssPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Get recent security events
   */
  getRecentEvents(limit: number = 100): SecurityEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: SecurityEvent['type']): SecurityEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events by IP
   */
  getEventsByIP(ip: string): SecurityEvent[] {
    return this.events.filter(e => e.ip === ip);
  }

  /**
   * Clear old events
   */
  clearOldEvents(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.events = this.events.filter(e => e.timestamp > cutoff);
  }
}

export const securityMonitor = new SecurityMonitor();

// Clear old events every hour
setInterval(() => {
  securityMonitor.clearOldEvents(24);
}, 60 * 60 * 1000);

console.log('[Security Monitor] Initialized');
