// tests/fixtures/hold-lock.mjs — spawned by the test; acquires a lock and exits WITHOUT releasing
import { acquireLock } from '../../scripts/common/lock.mjs';
acquireLock(process.argv[2]);
process.stdout.write('held\n');
process.exit(0);
