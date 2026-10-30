'use strict';
/**
 * lib/offline-quiz.js
 * ---------------------------------------------------------------------------
 * Tao MOT file HTML tu chay (khong can server/mang) tu danh sach cau hoi da
 * duoc giao vien xac nhan. File gom 2 che do:
 *   - practice: on tap, lam lai theo so luot giao vien dat (0 = khong gioi han)
 *   - exam:     thi mot lan, co the dat thoi gian va tu dong nop khi het gio
 *
 * Diem duoc cham ngay trong trinh duyet theo dung quy tac cua lib/grading.js
 * (single/multi dung het moi duoc diem; truefalse chia theo so y dung; short
 * answer so sanh gia tri so). Trang thai lam bai luu o localStorage.
 *
 * GIOI HAN DA BIET: dap an nam trong file. File phu hop de giao vien gui hoc
 * sinh tu on/tu lam; khong chong duoc hoc sinh doc source.
 */

var crypto = require('crypto');
var katex = require('katex');

function normalizePoints(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 1;
    if (n > 100) return 100;
    return Math.round(n * 100) / 100;
}

function clampInt(v, def, min, max) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = def;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function normalizeSettings(raw) {
    raw = raw || {};
    var mode = raw.mode === 'practice' ? 'practice' : 'exam';
    return {
        mode: mode,
        // Thi chi 1 luot; on tap moi co so luot (0 = khong gioi han).
        attempts: mode === 'practice' ? clampInt(raw.attempts, 0, 0, 99) : 1,
        minutes: mode === 'exam' ? clampInt(raw.minutes, 0, 0, 600) : 0,
        showAnswers: raw.showAnswers !== false,
        // Moi luot lam lai xao lai thu tu cau hoi (mac dinh bat).
        shuffle: raw.shuffle !== false,
        // Bao dung/sai ngay khi chon dap an (mac dinh tat).
        instant: raw.instant === true,
        // Chong gian lan: toan man hinh, chan copy va phim tat (mac dinh bat).
        lockdown: raw.lockdown !== false
    };
}

// ========== CONG THUC TOAN: render san sang MathML ==========
// Khong nhung KaTeX vao file (nang ~1 MB va phai kem font). MathML trinh duyet
// hien dai tu render duoc, giu file offline gon va khong phu thuoc mang.
var ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
function decodeEntities(s) {
    return String(s).replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, function (m) { return ENTITIES[m]; });
}

function renderMathInHtml(html) {
    if (typeof html !== 'string' || (!/\\\(|\\\[/.test(html))) return html || '';
    return html.replace(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g, function (full) {
        var display = full.slice(0, 2) === '\\[';
        var tex = decodeEntities(full.slice(2, -2));
        try {
            return katex.renderToString(tex, {
                output: 'mathml',
                displayMode: display,
                throwOnError: false
            });
        } catch (e) {
            return full;
        }
    });
}

function cleanQuestion(q) {
    q = q || {};
    var type = ['single', 'multi', 'truefalse', 'shortanswer'].indexOf(q.type) >= 0 ? q.type : 'single';
    var options = Array.isArray(q.options) ? q.options.map(function (o) {
        return renderMathInHtml(String(o == null ? '' : o));
    }) : [];
    return {
        type: type,
        question: renderMathInHtml(String(q.question == null ? '' : q.question)),
        options: type === 'shortanswer' ? [] : options,
        correct: typeof q.correct === 'number' ? q.correct : -1,
        correctList: Array.isArray(q.correctList) ? q.correctList.slice() : [],
        correctTF: Array.isArray(q.correctTF) ? q.correctTF.slice() : [],
        correctAnswer: q.correctAnswer == null ? '' : String(q.correctAnswer),
        points: normalizePoints(q.points)
    };
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// Thu tu cau hoi cua mot luot lam. Ham thuan tuy de test duoc; file offline
// nhan ham nay qua tham so nen khong phu thuoc bien ngoai.
function buildOrder(count, shuffle, rng) {
    var order = [];
    for (var i = 0; i < count; i++) order.push(i);
    if (!shuffle) return order;
    rng = rng || Math.random;
    for (var j = order.length - 1; j > 0; j--) {
        var k = Math.floor(rng() * (j + 1));
        var tmp = order[j];
        order[j] = order[k];
        order[k] = tmp;
    }
    return order;
}

// ========== TEMPLATE ==========
// Giao dien + ma chay nam trong template/ (chinh file dang dung de xuat de).
// Chi thay {{TITLE}} va {{QUIZ_DATA}}; khong viet lai HTML/CSS/JS o day.
var fs = require('fs');
var path = require('path');
var TEMPLATE_DIR = path.join(__dirname, '..', 'template');
var templateCache = {};

function readTemplate(name) {
    if (!Object.prototype.hasOwnProperty.call(templateCache, name)) {
        templateCache[name] = fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
    }
    return templateCache[name];
}

// Mot luot thay the: noi dung du lieu khong bi quet lai de tim placeholder.
function fillTemplate(text, values) {
    return text.replace(/\{\{([A-Z_]+)\}\}/g, function (marker, key) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) {
            throw new Error('Template thieu gia tri ' + key);
        }
        return values[key];
    });
}

function normalizeTitle(v) {
    return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, 100) || 'Bài kiểm tra';
}

function buildData(input) {
    input = input || {};
    var settings = normalizeSettings(input.settings);
    var questions = (Array.isArray(input.questions) ? input.questions : []).map(cleanQuestion);
    var title = normalizeTitle(input.title);
    var data = { v: 1, title: title, settings: settings, questions: questions };
    data.id = crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 12);
    return { title: title, data: data };
}

// "<" -> \u003c de noi dung cau hoi khong the dong the <script>.
function jsonForScript(data) {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function renderHtml(title, data) {
    return fillTemplate(readTemplate('exam_template.html'), {
        TITLE: escapeHtml(title),
        QUIZ_DATA: jsonForScript(data)
    });
}

// Dong goi day du de tai len GitHub Pages: HTML + manifest + service worker.
// fileName do server dat (ASCII, khong dau) de manifest/sw tro dung file.
function renderPackage(input) {
    input = input || {};
    var built = buildData(input);
    var fileName = String(input.fileName || 'bai-kiem-tra.html').trim();
    if (!/^[A-Za-z0-9_.-]+\.html$/.test(fileName)) {
        throw new Error('Tên file HTML không hợp lệ: ' + fileName);
    }
    var shortTitle = built.title.length > 12 ? built.title.slice(0, 11).trim() + '…' : built.title;
    // Prefix on dinh theo ten file: ban moi cung de xoa cache cu cua chinh de nay.
    var cachePrefix = 'quiz-' + crypto.createHash('sha1').update(fileName).digest('hex').slice(0, 8) + '-';
    var cacheName = cachePrefix + built.data.id;
    var html = renderHtml(built.title, built.data);
    var manifest = fillTemplate(readTemplate('manifest.webmanifest'), {
        APP_FILE: fileName,
        TITLE_JSON: JSON.stringify(built.title),
        SHORT_TITLE_JSON: JSON.stringify(shortTitle)
    });
    var serviceWorker = fillTemplate(readTemplate('sw.js'), {
        APP_FILE: fileName,
        CACHE_NAME: cacheName,
        CACHE_PREFIX: cachePrefix
    });
    if (html.indexOf('<div id="app"></div>') < 0 || html.indexOf('id="quiz-data"') < 0 ||
        html.indexOf('</html>') < 0) {
        throw new Error('HTML tao ra khong dung template bài thi.');
    }
    return {
        fileName: fileName,
        html: html,
        manifest: manifest,
        serviceWorker: serviceWorker,
        cacheName: cacheName
    };
}

function renderQuiz(input) {
    var built = buildData(input);
    return renderHtml(built.title, built.data);
}

module.exports = {
    renderQuiz: renderQuiz,
    renderPackage: renderPackage,
    normalizeSettings: normalizeSettings,
    renderMathInHtml: renderMathInHtml,
    buildOrder: buildOrder
};
