import * as uuid from 'uuid';
//import * as db from './db-json.js';
//import * as db from './db-sqlite.js';
import * as db from './db-mongodb.js';

export async function main() {

    await db.start();
    await db.resetDb();

    for (let i = 0; i < 100; i++) {

        const id = uuid.v4();
        const did = `did:test:${id}`;
        console.log(i, did);

        console.time('add DID');

        for (let j = 0; j < 10; j++) {

            const op = {
                "registry": "hyperswarm",
                "time": "2024-04-04T13:56:09.975Z",
                "ordinal": 0,
                "did": did,
                "operation": {
                    "type": "create",
                    "created": new Date().toISOString(),
                    "mdip": {
                        "version": 1,
                        "type": "asset",
                        "registry": "hyperswarm"
                    },
                    "controller": "did:mdip:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv",
                    "data": {
                        "backup": "jOwkc_Xki_1Hhk6qsqDVJEfHn4ZLv7fzpHBBOUdUK6qU_gA-p319ej2vmT227DmZVMxrrUHrrPPa6ZPM7lxPOAvN1cTWQ6L8nTn-SBy6BCrGHYc-VkUEuD1c7peoBT9QooY3Re3zSnv0Wvnr9ZfK4Q-r3s-lwSvAwMbUSxBvvyjLNQOLWecCkYxPW4YLsdw7aqoQHAFhys5564q8EqkGqKRP6SyW3GElF9YtV9Xq22-Hr30u-DGeWSKg-aP25slrRHLUvwYg2EbVeCspZvAIiizfIfhlNKXwmKmqo6dcx8QfcZKtjuJaYYRIC50FvLTPHN3Ca4NAmEXqXzJKj9csMhCJ_VTaQ_NN90ycysdDy7BffYqCDWkntteY5YEHRPt6GruTGPtSoE0fNQCPOZwFsY4"
                    },
                    "signature": {
                        "signer": "did:mdip:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv",
                        "signed": "2024-04-04T13:56:09.985Z",
                        "hash": "0ab16157713ae7ff748c6c5d6eb227b4210e50716da2dc160419ebf8065e39af",
                        "value": "b02e0450c3cb72072b07a17b393d6dc824167cfbc619b7929664bc9a8c81abc56a77de7408e924f459877517704eb9076b2c171f4e4305e930de06e4d3d6a96a"
                    }
                }
            };

            console.time('addOperation');
            await db.addOperation(op);
            console.timeEnd('addOperation');
        }

        console.timeEnd('add DID');
    }

    const ids = await db.getAllDIDs();

    for (const i in ids) {
        const id = ids[i];
        console.time('getOperations');
        await db.getOperations(id);
        console.timeEnd('getOperations');
        console.log(i, id);
    }

    await db.stop();
}

console.time('main');
await main();
console.timeEnd('main');
