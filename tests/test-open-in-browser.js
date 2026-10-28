'use strict';
/**
 * Test cho public/open-in-browser.js (khong can trinh duyet).
 *   node tests/test-open-in-browser.js
 *
 * Khong thay the duoc viec test that tren Zalo/Messenger iOS + Android.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-in-browser.js'), 'utf8');

const UA = {
    chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    zaloAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 Zalo/23.12.1',
    zaloIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/23.12.1',
    messengerIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/440.0.0.1]',
    androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-A536E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.0.0 Mobile Safari/537.36'
};

// DOM gia: du de script chay, khong parse HTML that.
function makeDom() {
    const els = {};
    const timers = [];
    function makeEl(tag) {
        const el = {
            tagName: tag,
            style: {},
            hidden: false,
            textContent: '',
            children: [],
            parentNode: null,
            _html: '',
            setAttribute() {},
            addEventListener(type, fn) { el['on' + type] = fn; },
            appendChild(child) { child.parentNode = el; el.children.push(child); },
            removeChild(child) {
                el.children = el.children.filter(c => c !== child);
                child.parentNode = null;
            }
        };
        Object.defineProperty(el, 'innerHTML', {
            get() { return el._html; },
            set(html) {
                el._html = html;
                const re = /<[^>]*\bid="([^"]+)"[^>]*>/g;
                let m;
                while ((m = re.exec(html))) {
                    const stub = makeEl('stub');
                    stub.hidden = /\shidden(\s|>)/.test(m[0]);
                    els[m[1]] = stub;
                }
            }
        });
        return el;
    }
    const head = makeEl('head');
    const body = makeEl('body');
    return {
        timers,
        els,
        document: {
            head,
            body,
            visibilityState: 'visible',
            createElement: makeEl,
            getElementById: id => els[id] || null
        }
    };
}

function run(userAgent, opts) {
    opts = opts || {};
    const dom = makeDom();
    const storage = {
        data: opts.dismissed ? { openInBrowserDismissed: '1' } : {},
        getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
        setItem(k, v) { this.data[k] = String(v); }
    };
    const ctx = {
        navigator: { userAgent },
        location: { host: 'tracnghiem.example', pathname: '/on-tap', search: '?listId=abc', hash: '', protocol: 'https:' },
        sessionStorage: storage,
        document: dom.document,
        window: {},
        setTimeout(fn) { dom.timers.push(fn); },
        console
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, dom, storage };
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('  PASS  ' + name); }
    catch (err) { failed++; console.log('  FAIL  ' + name + '  -> ' + err.message); }
}

console.log('nhan dien in-app browser');
check('desktop Chrome: khong chen banner', () => {
    const { dom } = run(UA.chromeDesktop);
    assert.strictEqual(dom.document.body.children.length, 0);
    assert.strictEqual(dom.document.head.children.length, 0);
});
check('Chrome Android: khong chen banner', () => {
    const { dom } = run(UA.chromeAndroid);
    assert.strictEqual(dom.document.body.children.length, 0);
});
check('Zalo Android: chen banner', () => {
    const { dom } = run(UA.zaloAndroid);
    assert.strictEqual(dom.document.body.children.length, 1);
    assert.ok(dom.els['btn-open-chrome']);
    assert.strictEqual(dom.els['manual-guide'].hidden, true, 'huong dan Android phai an truoc');
});
check('Zalo iOS: hien huong dan, an nut mo Chrome', () => {
    const { dom } = run(UA.zaloIos);
    assert.strictEqual(dom.els['btn-open-chrome'].hidden, true);
    assert.strictEqual(dom.els['manual-guide-ios'].hidden, false);
});
check('Messenger iOS: chen banner', () => {
    const { dom } = run(UA.messengerIos);
    assert.strictEqual(dom.document.body.children.length, 1);
});
check('Android WebView (wv): chen banner', () => {
    const { dom } = run(UA.androidWebView);
    assert.strictEqual(dom.document.body.children.length, 1);
});
check('ham isInAppBrowser tra ve dung', () => {
    const { ctx } = run(UA.chromeDesktop);
    const api = ctx.window.OpenInBrowser;
    assert.strictEqual(api.isInAppBrowser(UA.zaloAndroid), true);
    assert.strictEqual(api.isInAppBrowser(UA.messengerIos), true);
    assert.strictEqual(api.isInAppBrowser(UA.chromeDesktop), false);
});

console.log('nut mo trinh duyet');
check('Android: bam nut -> intent Chrome dung URL', () => {
    const { dom, ctx } = run(UA.zaloAndroid);
    dom.els['btn-open-chrome'].onclick();
    assert.strictEqual(
        ctx.location.href,
        'intent://tracnghiem.example/on-tap?listId=abc#Intent;scheme=https;package=com.android.chrome;end'
    );
});
check('Android: intent that bai -> hien huong dan du phong', () => {
    const { dom } = run(UA.zaloAndroid);
    dom.els['btn-open-chrome'].onclick();
    assert.strictEqual(dom.els['manual-guide'].hidden, true, 'chua het 1.5s');
    dom.timers.forEach(fn => fn());
    assert.strictEqual(dom.els['manual-guide'].hidden, false);
});
check('buildIntentUrl giu dung scheme cua trang', () => {
    const { ctx } = run(UA.chromeDesktop);
    const url = ctx.window.OpenInBrowser.buildIntentUrl({
        host: 'localhost:3000', pathname: '/on-tap', search: '', protocol: 'http:'
    });
    assert.strictEqual(url, 'intent://localhost:3000/on-tap#Intent;scheme=http;package=com.android.chrome;end');
});

console.log('tiep tuc tai day');
check('bam "Tiep tuc tai day" -> an banner va ghi nho trong tab', () => {
    const { dom, storage } = run(UA.zaloAndroid);
    dom.els['btn-continue-here'].onclick();
    assert.strictEqual(dom.document.body.children.length, 0);
    assert.strictEqual(storage.data.openInBrowserDismissed, '1');
});
check('da bam truoc do -> khong hien lai', () => {
    const { dom } = run(UA.zaloAndroid, { dismissed: true });
    assert.strictEqual(dom.document.body.children.length, 0);
    assert.strictEqual(dom.document.head.children.length, 0);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
