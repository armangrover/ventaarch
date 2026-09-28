const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('./server');

async function withServer(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ventarch-test-'));
    const server = createServer({ dbPath: path.join(directory, 'test.sqlite') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('creates a user and persists quote data with an atomic credit decrement', async () => {
    await withServer(async baseUrl => {
        const createResponse = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sam Example', phone: '+1 555 0100' })
        });
        assert.equal(createResponse.status, 200);
        const { user } = await createResponse.json();
        assert.equal(user.quotesRemaining, 10);

        const quoteResponse = await fetch(`${baseUrl}/api/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userPhone: user.phone,
                totalEstimate: 1250.5,
                items: [{ productId: 'p-1', qty: 2 }]
            })
        });
        assert.equal(quoteResponse.status, 201);
        const savedQuote = await quoteResponse.json();
        assert.equal(savedQuote.user.quotesRemaining, 9);

        const persistedUser = await fetch(`${baseUrl}/api/users/${encodeURIComponent(user.phone)}`);
        assert.equal((await persistedUser.json()).user.quotesRemaining, 9);

        const staticPage = await fetch(baseUrl);
        assert.equal(staticPage.status, 200);
        assert.match(await staticPage.text(), /VENTARCH Partner Portal/);

        const sourceFile = await fetch(`${baseUrl}/server.js`);
        assert.equal(sourceFile.status, 404);
    });
});

test('rejects malformed quote input without spending a credit', async () => {
    await withServer(async baseUrl => {
        const createResponse = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sam Example', phone: '5550100' })
        });
        const { user } = await createResponse.json();
        const quoteResponse = await fetch(`${baseUrl}/api/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPhone: user.phone, totalEstimate: -1, items: [] })
        });
        assert.equal(quoteResponse.status, 400);

        const persistedUser = await fetch(`${baseUrl}/api/users/${user.phone}`);
        assert.equal((await persistedUser.json()).user.quotesRemaining, 10);
    });
});