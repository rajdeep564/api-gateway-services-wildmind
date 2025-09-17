import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	transport: isDev
		? {
			target: 'pino-pretty',
			options: { colorize: true, translateTime: true, singleLine: false }
		}
		: undefined,
	base: undefined,
	redact: {
		paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
		remove: true
	}
});
