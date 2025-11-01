import { Request } from 'express';

export function extractDeviceInfo(req: Request) {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  
  // Simple user agent parsing
  const browser = userAgent.includes('Chrome') ? 'Chrome' : 
                 userAgent.includes('Firefox') ? 'Firefox' :
                 userAgent.includes('Safari') ? 'Safari' :
                 userAgent.includes('Edge') ? 'Edge' : 'Unknown';
  
  const os = userAgent.includes('Windows') ? 'Windows' :
            userAgent.includes('Mac') ? 'macOS' :
            userAgent.includes('Linux') ? 'Linux' :
            userAgent.includes('Android') ? 'Android' :
            userAgent.includes('iOS') ? 'iOS' : 'Unknown';
  
  const device = userAgent.includes('Mobile') ? 'Mobile' :
                userAgent.includes('Tablet') ? 'Tablet' : 'Desktop';
  
  return {
    ip,
    userAgent,
    deviceInfo: {
      browser,
      os,
      device
    }
  };
}
