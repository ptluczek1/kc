import { program } from 'commander';
import fs from 'fs';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster-lib.js';
import * as cipher from './cipher-lib.js';
import * as db_wallet from './db-wallet-json.js';
import config from './config.js';

program
    .version('1.0.0')
    .description('Admin CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('resolve-did <did> [confirm]')
    .description('Return document associated with DID')
    .action(async (did, confirm) => {
        try {
            const doc = await gatekeeper.resolveDID(did, { confirm: !!confirm });
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot resolve ${did}`);
        }
    });

program
    .command('get-dids [updatedAfter] [updatedBefore] [confirm] [resolve]')
    .description('Fetch all DIDs')
    .action(async (updatedAfter, updatedBefore, confirm, resolve) => {
        try {
            let options = {};

            const after = new Date(updatedAfter);

            if (!isNaN(after.getTime())) {
                options.updatedAfter = after.toISOString();
            }

            const before = new Date(updatedBefore);

            if (!isNaN(before.getTime())) {
                options.updatedBefore = before.toISOString();
            }

            if (confirm) {
                options.confirm = confirm === 'true';
            }

            if (resolve) {
                options.resolve = resolve === 'true';
            }

            const dids = await gatekeeper.getDIDs(options);
            console.log(JSON.stringify(dids, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('export-dids')
    .description('Export all DIDs')
    .action(async () => {
        try {
            const dids = await gatekeeper.getDIDs();
            const data = await gatekeeper.exportDIDs(dids);
            console.log(JSON.stringify(data, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-dids <file>')
    .description('Import batch of DIDs')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const batch = JSON.parse(contents);

            // Import DIDs by creation time order to avoid dependency errors
            batch.sort((a, b) => a[0].time - b[0].time);

            let chunk = [];
            for (const events of batch) {
                chunk.push(events);

                if (chunk.length >= 10) {
                    console.time('importBatch');
                    const { verified, updated, failed } = await gatekeeper.importBatch(chunk);
                    console.timeEnd('importBatch');
                    console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
                    chunk = [];
                }
            }

            console.time('importBatch');
            const { verified, updated, failed } = await gatekeeper.importBatch(chunk);
            console.timeEnd('importBatch');
            console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('hash-dids <file>')
    .description('Compute hash of batch')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const batch = JSON.parse(contents);

            // Have to sort before the hash
            //batch.sort((a, b) => a[0].time - b[0].time);
            batch.sort((a, b) => new Date(a[0].operation.signature.signed) - new Date(b[0].operation.signature.signed));

            const hash = cipher.hashJSON(batch);
            console.log(hash);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('show-queue <registry>')
    .description('Show queue for a registry')
    .action(async (registry) => {
        try {
            const batch = await gatekeeper.getQueue(registry);
            console.log(JSON.stringify(batch, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-batch <registry>')
    .description('Create a batch for a registry')
    .action(async (registry) => {
        try {
            const batch = await gatekeeper.getQueue(registry);
            console.log(JSON.stringify(batch, null, 4));

            if (batch.length > 0) {
                const did = await keymaster.createAsset(batch);
                console.log(did);
            }
            else {
                console.log('empty batch');
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('clear-queue <registry> <batch>')
    .description('Clear a registry queue')
    .action(async (registry, batch) => {
        try {
            const events = await keymaster.resolveAsset(batch);
            console.log(JSON.stringify(events, null, 4));
            const ok = await gatekeeper.clearQueue(registry, events);

            if (ok) {
                console.log("Batch cleared");
            }
            else {
                console.log("Error: batch not cleared");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-batch <did> [registry]')
    .description('Import a batch')
    .action(async (did, registry) => {
        try {
            if (!registry) {
                registry = 'local';
            }

            const queue = await keymaster.resolveAsset(did);
            const batch = [];
            const now = new Date();

            for (let i = 0; i < queue.length; i++) {
                batch.push({
                    registry: registry,
                    time: now.toISOString(),
                    ordinal: [now.getTime(), i],
                    operation: queue[i],
                });
            }

            console.log(JSON.stringify(batch, null, 4));
            console.time('importBatch');
            const { verified, updated, failed } = await gatekeeper.importBatch(batch);
            console.timeEnd('importBatch');
            console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('reset-db')
    .description('Reset the database to empty')
    .action(async () => {
        try {
            const response = await gatekeeper.resetDb();
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('resolve-seed-bank')
    .description('Resolves the seed bank ID')
    .action(async () => {
        try {
            const doc = await keymaster.resolveSeedBank();
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

async function run() {
    gatekeeper.setURL(`${config.gatekeeperURL}:${config.gatekeeperPort}`);
    await keymaster.start(gatekeeper, db_wallet);
    program.parse(process.argv);
    await keymaster.stop();
}

run();
