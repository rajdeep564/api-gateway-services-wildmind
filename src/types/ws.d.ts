// Type declarations for 'ws' module
// This file ensures TypeScript can compile even if @types/ws isn't installed
declare module 'ws' {
  import { EventEmitter } from 'events';
  import { Server as HttpServer, IncomingMessage } from 'http';
  import { Duplex } from 'stream';

  export interface WebSocket extends EventEmitter {
    send(data: any, cb?: (error?: Error) => void): void;
    send(data: any, options: { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean }, cb?: (error?: Error) => void): void;
    ping(data?: any, mask?: boolean, cb?: (error: Error) => void): void;
    pong(data?: any, mask?: boolean, cb?: (error: Error) => void): void;
    close(code?: number, data?: string | Buffer): void;
    terminate(): void;
    readyState: number;
    protocol: string;
    url: string;
    extensions: string;
    binaryType: 'nodebuffer' | 'arraybuffer' | 'fragments';
    CONNECTING: number;
    OPEN: number;
    CLOSING: number;
    CLOSED: number;
  }

  export interface ServerOptions {
    host?: string;
    port?: number;
    backlog?: number;
    server?: HttpServer;
    verifyClient?: (info: { origin: string; secure: boolean; req: IncomingMessage }) => boolean;
    handleProtocols?: (protocols: string[], request: IncomingMessage) => string | false;
    path?: string;
    noServer?: boolean;
    clientTracking?: boolean;
    perMessageDeflate?: boolean | object;
    maxPayload?: number;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: ServerOptions, callback?: () => void);
    clients: Set<WebSocket>;
    close(cb?: (error?: Error) => void): void;
    handleUpgrade(request: IncomingMessage, socket: Duplex, upgradeHead: Buffer, callback: (client: WebSocket, request: IncomingMessage) => void): void;
    shouldHandle(request: IncomingMessage): boolean | undefined;
  }

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default WebSocket;
}

