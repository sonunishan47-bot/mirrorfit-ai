import type { Server } from 'node:http';

export const DEV_CA_HTTP_PORT: number;

export function respondDevCa(
  method: string,
  pathname: string,
  readCa: () => Buffer | null,
): {
  status: number;
  body: Buffer | null;
  headers: Record<string, string>;
};

export function startDevCaHttpServer(caPath: string, port?: number): Server;
