/**
 * Banner "Mở bằng trình duyệt" cho webview trong app (Zalo, Messenger, Facebook...).
 *
 * Chỉ chèn banner khi UA là in-app browser trên iOS/Android. Desktop và trình duyệt
 * thường không bị ảnh hưởng. Script tự chèn CSS + markup, nên chỉ cần thêm
 * <script src="/open-in-browser.js"></script> ở cuối body của từng trang.
 *
 * CẦN TEST THẬT TRÊN MÁY (không mô phỏng được bằng desktop):
 * - Zalo iOS, Zalo Android: banner có hiện không, nút có mở được trình duyệt không.
 * - Messenger iOS, Messenger Android: như trên.
 * - iOS không thể ép mở Safari từ webview -> chỉ hiện hướng dẫn thủ công.
 * - Android thử intent Chrome; sau 1.5s trang vẫn còn hiện thì hiện hướng dẫn dự phòng.
 */
(function () {
    'use strict';

    var IN_APP_RE = /FBAN|FBAV|Messenger|Zalo|Instagram|Line|MicroMessenger|TikTok|;\s*wv\)/i;
    var DISMISS_KEY = 'openInBrowserDismissed';

    function isInAppBrowser(ua) {
        return IN_APP_RE.test(ua || '');
    }

    function buildIntentUrl(loc) {
        return 'intent://' + loc.host + loc.pathname + loc.search +
            '#Intent;scheme=' + loc.protocol.replace(':', '') +
            ';package=com.android.chrome;end';
    }

    // Giữ hàm thuần để test được bằng node (tests/test-open-in-browser.js).
    if (typeof window !== 'undefined') {
        window.OpenInBrowser = { isInAppBrowser: isInAppBrowser, buildIntentUrl: buildIntentUrl };
    }

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);
    var isAndroid = /Android/i.test(ua);
    if (!isInAppBrowser(ua) || (!isIOS && !isAndroid)) return;

    // Người dùng đã bấm "Tiếp tục tại đây" trong tab này thì không làm phiền lại.
    try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (e) { /* chế độ riêng tư chặn sessionStorage: vẫn hiện banner */ }

    var style = document.createElement('style');
    style.textContent = [
        '#open-in-browser-banner{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;justify-content:center;',
        'padding:12px max(12px,env(safe-area-inset-left)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-right));',
        'background:rgba(18,24,40,.45);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;',
        'animation:oib-in .18s ease-out}',
        '@keyframes oib-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
        '.oib-card{width:100%;max-width:460px;background:#fff;color:#24303f;border-radius:14px;padding:16px;',
        'box-shadow:0 12px 32px rgba(20,30,60,.28)}',
        '.oib-title{font-size:1.02em;font-weight:700;margin:0 0 6px}',
        '.oib-text{margin:0;font-size:.9em;line-height:1.45;color:#4b5563}',
        '.oib-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}',
        '.oib-btn{flex:1 1 auto;min-height:44px;padding:10px 16px;border-radius:10px;font:inherit;font-size:.95em;',
        'font-weight:600;cursor:pointer;border:1px solid transparent}',
        '.oib-primary{background:#4c56c4;color:#fff}',
        '.oib-primary:active{background:#3f48a8}',
        '.oib-ghost{background:#fff;color:#4b5563;border-color:#d5dae6}',
        '.oib-ghost:active{background:#f1f3f9}',
        '.oib-guide{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#f4f6fb;',
        'font-size:.88em;line-height:1.5;color:#374151}',
        '.oib-guide b{color:#24303f}',
        '[hidden]{display:none!important}',
        '@media (min-width:640px){#open-in-browser-banner{padding-bottom:24px}}'
    ].join('');
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'open-in-browser-banner';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Mở bằng trình duyệt');
    box.innerHTML = [
        '<div class="oib-card">',
        '<p class="oib-title">Mở bằng trình duyệt để làm bài ổn định</p>',
        '<p class="oib-text">Bạn đang mở trong ứng dụng Zalo/Messenger. Trình duyệt trong ứng dụng có thể chặn một số chức năng của bài thi.</p>',
        '<div class="oib-actions">',
        '<button type="button" id="btn-open-chrome" class="oib-btn oib-primary">Mở bằng trình duyệt</button>',
        '<button type="button" id="btn-continue-here" class="oib-btn oib-ghost">Tiếp tục tại đây</button>',
        '</div>',
        '<div id="manual-guide" class="oib-guide" hidden>',
        'Không tự mở được? Nhấn nút <b>⋮</b> ở góc trên bên phải, chọn <b>Mở bằng trình duyệt</b> (hoặc <b>Mở trong Chrome</b>).',
        '</div>',
        '<div id="manual-guide-ios" class="oib-guide" hidden>',
        'Nhấn nút <b>⋯</b> hoặc nút <b>Chia sẻ</b> của ứng dụng, rồi chọn <b>Mở trong Safari</b> / <b>Mở bằng trình duyệt</b>.',
        '</div>',
        '</div>'
    ].join('');
    document.body.appendChild(box);

    var openBtn = document.getElementById('btn-open-chrome');
    var guide = document.getElementById('manual-guide');
    var guideIos = document.getElementById('manual-guide-ios');

    document.getElementById('btn-continue-here').addEventListener('click', function () {
        try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* bỏ qua */ }
        if (box.parentNode) box.parentNode.removeChild(box);
    });

    if (isAndroid) {
        openBtn.addEventListener('click', function () {
            var intentUrl = buildIntentUrl(location);
            try {
                location.href = intentUrl;
                // Intent không mở được app nào thì trang vẫn hiện -> chỉ hướng dẫn.
                setTimeout(function () {
                    if (document.visibilityState === 'visible') guide.hidden = false;
                }, 1500);
            } catch (e) {
                guide.hidden = false;
            }
        });
    } else {
        // iOS không cho webview ép mở Safari: chỉ hướng dẫn thủ công.
        openBtn.hidden = true;
        guideIos.hidden = false;
    }
})();
