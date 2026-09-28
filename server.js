const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DEFAULT_HTML = 'ventarch_portal_html (1).html';
const QUOTE_LIMIT = 10;
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pdf': 'application/pdf'
};

function createServer({ dbPath = path.join(ROOT, 'data', 'ventarch.sqlite') } = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const database = new DatabaseSync(dbPath);
    database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quotes_remaining INTEGER NOT NULL DEFAULT ${QUOTE_LIMIT},
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL REFERENCES users(phone),
      total_estimate REAL NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

    const getUser = database.prepare(`
    SELECT phone, name, quotes_remaining AS quotesRemaining, created_at AS createdAt
    FROM users WHERE phone = ?
  `);
    const insertUser = database.prepare(
        'INSERT INTO users (phone, name, quotes_remaining, created_at) VALUES (?, ?, ?, ?)'
    );
    const insertQuote = database.prepare(
        'INSERT INTO quotes (user_phone, total_estimate, items_json, created_at) VALUES (?, ?, ?, ?)'
    );
    const updateCredits = database.prepare(
        'UPDATE users SET quotes_remaining = quotes_remaining - 1 WHERE phone = ? AND quotes_remaining > 0'
    );
    const saveQuote = (phone, totalEstimate, items, createdAt) => {
        database.exec('BEGIN IMMEDIATE');
        try {
            const user = getUser.get(phone);
            if (!user) {
                database.exec('ROLLBACK');
                return { error: 'User not found.', status: 404 };
            }
            if (user.quotesRemaining <= 0) {
                database.exec('ROLLBACK');
                return { error: 'No quotes remaining.', status: 409 };
            }

            updateCredits.run(phone);
            const quote = insertQuote.run(phone, totalEstimate, JSON.stringify(items), createdAt);
            database.exec('COMMIT');
            return { quoteId: Number(quote.lastInsertRowid), user: getUser.get(phone) };
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
    };

    const server = http.createServer(async (request, response) => {
        const sendJson = (status, value) => {
            response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify(value));
        };

        try {
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname.startsWith('/api/')) {
                if (request.method === 'GET' && url.pathname.startsWith('/api/users/')) {
                    const phone = decodeURIComponent(url.pathname.slice('/api/users/'.length));
                    return sendJson(200, { user: getUser.get(phone) || null });
                }

                if (request.method === 'POST' && url.pathname === '/api/users') {
                    const body = await readJson(request);
                    const name = typeof body.name === 'string' ? body.name.trim() : '';
                    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
                    if (!name || name.length > 120 || !phone || phone.length > 40) {
                        return sendJson(400, { error: 'Enter a valid name and mobile number.' });
                    }
                    let user = getUser.get(phone);
                    if (!user) {
                        insertUser.run(phone, name, QUOTE_LIMIT, new Date().toISOString());
                        user = getUser.get(phone);
                    }
                    return sendJson(200, { user });
                }

                if (request.method === 'POST' && url.pathname === '/api/quotes') {
                    const body = await readJson(request);
                    const phone = typeof body.userPhone === 'string' ? body.userPhone.trim() : '';
                    const totalEstimate = Number(body.totalEstimate);
                    if (!phone || !Number.isFinite(totalEstimate) || totalEstimate < 0 ||
                        !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
                        return sendJson(400, { error: 'Quote data is invalid.' });
                    }
                    const result = saveQuote(phone, totalEstimate, body.items, new Date().toISOString());
                    if (result.error) return sendJson(result.status, { error: result.error });
                    return sendJson(201, result);
                }

                return sendJson(404, { error: 'API route not found.' });
            }

            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return sendJson(405, { error: 'Method not allowed.' });
            }
            const pathname = decodeURIComponent(url.pathname);
            const relativePath = pathname === '/' ? DEFAULT_HTML : pathname.slice(1);
            const filePath = path.resolve(ROOT, relativePath);
            const imageRoot = path.resolve(ROOT, 'images');
            const isPortalPage = relativePath === DEFAULT_HTML;
            const isImage = filePath.startsWith(`${imageRoot}${path.sep}`);
            if (!isPortalPage && !isImage) {
                return sendJson(404, { error: 'File not found.' });
            }
            const contents = await fs.promises.readFile(filePath);
            response.writeHead(200, {
                'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                'X-Content-Type-Options': 'nosniff'
            });
            response.end(request.method === 'HEAD' ? undefined : contents);
        } catch (error) {
            if (error instanceof SyntaxError) return sendJson(400, { error: 'Invalid JSON body.' });
            if (error.code === 'ENOENT') return sendJson(404, { error: 'File not found.' });
            console.error(error);
            return sendJson(500, { error: 'Internal server error.' });
        }
    });

    server.on('close', () => database.close());
    return server;
}

async function readJson(request) {
    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) throw new Error('Request body too large.');
    }
    return JSON.parse(body || '{}');
}

if (require.main === module) {
    const port = Number(process.env.PORT) || 3000;
    const server = createServer();
    server.listen(port, () => console.log(`VENTARCH portal running at http://localhost:${port}`));
}

module.exports = { createServer };