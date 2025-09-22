import pinoHttp from 'pino-http';
import { requestLogger } from '../utils/logger';

export const httpLogger = pinoHttp({
  logger: requestLogger,
  customProps: (req) => ({ requestId: (req as any).requestId }),
  serializers: {
    req(req) {
      return {
        id: (req as any).id,
        method: req.method,
        url: req.url,
        remoteAddress: (req as any).socket?.remoteAddress,
        remotePort: (req as any).socket?.remotePort,
        headers: {
          // omit sensitive headers
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type']
        }
      };
    }
  }
});


