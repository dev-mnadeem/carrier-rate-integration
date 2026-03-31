import { loadAppConfig } from "../config.js";
import { isCarrierError } from "../errors.js";
import { createCarrier } from "../registry.js";
import { createRatingServer, listen } from "./http-server.js";

/** Process entrypoint: build config, build the carrier, listen, shut down cleanly. */
async function main(): Promise<void> {
  const app = loadAppConfig(process.env);
  const carrier = createCarrier({ app, env: process.env });
  const server = createRatingServer(carrier);

  await listen(server, { host: app.host, port: app.port });
  process.stdout.write(
    `carrier-rate-integration listening on http://${app.host}:${app.port} (carrier: ${carrier.id})\n`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main().catch((e: unknown) => {
  const detail = isCarrierError(e) ? JSON.stringify(e.toJSON()) : String(e);
  process.stderr.write(`failed to start: ${detail}\n`);
  process.exit(1);
});
