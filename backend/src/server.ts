import { readConfig, missingConfig } from "./config.js";
import { postgres } from "./db/database.js";
import { WorkspaceRepository } from "./db/workspace.js";
import { Repository } from "./db/repository.js";
import { supabaseAuth } from "./auth/provider.js";
import { buildApp } from "./app.js";
const config = readConfig();
const ready = missingConfig(config).length === 0;
const db = ready ? postgres(config.DATABASE_URL!) : undefined;
const repository = db ? new Repository(db) : undefined;
const auth = ready ? supabaseAuth(config) : undefined;
const app = await buildApp(config, repository, auth);
if (!ready)
  console.log(
    "Secure setup pending. See docs/SUPABASE_SETUP.md. Business endpoints remain unavailable.",
  );
if (ready) {
  await repository!.ready();
  if (
    config.NODE_ENV === "production" &&
    !(await new WorkspaceRepository(db!).workspaceAvailable())
  )
    throw new Error(
      "Apply the reviewed web workspace migrations before production startup.",
    );
}
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`DailyLoop: http://${config.HOST}:${config.PORT}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await db?.close();
    process.exit(0);
  });
