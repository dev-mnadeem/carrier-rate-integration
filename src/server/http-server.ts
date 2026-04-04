import { createServer, type IncomingMessage, type Server } from "node:http";
import type { RatingCarrier } from "../rating-carrier.js";
import { MAX_BODY_BYTES, handle, toErrorResponse } from "./app.js";

export type ServerOptions = {
  host: string;
  port: number;
};

/** Binds the pure request handler in `app.ts` to a real socket. */
export function createRatingServer(carrier: RatingCarrier): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      try {
        const body = await readBody(req);
        const result = await handle(carrier, {
          method: req.method ?? "GET",
          path,
          body,
        });
        send(res, result.status, result.body);
      } catch (e) {
        const result = toErrorResponse(e);
        send(res, result.status, result.body);
      }
    })();
  });
}

export function listen(
  server: Server,
  { host, port }: ServerOptions,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

/** Reads the body, refusing anything past the cap instead of buffering it. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body exceeded the maximum size"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    end: (b: string) => void;
  },
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}
