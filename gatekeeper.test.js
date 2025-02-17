import mockFs from 'mock-fs';
import * as cipher from './cipher-lib.js';
import * as gatekeeper from './gatekeeper-lib.js';
import * as db_json from './db-json.js';

beforeEach(async () => {
    db_json.start();
    await gatekeeper.start(db_json);
});

afterEach(async () => {
    await gatekeeper.stop();
});

describe('anchorSeed', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from operation', async () => {
        mockFs({});

        const mockTxn = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry"
            }
        };
        const did = await gatekeeper.anchorSeed(mockTxn);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should create same DID from same operation with date included', async () => {
        mockFs({});

        const mockTxn = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry"
            }
        };
        const did1 = await gatekeeper.anchorSeed(mockTxn);
        const did2 = await gatekeeper.anchorSeed(mockTxn);

        expect(did1 === did2).toBe(true);
    });
});

async function createAgentOp(keypair, version = 1, registry = 'local') {
    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    };
}

async function createUpdateOp(keypair, did, doc) {
    const current = await gatekeeper.resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    const signed = {
        ...operation,
        signature: {
            signer: did,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return signed;
}

async function createAssetOp(agent, keypair, registry = 'local') {
    const dataAnchor = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: registry,
        },
        controller: agent,
        data: "mockData",
    };

    const msgHash = cipher.hashJSON(dataAnchor);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);
    const assetOp = {
        ...dataAnchor,
        signature: {
            signer: agent,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return assetOp;
}

describe('createDID', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 2);

        try {
            await gatekeeper.createDID(agentOp);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid versions include')).toBe(true);
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'mockRegistry');

        try {
            await gatekeeper.createDID(agentOp);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid registries include')).toBe(true);
        }
    });

    it('should create DID from asset operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);

        const did = await gatekeeper.createDID(assetOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });
});


describe('resolveDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a valid agent DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: {},
            didDocumentMetadata: {
                created: expect.any(String),
                version: 1,
                confirmed: true,
            },
            mdip: agentOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should resolve a valid agent DID after an update', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: doc.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: true,
            },
            mdip: agentOp.mdip,
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve confirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const expected = await gatekeeper.resolveDID(did);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const confirmedDoc = await gatekeeper.resolveDID(did, { confirm: true });

        expect(ok).toBe(true);
        expect(confirmedDoc).toStrictEqual(expected);
    });

    it('should resolve unconfirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did, { confirm: false });
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: update.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: false,
            },
            mdip: agentOp.mdip,
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve version at specified time', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        let expected;

        // Add 10 versions, save one from the middle
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);

            if (i == 5) {
                expected = update;
            }

            update.didDocumentData = { mock: 1 };
            const updateOp = await createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const doc = await gatekeeper.resolveDID(did, { atTime: expected.didDocumentMetadata.updated });
        expect(doc).toStrictEqual(expected);
    });

    it('should resolve specified version', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        let expected;

        // Add 10 versions, save one from the middle
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);

            if (i == 5) {
                expected = update;
            }

            update.didDocumentData = { mock: 1 };
            const updateOp = await createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const doc = await gatekeeper.resolveDID(did, { atVersion: expected.didDocumentMetadata.version });
        expect(doc).toStrictEqual(expected);
    });

    it('should resolve a valid asset DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);
        const did = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                id: did,
                controller: assetOp.controller,
            },
            didDocumentData: assetOp.data,
            didDocumentMetadata: {
                created: expect.any(String),
                version: 1,
                confirmed: true,
            },
            mdip: assetOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should not resolve an invalid DID', async () => {
        mockFs({});

        try {
            await gatekeeper.resolveDID();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID([1, 2, 3]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID({});
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID({ mock: 1 });
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('did:test:xxx');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });
});

describe('updateDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        doc.didDocumentMetadata.updated = expect.any(String);
        doc.didDocumentMetadata.version = 2;

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(doc);
    });

    it('should increment version with each update', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        for (let i = 0; i < 10; i++) {
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            const ok = await gatekeeper.updateDID(updateOp);
            const updatedDoc = await gatekeeper.resolveDID(did);

            expect(ok).toBe(true);
            expect(updatedDoc.didDocumentMetadata.version).toBe(i + 2);
        }
    });

    it('should return false if update operation is invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        updateOp.doc.didDocumentData = 'mock';
        const ok = await gatekeeper.updateDID(updateOp);

        expect(ok).toBe(false);
    });
});

describe('exportDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should export a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export a valid updated DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('exportDIDs', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should export a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });


    it('should export a DIDs in order requested', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);

        const exports = await gatekeeper.exportDIDs([assetDID, agentDID]);

        expect(exports.length).toBe(2);
        expect(exports[0][0].operation).toStrictEqual(assetOp);
        expect(exports[1][0].operation).toStrictEqual(agentOp);
    });

    it('should export a valid updated DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const exports = await gatekeeper.exportDIDs(['mockDID']);
        const ops = exports[0];
        expect(ops).toStrictEqual([]);
    });
});

describe('removeDIDs', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ok = await gatekeeper.removeDIDs([did]);

        expect(ok).toBe(true);

        try {
            await gatekeeper.resolveDID(did);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });

    it('should throw an exception if no array specified', async () => {
        mockFs({});

        try {
            await gatekeeper.removeDIDs();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid array');
        }
    });

    it('should return true if no DID specified remove', async () => {
        mockFs({});

        const ok = await gatekeeper.removeDIDs([]);
        expect(ok).toBe(true);
    });

    it('should return true if unknown DIDs specified', async () => {
        mockFs({});

        const ok = await gatekeeper.removeDIDs(['did:test:mock']);
        expect(ok).toBe(true);
    });
});

describe('importBatch', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const { verified } = await gatekeeper.importBatch(ops);

        expect(verified).toBe(1);
    });

    it('should import a valid asset DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        const { verified } = await gatekeeper.importBatch(ops);

        expect(verified).toBe(1);
    });

    it('should report 0 ops imported when DID exists', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(0);
        expect(verified).toBe(2);
        expect(failed).toBe(0);
    });

    it('should update events when DID is imported from its native registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TESS';
        ops[1].registry = 'TESS';
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(2);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
    });

    it('should resolve as confirmed when DID is imported from its native registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TESS';
        ops[1].registry = 'TESS';
        await gatekeeper.importBatch(ops);

        const doc2 = await gatekeeper.resolveDID(did);

        expect(doc2.didDocumentMetadata.version).toBe(2);
        expect(doc2.didDocumentMetadata.confirmed).toBe(true);
    });

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);
        ops[0].registry = 'TESS';
        ops[1].registry = 'TESS';
        await gatekeeper.importBatch(ops);

        ops[0].registry = 'hyperswarm';
        ops[1].registry = 'hyperswarm';
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(0);
        expect(verified).toBe(2);
        expect(failed).toBe(0);
    });

    it('should report 2 ops imported when DID deleted first', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(2);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
    });

    it('should report N+1 ops imported for N updates', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        const N = 10;
        for (let i = 0; i < N; i++) {
            doc.didDocumentData = { mock: `${i}` };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
        }

        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(N + 1);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
    });

    it('should resolve an imported DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
    });

    it('should throw an exception on undefined', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should report an error on non-transactions', async () => {
        mockFs({});

        const { updated, verified, failed } = await gatekeeper.importBatch([1, 2, 3]);

        expect(updated).toBe(0);
        expect(verified).toBe(0);
        expect(failed).toBe(3);
    });
});

describe('getQueue', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return single event in queue', async () => {
        mockFs({});

        const registry = 'TESS';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([updateOp]);
    });

    it('should throw an exception if invalid registry', async () => {
        mockFs({});

        try {
            await gatekeeper.getQueue('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid registry');
        }
    });
});

describe('clearQueue', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should clear non-empty queue', async () => {
        mockFs({});

        const registry = 'TESS';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);

        await gatekeeper.clearQueue(registry, queue);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should clear only specified events', async () => {
        mockFs({});

        const registry = 'TESS';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const queue1 = [];
        const queue2 = [];

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue1.push(updateOp);
        }

        const queue3 = await gatekeeper.getQueue(registry);
        expect(queue3).toStrictEqual(queue1);

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue2.push(updateOp);
        }

        await gatekeeper.clearQueue(registry, queue3);
        const queue4 = await gatekeeper.getQueue(registry);
        expect(queue4).toStrictEqual(queue2);
    });

    it('should return true if queue already empty', async () => {
        mockFs({});

        const ok = await gatekeeper.clearQueue('TESS', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        mockFs({});

        const registry = 'TESS';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);
        await gatekeeper.clearQueue(registry, queue);
        await gatekeeper.getQueue(registry);

        const ok = await gatekeeper.clearQueue(registry, 'mock');

        expect(ok).toStrictEqual(true);
    });

    it('should throw an exception if invalid registry', async () => {
        mockFs({});

        try {
            await gatekeeper.clearQueue('mock', []);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid registry');
        }
    });
});

describe('getDids', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return all DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);

        const allDIDs = await gatekeeper.getDIDs();

        expect(allDIDs.length).toBe(2);
        expect(allDIDs.includes(agentDID)).toBe(true);
        expect(allDIDs.includes(assetDID)).toBe(true);
    });

    it('should return all DIDs resolved', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDoc);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs confirmed and resolved', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: true, resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDoc); // version 1
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs unconfirmed and resolved', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);
        const agentDocv2 = await gatekeeper.resolveDID(agentDID);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: false, resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDocv2);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs after specified time', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc = await gatekeeper.resolveDID(dids[4]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedAfter: doc.didDocumentMetadata.created });

        expect(recentDIDs.length).toBe(5);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
        expect(recentDIDs.includes(dids[8])).toBe(true);
        expect(recentDIDs.includes(dids[9])).toBe(true);
    });

    it('should return all DIDs before specified time', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc = await gatekeeper.resolveDID(dids[5]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedBefore: doc.didDocumentMetadata.created });

        expect(recentDIDs.length).toBe(6);
        expect(recentDIDs.includes(agentDID)).toBe(true);
        expect(recentDIDs.includes(dids[0])).toBe(true);
        expect(recentDIDs.includes(dids[1])).toBe(true);
        expect(recentDIDs.includes(dids[2])).toBe(true);
        expect(recentDIDs.includes(dids[3])).toBe(true);
        expect(recentDIDs.includes(dids[4])).toBe(true);
    });

    it('should return all DIDs between specified times', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc3 = await gatekeeper.resolveDID(dids[3]);
        const doc8 = await gatekeeper.resolveDID(dids[8]);
        const recentDIDs = await gatekeeper.getDIDs({
            updatedAfter: doc3.didDocumentMetadata.created,
            updatedBefore: doc8.didDocumentMetadata.created
        });

        expect(recentDIDs.length).toBe(4);
        expect(recentDIDs.includes(dids[4])).toBe(true);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
    });

    it('should resolve all specified DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const expected = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
            expected.push(await gatekeeper.resolveDID(assetDID));
        }

        const resolvedDIDs = await gatekeeper.getDIDs({
            dids: dids,
            resolve: true
        });

        expect(resolvedDIDs.length).toBe(10);

        for (let i = 0; i < 10; i++) {
            expect(resolvedDIDs[i]).toStrictEqual(expected[i]);
        }
    });
});

describe('listRegistries', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of valid registries', async () => {
        mockFs({});

        const registries = await gatekeeper.listRegistries();

        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TESS')).toBe(true);
    });
});

describe('verifyDb', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should verify all DIDs in db', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const invalid = await gatekeeper.verifyDb(false);

        expect(invalid).toBe(0);
    });
});
