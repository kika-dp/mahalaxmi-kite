/* Usage: migrate.ts run | revert | show */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../data-source';

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'run';
  const ds = new DataSource(buildDataSourceOptions(process.env.MIGRATE_DATABASE_URL));
  await ds.initialize();
  try {
    if (cmd === 'run') {
      const done = await ds.runMigrations({ transaction: 'each' });
      console.log(done.length ? `Applied: ${done.map((m) => m.name).join(', ')}` : 'No pending migrations');
    } else if (cmd === 'revert') {
      await ds.undoLastMigration({ transaction: 'each' });
      console.log('Reverted last migration');
    } else if (cmd === 'show') {
      const pending = await ds.showMigrations();
      console.log(pending ? 'There are pending migrations' : 'Up to date');
    } else {
      throw new Error(`Unknown command ${cmd}`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
