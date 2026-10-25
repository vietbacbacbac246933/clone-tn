'use strict';
/**
 * lib/datastore.js
 * ---------------------------------------------------------------------------
 * Lop luu tru cho ung dung Trac Nghiem.
 *
 * Muc tieu: giu nguyen 100% code nghiep vu dang doc/ghi file JSON trong
 * thu muc data/, nhung thay backend luu tru:
 *   - Neu co bien moi truong DATABASE_URL  -> dung PostgreSQL (Render managed DB)
 *   - Neu khong co                         -> dung filesystem (chay local nhu cu)
 *
 * Cach dung (giong nhu fs readFileSync/writeFileSync nhung an toan hon):
 *   DATA.readJson(absPath, fallback)  -> doc JSON (tu cache trong RAM)
 *   DATA.writeJson(absPath, value)    -> cap nhat cache + ghi nen (async, queued)
 *   DATA.exists(absPath)              -> kiem tra ton tai
 *   DATA.del(absPath)                 -> xoa
 *   DATA.listJsonNames(absDir)        -> liet ke ten file .json trong thu muc
 *
 * Chi cac file .json nam trong thu muc `data/` cua du an moi duoc quan ly.
 * Cac file nhi phan (mau .docx, file Excel danh sach lop) van nam tren dia
 * va duoc doc bang fs that.
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var assets = require('./assets');

var APP_ROOT = path.resolve(__dirname, '..');
var DATA_ROOT = path.join(APP_ROOT, 'data');
// Tren Vercel, thu muc app la read-only: chi ghi duoc vao /tmp.
// Du lieu that nam trong IndexedDB cua trinh duyet giao vien va duoc dong bo
// qua /api/state/sync; /tmp chi la ban tam cua tung instance.
var IS_SERVERLESS = !!process.env.VERCEL;
var WRITE_ROOT = IS_SERVERLESS ? path.join('/tmp', 'trac-nghiem-data') : DATA_ROOT;
var UPLOAD_ROOT = path.join(WRITE_ROOT, 'uploads');
var DATA_PREFIX = 'data/';

var state = {
    mode: 'filesystem', // 'filesystem' | 'postgres'
    pool: null,
    cache: {},          // relKey ('data/....json') -> value
    chain: Promise.resolve(),
    // Moi instance co tien to rieng; client gui lai version nay o header
    // x-state-version de biet instance da nap dung du lieu chua.
    instance: crypto.randomBytes(4).toString('hex'),
    counter: 0,
    version: ''
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toRelKey(absPath) {
    return path.relative(APP_ROOT, absPath).split(path.sep).join('/');
}

function isManaged(absPath) {
    var rel = toRelKey(absPath);
    return rel === 'data' || rel.indexOf('data/') === 0;
}

function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function enqueue(op) {
    state.chain = state.chain.then(op).catch(function (err) {
        console.error('[STORE] Loi ghi du lieu:', err && err.message);
    });
    return state.chain;
}

function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Ghi file atomic: ghi .tmp roi rename
function fsPutSync(absPath, value) {
    var target = toWritePath(toRelKey(absPath));
    ensureDirSync(path.dirname(target));
    var tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, target);
}

function bumpVersion() {
    state.counter += 1;
    state.version = state.instance + ':' + state.counter;
    return state.version;
}

function adoptVersion(version) {
    var m = /^([a-z0-9]+):(\d+)$/.exec(String(version || ''));
    if (m) {
        state.instance = m[1];
        state.counter = parseInt(m[2], 10);
        state.version = version;
    } else {
        bumpVersion();
    }
    return state.version;
}

function toWritePath(relKey) {
    return path.join(WRITE_ROOT, String(relKey).replace(/^data\//, ''));
}

function diskRoots() {
    return WRITE_ROOT === DATA_ROOT ? [DATA_ROOT] : [DATA_ROOT, WRITE_ROOT];
}

// Quet toan bo *.json trong mot thu muc goc
function scanDisk(root) {
    var out = [];
    function walk(dir) {
        var entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && /\.json$/.test(entry.name)) {
                out.push(full);
            }
        }
    }
    walk(root);
    return out;
}

function cacheKeyFor(root, abs) {
    if (root === DATA_ROOT) return toRelKey(abs);
    return DATA_PREFIX + path.relative(root, abs).split(path.sep).join('/');
}

function loadDiskIntoSync() {
    var loaded = 0;
    diskRoots().forEach(function (root) {
        if (!root) return;
        scanDisk(root).forEach(function (abs) {
            try {
                // /tmp ghi de seed bundled neu cung key.
                state.cache[cacheKeyFor(root, abs)] = JSON.parse(fs.readFileSync(abs, 'utf8'));
                loaded++;
            } catch (e) {
                console.error('[STORE] Bo qua file JSON loi:', abs, e.message);
            }
        });
    });
    state.version = state.instance + ':' + state.counter;
    console.log('[STORE] Filesystem: da nap ' + loaded + ' file JSON');
}

// ---------------------------------------------------------------------------
// PostgreSQL backend
// ---------------------------------------------------------------------------
function useSsl(url) {
    if (/sslmode=disable/i.test(url)) return false;
    if (/@(localhost|127\.0\.0\.1)/i.test(url)) return false;
    return { rejectUnauthorized: false };
}

function pgPut(key, value) {
    return state.pool.query(
        'INSERT INTO quiz_kv (key, value, updated_at) VALUES ($1, $2, now()) ' +
        'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [key, JSON.stringify(value)]
    );
}

function pgDel(key) {
    return state.pool.query('DELETE FROM quiz_kv WHERE key = $1', [key]);
}

function pgAssetTable() {
    return state.pool.query(
        'CREATE TABLE IF NOT EXISTS quiz_assets (' +
        '  id text PRIMARY KEY,' +
        '  data bytea NOT NULL,' +
        '  created_at timestamptz NOT NULL DEFAULT now()' +
        ')'
    );
}

function seedFromDisk() {
    var files = scanDisk();
    var count = 0;
    files.forEach(function (abs) {
        try {
            var rel = toRelKey(abs);
            var value = JSON.parse(fs.readFileSync(abs, 'utf8'));
            state.cache[rel] = value;
            enqueue(function () { return pgPut(rel, value); });
            count++;
        } catch (e) {
            console.error('[STORE] Seed bo qua file loi:', abs, e.message);
        }
    });
    console.log('[STORE] PostgreSQL trong -> da seed ' + count + ' ban ghi tu data/');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
var DATA = {
    get mode() { return state.mode; },
    // Vercel + khong co DATABASE_URL: du lieu that do trinh duyet giao vien giu.
    get ephemeral() { return IS_SERVERLESS && state.mode === 'filesystem'; },
    getVersion: function () { return state.version || (state.version = state.instance + ':0'); },

    init: function () {
        var url = process.env.DATABASE_URL;
        if (!url) {
            state.mode = 'filesystem';
            loadDiskIntoSync();
            console.log('[STORE] Che do: filesystem (khong co DATABASE_URL)');
            return Promise.resolve(state.mode);
        }

        var pg;
        try {
            pg = require('pg');
        } catch (e) {
            console.error('[STORE] Khong tim thay module "pg" -> quay ve filesystem');
            state.mode = 'filesystem';
            loadDiskIntoSync();
            return Promise.resolve(state.mode);
        }

        try {
            state.pool = new pg.Pool({
                connectionString: url,
                ssl: useSsl(url),
                max: Number(process.env.PG_POOL_MAX || 5)
            });
        } catch (e) {
            console.error('[STORE] DATABASE_URL khong hop le: ' + e.message);
            state.mode = 'filesystem';
            state.pool = null;
            loadDiskIntoSync();
            return Promise.resolve(state.mode);
        }

        return state.pool.query(
            'CREATE TABLE IF NOT EXISTS quiz_kv (' +
            '  key text PRIMARY KEY,' +
            '  value jsonb NOT NULL,' +
            '  updated_at timestamptz NOT NULL DEFAULT now()' +
            ')'
        ).then(function () {
            return pgAssetTable();
        }).then(function () {
            return state.pool.query('SELECT key, value FROM quiz_kv');
        }).then(function (res) {
            state.mode = 'postgres';
            if (res.rows.length === 0) {
                seedFromDisk();
            } else {
                res.rows.forEach(function (row) { state.cache[row.key] = row.value; });
                console.log('[STORE] PostgreSQL: da nap ' + res.rows.length + ' ban ghi');
            }
            return state.mode;
        }).catch(function (err) {
            console.error('[STORE] Loi ket noi PostgreSQL: ' + err.message);
            console.error('[STORE] Tam thoi dung filesystem. Kiem tra DATABASE_URL.');
            state.mode = 'filesystem';
            state.pool = null;
            loadDiskIntoSync();
            return state.mode;
        });
    },

    readJson: function (absPath, fallback) {
        if (!isManaged(absPath)) {
            try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); }
            catch (e) { return fallback; }
        }
        var rel = toRelKey(absPath);
        if (has(state.cache, rel)) return state.cache[rel];
        return fallback;
    },

    writeJson: function (absPath, value) {
        var rel = toRelKey(absPath);
        state.cache[rel] = value;
        bumpVersion();
        if (state.mode === 'postgres') {
            enqueue(function () { return pgPut(rel, value); });
        } else {
            enqueue(function () { fsPutSync(absPath, value); });
        }
    },

    del: function (absPath) {
        var rel = toRelKey(absPath);
        delete state.cache[rel];
        bumpVersion();
        if (state.mode === 'postgres') {
            enqueue(function () { return pgDel(rel); });
        } else {
            enqueue(function () {
                try { fs.unlinkSync(toWritePath(rel)); } catch (e) { /* ignore */ }
            });
        }
    },

    exists: function (absPath) {
        if (!isManaged(absPath)) return fs.existsSync(absPath);
        if (has(state.cache, toRelKey(absPath))) return true;
        return fs.existsSync(toWritePath(toRelKey(absPath))) || fs.existsSync(absPath);
    },

    listJsonNames: function (absDir) {
        var names = {};
        var relDir = toRelKey(absDir);
        var prefix = relDir + '/';
        Object.keys(state.cache).forEach(function (key) {
            if (key.indexOf(prefix) === 0) {
                var rest = key.slice(prefix.length);
                if (rest.indexOf('/') === -1 && /\.json$/.test(rest)) names[rest] = true;
            }
        });
        // Chay local: thu muc ghi trung voi data/, khong quet 2 lan.
        var dirs = WRITE_ROOT === DATA_ROOT ? [absDir] : [absDir, toWritePath(relDir)];
        dirs.forEach(function (dir) {
            try {
                fs.readdirSync(dir).forEach(function (n) {
                    if (/\.json$/.test(n)) names[n] = true;
                });
            } catch (e) { /* thu muc chua ton tai */ }
        });
        return Object.keys(names);
    },

    // -----------------------------------------------------------------------
    // Anh tai len: luu nhi phan, khong base64, khong chi nam trong RAM.
    // -----------------------------------------------------------------------
    saveAsset: function (id, buffer) {
        if (!assets.isAssetId(id) || !Buffer.isBuffer(buffer) || !buffer.length) {
            return Promise.reject(new Error('Asset khong hop le'));
        }
        if (state.mode === 'postgres' && state.pool) {
            return state.pool.query(
                'INSERT INTO quiz_assets (id, data) VALUES ($1, $2)',
                [id, buffer]
            );
        }
        ensureDirSync(UPLOAD_ROOT);
        bumpVersion();
        return new Promise(function (resolve, reject) {
            fs.writeFile(path.join(UPLOAD_ROOT, id), buffer, function (err) {
                if (err) reject(err); else resolve();
            });
        });
    },

    readAsset: function (id) {
        if (!assets.isAssetId(id)) return Promise.resolve(null);
        if (state.mode === 'postgres' && state.pool) {
            return state.pool.query('SELECT data FROM quiz_assets WHERE id = $1', [id])
                .then(function (res) {
                    return res.rows.length ? res.rows[0].data : null;
                })
                .catch(function () { return null; });
        }
        return new Promise(function (resolve) {
            fs.readFile(path.join(UPLOAD_ROOT, id), function (err, buffer) {
                resolve(err ? null : buffer);
            });
        });
    },

    deleteAsset: function (id) {
        if (!assets.isAssetId(id)) return Promise.resolve();
        if (state.mode === 'postgres' && state.pool) {
            return state.pool.query('DELETE FROM quiz_assets WHERE id = $1', [id]).catch(function () {});
        }
        bumpVersion();
        return new Promise(function (resolve) {
            fs.unlink(path.join(UPLOAD_ROOT, id), function () { resolve(); });
        });
    },

    // Toan bo du lieu JSON + anh tai len, de trinh duyet giao vien luu lai.
    snapshot: function () {
        var assetMap = {};
        try {
            fs.readdirSync(UPLOAD_ROOT).forEach(function (name) {
                if (!assets.isAssetId(name)) return;
                try {
                    assetMap[name] = fs.readFileSync(path.join(UPLOAD_ROOT, name)).toString('base64');
                } catch (e) { /* bo qua file loi */ }
            });
        } catch (e) { /* chua co thu muc uploads */ }
        return { version: DATA.getVersion(), files: state.cache, assets: assetMap };
    },

    // Khoi phuc tu snapshot cua trinh duyet (hoac file sao luu).
    restore: function (files, assetMap, version) {
        var next = {};
        Object.keys(files || {}).forEach(function (key) {
            if (key.indexOf(DATA_PREFIX) !== 0) return;
            // Chan duong dan thoat khoi thu muc data/ tu snapshot trinh duyet.
            if (key.indexOf('..') !== -1 || key.indexOf('\\') !== -1) return;
            next[key] = files[key];
        });

        var oldKeys = Object.keys(state.cache);
        state.cache = next;

        if (state.mode === 'postgres') {
            oldKeys.forEach(function (key) {
                if (!has(next, key)) enqueue(function () { return pgDel(key); });
            });
            Object.keys(next).forEach(function (key) {
                enqueue(function () { return pgPut(key, next[key]); });
            });
        } else if (!IS_SERVERLESS) {
            // Chay local: ghi lai xuong data/ de mo lai van con.
            oldKeys.forEach(function (key) {
                if (has(next, key)) return;
                try { fs.unlinkSync(toWritePath(key)); } catch (e) { /* ignore */ }
            });
            Object.keys(next).forEach(function (key) {
                fsPutSync(path.join(APP_ROOT, key), next[key]);
            });
        }

        if (assetMap && typeof assetMap === 'object') {
            ensureDirSync(UPLOAD_ROOT);
            try {
                fs.readdirSync(UPLOAD_ROOT).forEach(function (name) {
                    if (assets.isAssetId(name) && !has(assetMap, name)) {
                        try { fs.unlinkSync(path.join(UPLOAD_ROOT, name)); } catch (e) { /* ignore */ }
                    }
                });
            } catch (e) { /* ignore */ }
            Object.keys(assetMap).forEach(function (id) {
                if (!assets.isAssetId(id)) return;
                try {
                    fs.writeFileSync(path.join(UPLOAD_ROOT, id), Buffer.from(String(assetMap[id]), 'base64'));
                } catch (e) { /* ignore */ }
            });
        }

        adoptVersion(version);
        return DATA.getVersion();
    },

    flush: function () {
        return state.chain;
    },

    // Kich thuoc du lieu dang giu trong cache - de tim file JSON phinh to.
    // Postgres: chi doc kich thuoc cot, khong keo du lieu ve Node.
    // Filesystem: doc kich thuoc file. Tra ve toi da `limit` muc lon nhat.
    sizeReport: function (limit) {
        var n = limit || 10;
        if (state.mode === 'postgres' && state.pool) {
            return state.pool.query(
                'SELECT key, pg_column_size(value) AS bytes FROM quiz_kv' +
                ' ORDER BY pg_column_size(value) DESC LIMIT $1', [n]
            ).then(function (res) {
                return res.rows.map(function (r) {
                    return { key: r.key, bytes: Number(r.bytes) || 0 };
                });
            }).catch(function () { return []; });
        }
        var out = [];
        diskRoots().forEach(function (root) {
            (function walk(dir) {
                var entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
                for (var i = 0; i < entries.length; i++) {
                    var p = path.join(dir, entries[i].name);
                    if (entries[i].isDirectory()) { walk(p); continue; }
                    if (!/\.json$/i.test(entries[i].name)) continue;
                    try {
                        out.push({
                            key: cacheKeyFor(root, p),
                            bytes: fs.statSync(p).size
                        });
                    } catch (e2) { /* ignore */ }
                }
            })(root);
        });
        out.sort(function (a, b) { return b.bytes - a.bytes; });
        return Promise.resolve(out.slice(0, n));
    }
};

module.exports = DATA;
