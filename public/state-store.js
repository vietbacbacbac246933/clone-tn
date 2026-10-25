'use strict';
/**
 * public/state-store.js
 * ---------------------------------------------------------------------------
 * Giữ dữ liệu của giáo viên trên máy đang dùng (IndexedDB) và đồng bộ vào RAM
 * của serverless function. Chỉ bật ở chế độ serverless không có database
 * (server trả ephemeral: true); chạy local thì server đĩa vẫn là nguồn chính.
 *
 * Ngoài ra cung cấp 2 nút: sao lưu toàn bộ ra file JSON và khôi phục từ file.
 */
(function () {
    var DB_NAME = 'trac-nghiem-state';
    var STORE = 'kv';
    var KEY = 'snapshot';

    var nativeFetch = window.fetch.bind(window);
    var ephemeral = false;
    var version = '';
    var resolveReady;
    var ready = new Promise(function (resolve) {
        resolveReady = resolve;
    });

    function openDb() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) return reject(new Error('Trình duyệt không hỗ trợ IndexedDB.'));
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('Không mở được IndexedDB.')); };
        });
    }

    function dbGet() {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(KEY);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbSet(value) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, KEY);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function readLocal() {
        return dbGet().catch(function () { return null; });
    }

    function writeLocal(snap) {
        return dbSet({
            version: snap.version || '',
            files: snap.files || {},
            assets: snap.assets || {}
        }).catch(function (e) {
            console.error('[STATE] Không lưu được vào IndexedDB:', e);
        });
    }

    function apiPath(url) {
        try {
            var u = new URL(url, window.location.href);
            if (u.origin !== window.location.origin) return null;
            return u.pathname;
        } catch (e) {
            return null;
        }
    }

    function methodOf(init) {
        return String((init && init.method) || 'GET').toUpperCase();
    }

    function isExempt(path, init) {
        if (path.indexOf('/api/state') === 0) return true;
        if (path.indexOf('/api/review/') === 0) return true;
        if (path.indexOf('/api/teacher/login') === 0) return true;
        if (path === '/api/ping') return true;
        // Ảnh <img src="/api/assets/..."> không đi qua fetch; đừng chặn.
        if (methodOf(init) === 'GET' && path.indexOf('/api/assets/') === 0) return true;
        return false;
    }

    function syncWithServer(local, force) {
        var payload = {
            hasLocal: !!local,
            files: local ? local.files : undefined,
            assets: local ? local.assets : undefined,
            version: local ? local.version : undefined,
            force: !!force
        };
        return nativeFetch('/api/state/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (res) {
            if (res.status === 401 || res.status === 403) {
                window.location.href = '/teacher/login';
                throw new Error('Phiên đăng nhập đã hết hạn.');
            }
            if (!res.ok) throw new Error('Không đồng bộ được dữ liệu (HTTP ' + res.status + ').');
            return res.json();
        }).then(function (data) {
            ephemeral = data.ephemeral === true;
            version = data.version || '';
            return data;
        });
    }

    function applyServerState(data) {
        if (!ephemeral) return Promise.resolve();
        return writeLocal({
            version: data.version || '',
            files: data.files || {},
            assets: data.assets || {}
        });
    }

    function boot() {
        return readLocal().then(function (local) {
            return syncWithServer(local, false);
        }).then(function (data) {
            return applyServerState(data);
        }).then(function () {
            resolveReady();
        }).catch(function (err) {
            // Không đồng bộ được thì vẫn cho trang chạy với dữ liệu server hiện có,
            // tránh khóa toàn bộ API chỉ vì IndexedDB lỗi.
            ephemeral = false;
            resolveReady();
            showBanner(err && err.message);
        });
    }

    function showBanner(message) {
        function draw() {
            if (document.getElementById('stateSyncBanner')) return;
            var div = document.createElement('div');
            div.id = 'stateSyncBanner';
            div.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;' +
                'background:#fff3cd;color:#7a5b00;border:1px solid #ffe08a;border-radius:10px;' +
                'padding:10px 16px;font-size:14px;max-width:90vw;box-shadow:0 8px 24px rgba(0,0,0,.15);';
            div.textContent = 'Không tải được dữ liệu đã lưu: ' + (message || 'lỗi không xác định');
            document.body.appendChild(div);
        }
        if (document.body) draw();
        else document.addEventListener('DOMContentLoaded', draw);
    }

    window.fetch = function (input, init) {
        var path = apiPath(typeof input === 'string' ? input : (input && input.url));
        if (!path || isExempt(path, init)) return nativeFetch(input, init);

        return ready.then(function () {
            var opts = init ? Object.assign({}, init) : {};
            var headers = new Headers(opts.headers || (input instanceof Request ? input.headers : undefined));
            if (ephemeral) headers.set('x-state-version', version);
            opts.headers = headers;

            function attempt(left) {
                return nativeFetch(input, opts).then(function (res) {
                    if (ephemeral && res.status === 409 && left > 0) {
                        return readLocal().then(function (local) {
                            return syncWithServer(local, false);
                        }).then(function (data) {
                            version = data.version || '';
                            headers.set('x-state-version', version);
                            opts.headers = headers;
                            return attempt(left - 1);
                        });
                    }
                    if (ephemeral && res.ok && (res.headers.get('content-type') || '').indexOf('application/json') !== -1) {
                        return res.clone().json().then(function (data) {
                            if (data && data.__state) {
                                version = data.__version || version;
                                return writeLocal({
                                    version: version,
                                    files: data.__state,
                                    assets: data.__assets || {}
                                }).then(function () { return res; });
                            }
                            return res;
                        }).catch(function () { return res; });
                    }
                    return res;
                });
            }
            return attempt(2);
        });
    };

    // Anh <img src="/api/assets/..."> khong di qua fetch: instance lanh co the
    // chua co file. Dong bo lai roi tai lai anh mot lan.
    document.addEventListener('error', function (ev) {
        var el = ev.target;
        if (!ephemeral || !el || el.tagName !== 'IMG' || !el.getAttribute) return;
        var src = el.getAttribute('src') || '';
        if (src.indexOf('/api/assets/') === -1 || el.getAttribute('data-state-retry')) return;
        el.setAttribute('data-state-retry', '1');
        readLocal().then(function (local) {
            return syncWithServer(local, false);
        }).then(function () {
            el.src = src;
        }).catch(function () { /* de anh hong nhu cu */ });
    }, true);

    function stamp() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    function notify(message, type) {
        if (typeof window.showAlert === 'function') window.showAlert(message, type || 'warning');
        else window.alert(message);
    }

    window.backupData = function () {
        var getting;
        if (ephemeral) {
            getting = readLocal();
        } else {
            getting = nativeFetch('/api/state', { credentials: 'same-origin' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            });
        }
        getting.then(function (snap) {
            snap = snap || { version: '', files: {}, assets: {} };
            var payload = {
                app: 'trac-nghiem',
                exportedAt: new Date().toISOString(),
                version: snap.version || '',
                files: snap.files || {},
                assets: snap.assets || {}
            };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'trac-nghiem-backup-' + stamp() + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }).catch(function (err) {
            notify('Không sao lưu được dữ liệu: ' + err.message, 'error');
        });
    };

    window.restoreData = function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function () {
            var file = input.files && input.files[0];
            if (!file) return;

            function run() {
                var parsed = null;
                file.text().then(function (text) {
                    var data = JSON.parse(text);
                    if (!data || typeof data.files !== 'object' || data.files === null) {
                        throw new Error('File không đúng định dạng sao lưu.');
                    }
                    parsed = data;
                    if (ephemeral) {
                        return writeLocal({
                            version: data.version || '',
                            files: data.files,
                            assets: data.assets || {}
                        });
                    }
                }).then(function () {
                    return nativeFetch('/api/state/sync', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            hasLocal: true,
                            force: true,
                            files: parsed.files,
                            assets: parsed.assets || {},
                            version: parsed.version || ''
                        })
                    });
                }).then(function (res) {
                    if (!res.ok) throw new Error('Server từ chối (HTTP ' + res.status + ').');
                    return res.json();
                }).then(function (data) {
                    ephemeral = data.ephemeral === true;
                    version = data.version || '';
                    return applyServerState(data);
                }).then(function () {
                    notify('Đã khôi phục dữ liệu. Trang sẽ tải lại...', 'success');
                    setTimeout(function () { window.location.reload(); }, 800);
                }).catch(function (err) {
                    notify('Khôi phục thất bại: ' + err.message, 'error');
                });
            }

            var question = 'Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại. Tiếp tục?';
            if (typeof window.showConfirm === 'function') window.showConfirm(question, run);
            else if (window.confirm(question)) run();
        };
        input.click();
    };

    boot();
})();
