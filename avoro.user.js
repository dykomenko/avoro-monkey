// ==UserScript==
// @name         Avoro IP + Traffic + Billing Finder
// @namespace    https://greasyfork.org/users/your-id
// @version      4.0.0
// @description  Показывает все IP, трафик и биллинг для услуг Avoro прямо в списке, с кэшированием. Клик по блоку — копирует IP.
// @author       dykomenko
// @homepageURL  https://github.com/dykomenko/avoro-monkey
// @supportURL   https://github.com/dykomenko/avoro-monkey/issues
// @updateURL    https://raw.githubusercontent.com/dykomenko/avoro-monkey/main/avoro.user.js
// @downloadURL  https://raw.githubusercontent.com/dykomenko/avoro-monkey/main/avoro.user.js
// @match        https://avoro.eu/cp/clientarea.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      avoro.eu
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_KEY = 'avoro_service_data_cache_v5';
    const OLD_CACHE_KEYS = ['avoro_service_data_cache_v4'];

    const TTL_IP_MS = 7 * 24 * 60 * 60 * 1000;       // 7 дней
    const TTL_TRAFFIC_MS = 60 * 60 * 1000;           // 1 час
    const TTL_BILLING_MS = 12 * 60 * 60 * 1000;      // 12 часов

    const MAX_PARALLEL_REQUESTS = 3;

    const PRIMARY_IP_LABEL_HINTS = [
        'primary ip',
        'main ip',
        'ip principal',
        'ip principale',
        'haupt-ip',
        'основной ip',
        'основной ip-адрес',
        'primary address'
    ];

    const IP_LABEL_TOKENS = ['ip', 'ips', 'ipv4', 'ipv6', 'ip-adresse', 'ip-adressen'];

    const TRAFFIC_TITLE_HINTS = [
        'bandwidth',
        'traffic',
        'trafic',
        'datenverkehr',
        'bande passante',
        'трафик'
    ];

    const DUE_LABEL_HINTS = [
        'next due',
        'next due date',
        'due',
        'due date',
        'expiration',
        'expiry',
        'expire',
        'expires',
        'valid until',
        'renewal date',
        'renews on',
        'fällig',
        'faellig',
        'ablauf',
        'läuft bis',
        'lauft bis',
        'vence',
        'expira',
        'действует до',
        'оплачен до',
        'истекает',
        'срок действия',
        'следующая дата оплаты'
    ];

    const REGISTRATION_LABEL_HINTS = [
        'registration',
        'registered',
        'created',
        'creation',
        'order date',
        'activation',
        'signup',
        'registrierung',
        'bestelldatum',
        'дата регистрации',
        'регистрац',
        'создан',
        'заказан',
        'активац'
    ];

    const BILLING_CYCLE_LABEL_HINTS = [
        'billing',
        'billing cycle',
        'cycle',
        'period',
        'abrechnung',
        'abrechnungszyklus',
        'zyklus',
        'facturation',
        'periodo',
        'billing period',
        'период',
        'биллинг',
        'срок оплаты'
    ];

    const AMOUNT_LABEL_HINTS = [
        'renewal amount',
        'recurring amount',
        'amount',
        'price',
        'cost',
        'total',
        'betrag',
        'preis',
        'montant',
        'importe',
        'сумма',
        'стоимость',
        'цена'
    ];

    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TR', 'TD', 'TH', 'TABLE', 'TBODY', 'THEAD',
        'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'LABEL'
    ]);

    const processed = new WeakSet();
    const memoryCache = new Map();

    // ---------------------------------------------------------------- styles

    const STYLES = `
        .tm-av {
            position: relative;
            flex: 1 0 100%;
            box-sizing: border-box;
            width: 100%;
            margin-top: 6px;
            padding: 7px 34px 7px 10px;
            display: grid;
            gap: 3px;
            border: 1px solid rgba(127, 127, 127, .22);
            border-radius: 8px;
            background: rgba(127, 127, 127, .05);
            font-size: 12px;
            font-weight: 400;
            line-height: 1.45;
            color: inherit;
            text-align: left;
            cursor: copy;
            transition: border-color .12s, background-color .12s;
        }
        .tm-av:hover {
            border-color: rgba(59, 130, 246, .55);
            background: rgba(59, 130, 246, .06);
        }
        .tm-av.tm-av-flash {
            border-color: rgba(22, 163, 74, .7);
            background: rgba(22, 163, 74, .08);
        }
        .tm-av-row {
            display: grid;
            grid-template-columns: 54px minmax(0, 1fr);
            align-items: center;
            column-gap: 8px;
            min-height: 20px;
        }
        .tm-av-k {
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: .04em;
            text-transform: uppercase;
            opacity: .55;
            white-space: nowrap;
        }
        .tm-av-v {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 3px 6px;
            min-width: 0;
        }
        .tm-av-muted { opacity: .6; }
        .tm-av-ip {
            margin: 0;
            padding: 0 6px;
            border: 0;
            border-radius: 4px;
            background: rgba(127, 127, 127, .14);
            color: inherit;
            font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            cursor: copy;
            white-space: nowrap;
        }
        .tm-av-ip:hover { background: rgba(59, 130, 246, .2); }
        .tm-av-ip.tm-av-ok { background: rgba(22, 163, 74, .25); }
        .tm-av-bar {
            position: relative;
            width: 72px;
            height: 6px;
            border-radius: 3px;
            background: rgba(127, 127, 127, .2);
            overflow: hidden;
        }
        .tm-av-bar > i {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            border-radius: 3px;
        }
        .tm-av-pct { font-weight: 700; font-variant-numeric: tabular-nums; }
        .tm-av-pill {
            padding: 0 7px;
            border-radius: 9px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            background: rgba(127, 127, 127, .14);
        }
        .tm-av-pill.tm-av-warn { background: rgba(234, 179, 8, .22); color: #a16207; }
        .tm-av-pill.tm-av-bad { background: rgba(220, 38, 38, .16); color: #b91c1c; }
        .tm-av-refresh {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 24px;
            height: 24px;
            padding: 0;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: inherit;
            font-size: 15px;
            line-height: 24px;
            text-align: center;
            opacity: .45;
            cursor: pointer;
        }
        .tm-av-refresh:hover { opacity: 1; background: rgba(127, 127, 127, .16); }
        .tm-av-refresh.tm-av-spin { animation: tm-av-spin .8s linear infinite; opacity: .8; }
        @keyframes tm-av-spin { to { transform: rotate(360deg); } }
        .tm-av-toast {
            position: fixed;
            left: 50%;
            bottom: 24px;
            z-index: 2147483647;
            transform: translate(-50%, 8px);
            max-width: calc(100vw - 32px);
            padding: 8px 14px;
            border-radius: 8px;
            background: #111827;
            color: #fff;
            font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;
            box-shadow: 0 6px 20px rgba(0, 0, 0, .25);
            white-space: pre-line;
            pointer-events: none;
            opacity: 0;
            transition: opacity .15s, transform .15s;
        }
        .tm-av-toast.tm-av-show { opacity: 1; transform: translate(-50%, 0); }
    `;

    function injectStyles() {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(STYLES);
            return;
        }
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------- text helpers

    function absoluteUrl(path) {
        return new URL(path, location.href).href;
    }

    function cleanupText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeText(value) {
        return cleanupText(value)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[:|]+/g, ' ')
            .toLowerCase();
    }

    function normalizeHostname(hostname) {
        return normalizeText(hostname);
    }

    function uniqueElements(list) {
        return [...new Set(list.filter(Boolean))];
    }

    function labelContainsAny(label, hints) {
        return hints.some((hint) => label.includes(normalizeText(hint)));
    }

    // textContent склеивает строки, разделённые <br>, поэтому собираем текст сами
    function nodeText(root) {
        let out = '';

        function walk(node) {
            if (node.nodeType === 3) {
                out += node.nodeValue;
                return;
            }
            if (node.nodeType !== 1) return;

            const tag = node.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;
            if (tag === 'BR') {
                out += '\n';
                return;
            }
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                out += '\n' + (node.value || node.getAttribute('value') || '') + '\n';
                return;
            }

            const isBlock = BLOCK_TAGS.has(tag);
            if (isBlock) out += '\n';
            for (const child of node.childNodes) walk(child);
            if (isBlock) out += '\n';
        }

        if (root) walk(root);
        return out;
    }

    // ---------------------------------------------------------------- cache

    function loadStorageCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            console.warn('Failed to load cache:', e);
            return {};
        }
    }

    function saveStorageCache(cache) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn('Failed to save cache:', e);
        }
    }

    function getNow() {
        return Date.now();
    }

    function makeLinkKey(url) {
        return 'link:' + url;
    }

    function makeHostKey(hostname) {
        return 'host:' + normalizeHostname(hostname);
    }

    function isFresh(ts, ttl) {
        return typeof ts === 'number' && (getNow() - ts <= ttl);
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function cleanupExpiredCache() {
        try {
            OLD_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch (e) {
            // ignore
        }

        const cache = loadStorageCache();
        let changed = false;

        for (const key of Object.keys(cache)) {
            const item = cache[key];
            if (!item || typeof item !== 'object') {
                delete cache[key];
                changed = true;
                continue;
            }

            const hasFreshIp = item.ips && isFresh(item.ipTs, TTL_IP_MS);
            const hasFreshTraffic = item.traffic && isFresh(item.trafficTs, TTL_TRAFFIC_MS);
            const hasFreshBilling = hasOwn(item, 'billingTs') && isFresh(item.billingTs, TTL_BILLING_MS);

            if (!hasFreshIp && !hasFreshTraffic && !hasFreshBilling) {
                delete cache[key];
                changed = true;
            }
        }

        if (changed) saveStorageCache(cache);
    }

    function readCacheEntryByKey(key) {
        if (memoryCache.has(key)) return memoryCache.get(key);

        const cache = loadStorageCache();
        const entry = cache[key] || null;
        if (entry) memoryCache.set(key, entry);
        return entry;
    }

    function writeCacheEntryByKey(key, patch) {
        const cache = loadStorageCache();
        const prev = cache[key] && typeof cache[key] === 'object' ? cache[key] : {};
        const next = { ...prev, ...patch };
        cache[key] = next;
        saveStorageCache(cache);
        memoryCache.set(key, next);
    }

    function deleteCacheEntryByKey(key) {
        const cache = loadStorageCache();
        delete cache[key];
        saveStorageCache(cache);
        memoryCache.delete(key);
    }

    function clearAllCache() {
        try {
            localStorage.removeItem(CACHE_KEY);
        } catch (e) {
            // ignore
        }
        memoryCache.clear();
    }

    function getCachedData(url, hostname) {
        const result = {
            ips: null,
            traffic: null,
            billing: null,
            hasFreshBilling: false,
            fetchedAt: null
        };

        const keys = [];
        if (url) keys.push(makeLinkKey(url));
        if (hostname) keys.push(makeHostKey(hostname));

        for (const key of keys) {
            const entry = readCacheEntryByKey(key);
            if (!entry) continue;

            if (!result.ips && Array.isArray(entry.ips) && entry.ips.length && isFresh(entry.ipTs, TTL_IP_MS)) {
                result.ips = entry.ips;
            }

            if (!result.traffic && entry.traffic && isFresh(entry.trafficTs, TTL_TRAFFIC_MS)) {
                result.traffic = entry.traffic;
            }

            const hasFreshBilling = hasOwn(entry, 'billingTs') && isFresh(entry.billingTs, TTL_BILLING_MS);
            if (hasFreshBilling && (!result.hasFreshBilling || (!result.billing && entry.billing))) {
                result.billing = entry.billing || null;
                result.hasFreshBilling = true;
            }

            const ts = Math.min(...[entry.ipTs, entry.trafficTs, entry.billingTs].filter((v) => typeof v === 'number'));
            if (isFinite(ts)) {
                result.fetchedAt = result.fetchedAt ? Math.min(result.fetchedAt, ts) : ts;
            }
        }

        return result;
    }

    function setCachedData(url, hostname, data) {
        const keys = [];
        if (url) keys.push(makeLinkKey(url));
        if (hostname) keys.push(makeHostKey(hostname));

        const patch = {};
        const now = getNow();

        if (Array.isArray(data.ips) && data.ips.length) {
            patch.ips = data.ips;
            patch.ipTs = now;
        }

        if (data.traffic && data.traffic.percentText) {
            patch.traffic = data.traffic;
            patch.trafficTs = now;
        }

        if (hasOwn(data, 'billing')) {
            patch.billing = data.billing || null;
            patch.billingTs = now;
        }

        if (!Object.keys(patch).length) return;

        for (const key of keys) {
            writeCacheEntryByKey(key, patch);
        }
    }

    function clearCachedData(url, hostname) {
        if (url) deleteCacheEntryByKey(makeLinkKey(url));
        if (hostname) deleteCacheEntryByKey(makeHostKey(hostname));
    }

    // ---------------------------------------------------------------- network

    const requestQueue = [];
    let activeRequests = 0;

    function pumpQueue() {
        while (activeRequests < MAX_PARALLEL_REQUESTS && requestQueue.length) {
            const job = requestQueue.shift();
            activeRequests += 1;
            job.run()
                .then(job.resolve, job.reject)
                .finally(() => {
                    activeRequests -= 1;
                    pumpQueue();
                });
        }
    }

    function enqueue(run) {
        return new Promise((resolve, reject) => {
            requestQueue.push({ run, resolve, reject });
            pumpQueue();
        });
    }

    function gmRequestText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error('HTTP ' + response.status));
                    }
                },
                onerror: () => reject(new Error('Request failed'))
            });
        });
    }

    async function fetchText(url) {
        // Страница same-origin: обычный fetch уносит куки Cloudflare как у самой вкладки
        try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return await response.text();
        } catch (err) {
            if (typeof GM_xmlhttpRequest !== 'function') throw err;
            return gmRequestText(url);
        }
    }

    async function requestText(url) {
        const html = await enqueue(() => fetchText(url));
        if (/cf-chl-|challenge-platform|<title>\s*Just a moment/i.test(html)) {
            throw new Error('Cloudflare challenge');
        }
        return html;
    }

    // ---------------------------------------------------------------- IP parsing

    function isIpv4(token) {
        const match = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
        if (!match) return false;
        if (match.slice(1, 5).some((octet) => Number(octet) > 255)) return false;
        return match[5] === undefined || Number(match[5]) <= 32;
    }

    function isIpv6(token) {
        const match = token.match(/^([0-9a-f:.]+)(?:\/(\d{1,3}))?$/i);
        if (!match) return false;
        const address = match[1];
        if ((address.match(/:/g) || []).length < 2) return false;
        if (!/[0-9a-f]/i.test(address)) return false;
        if (match[2] !== undefined && Number(match[2]) > 128) return false;
        try {
            new URL('http://[' + address + ']/');
            return true;
        } catch (e) {
            return false;
        }
    }

    function extractIps(text) {
        const found = [];
        const tokens = String(text || '').split(/[\s,;|()[\]<>"']+/);

        for (const rawToken of tokens) {
            const token = rawToken.replace(/^[^0-9a-f:]+|[^0-9a-f:/]+$/gi, '');
            if (!token) continue;
            if (isIpv4(token) || isIpv6(token)) {
                if (!found.includes(token)) found.push(token);
            }
        }

        return found;
    }

    function matchesPrimaryIpLabel(label) {
        if (!label) return false;
        if (labelContainsAny(label, PRIMARY_IP_LABEL_HINTS)) return true;

        return label.includes('ip') && (
            label.includes('primary') ||
            label.includes('main') ||
            label.includes('основ') ||
            label.includes('haupt') ||
            label.includes('princip')
        );
    }

    function matchesAnyIpLabel(label) {
        if (!label || label.length > 40) return false;
        if (matchesPrimaryIpLabel(label)) return true;
        if (label.includes('ip-адрес') || label.includes('ip адрес') || label.includes('ip address')) return true;

        const tokens = label.split(/[^a-z0-9а-я-]+/i).filter(Boolean);
        return tokens.some((token) => IP_LABEL_TOKENS.includes(token));
    }

    function getLabelValueCandidates(labelNode) {
        const candidates = [];

        if (labelNode.tagName === 'DT' || labelNode.tagName === 'TH') {
            let sibling = labelNode.nextElementSibling;
            if (sibling && (sibling.tagName === 'DD' || sibling.tagName === 'TD')) {
                candidates.push(sibling);
            }
        }

        candidates.push(labelNode.nextElementSibling);

        const row = labelNode.closest('.row, tr, li, .form-group, .list-group-item');
        if (row) candidates.push(row);

        candidates.push(labelNode.parentElement);
        return uniqueElements(candidates);
    }

    function parseIpsFromDoc(doc) {
        const primary = [];
        const secondary = [];
        const labelNodes = [...doc.querySelectorAll('strong, b, dt, th, label, .text-muted')];

        for (const labelNode of labelNodes) {
            const label = normalizeText(labelNode.textContent);
            if (!matchesAnyIpLabel(label)) continue;

            const target = matchesPrimaryIpLabel(label) ? primary : secondary;

            for (const candidate of getLabelValueCandidates(labelNode)) {
                const ips = extractIps(nodeText(candidate));
                if (ips.length) {
                    target.push(...ips);
                    break;
                }
            }
        }

        const combined = [...new Set([...primary, ...secondary])];
        if (combined.length) return combined;

        const domainBlock = doc.querySelector('#domain');
        if (domainBlock) {
            const ips = extractIps(nodeText(domainBlock));
            if (ips.length) return ips;
        }

        const bodyIps = extractIps(nodeText(doc.body)).filter(isIpv4);
        return bodyIps.length ? [bodyIps[0]] : [];
    }

    // ---------------------------------------------------------------- traffic parsing

    function parseFlexibleNumber(value) {
        const compact = String(value || '').replace(/\s+/g, '');
        if (!compact) return NaN;

        const commaCount = (compact.match(/,/g) || []).length;
        const dotCount = (compact.match(/\./g) || []).length;

        if (commaCount && dotCount) {
            const decimalSeparator = compact.lastIndexOf(',') > compact.lastIndexOf('.') ? ',' : '.';
            const thousandsPattern = decimalSeparator === ',' ? /\./g : /,/g;
            return parseFloat(compact.replace(thousandsPattern, '').replace(decimalSeparator, '.'));
        }

        if (commaCount > 1) {
            return parseFloat(compact.replace(/,/g, ''));
        }

        if (dotCount > 1) {
            return parseFloat(compact.replace(/\./g, ''));
        }

        if (commaCount === 1) {
            const parts = compact.split(',');
            if (parts[1] && parts[1].length <= 2) {
                return parseFloat(parts[0] + '.' + parts[1]);
            }
            return parseFloat(compact.replace(',', ''));
        }

        if (dotCount === 1) {
            const parts = compact.split('.');
            if (parts[1] && parts[1].length > 2) {
                return parseFloat(compact.replace('.', ''));
            }
        }

        return parseFloat(compact);
    }

    function toMb(value, unit) {
        switch (unit) {
            case 'KB': return value / 1024;
            case 'MB': return value;
            case 'GB': return value * 1024;
            case 'TB': return value * 1024 * 1024;
            default: return value;
        }
    }

    function parseTrafficValue(raw) {
        if (!raw) return null;

        const cleaned = cleanupText(raw);
        const match = cleaned.match(/([\d.,]+)\s*(KB|MB|GB|TB)?\s*\/\s*([\d.,]+)\s*(KB|MB|GB|TB)?/i);
        if (!match) return null;

        const usedValue = parseFlexibleNumber(match[1]);
        const usedUnit = (match[2] || 'MB').toUpperCase();
        const totalValue = parseFlexibleNumber(match[3]);
        const totalUnit = (match[4] || usedUnit).toUpperCase();

        if (!isFinite(usedValue) || !isFinite(totalValue) || totalValue <= 0) return null;

        const usedMb = toMb(usedValue, usedUnit);
        const totalMb = toMb(totalValue, totalUnit);

        if (!isFinite(usedMb) || !isFinite(totalMb) || totalMb <= 0) return null;

        const percent = (usedMb / totalMb) * 100;
        const clamped = Math.max(0, Math.min(100, percent));

        return {
            usedText: `${cleanupText(match[1])} ${usedUnit}`,
            totalText: `${cleanupText(match[3])} ${totalUnit}`,
            percent: clamped,
            percentText: `${Math.round(clamped)}%`
        };
    }

    function matchesTrafficTitle(title) {
        return title && labelContainsAny(title, TRAFFIC_TITLE_HINTS);
    }

    function parseTrafficValueFromContainer(container) {
        if (!container) return null;

        const nodes = [container, ...container.querySelectorAll('p, div, span, li')];
        for (const node of nodes) {
            const parsed = parseTrafficValue(node.textContent);
            if (parsed) return parsed;
        }

        return null;
    }

    function parseTrafficFromDoc(doc) {
        const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6, strong')];

        for (const heading of headings) {
            const title = normalizeText(heading.textContent);
            if (!matchesTrafficTitle(title)) continue;

            const containers = uniqueElements([
                heading.closest('.col-sm-6'),
                heading.closest('.col-md-6'),
                heading.closest('.col-lg-6'),
                heading.parentElement,
                heading.closest('.well')
            ]);

            for (const container of containers) {
                const parsed = parseTrafficValueFromContainer(container);
                if (parsed) return parsed;
            }
        }

        const usageContainers = [...doc.querySelectorAll('.well, .row, .col-sm-6, .col-md-6')];
        for (const container of usageContainers) {
            const text = normalizeText(container.textContent);
            if (!matchesTrafficTitle(text)) continue;

            const parsed = parseTrafficValueFromContainer(container);
            if (parsed) return parsed;
        }

        return null;
    }

    // ---------------------------------------------------------------- billing parsing

    function looksLikeDate(text) {
        const value = cleanupText(text);
        if (!value) return false;

        return /\b(?:19|20)\d{2}\b/.test(value) ||
            /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(value) ||
            /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/.test(value);
    }

    function compactDateText(text) {
        let value = cleanupText(text);
        if (!value) return value;

        const parts = value.split(',').map((part) => cleanupText(part)).filter(Boolean);
        if (parts.length > 1 && !/\d/.test(parts[0]) && parts.slice(1).some((part) => /\d/.test(part))) {
            value = parts.slice(1).join(', ');
        }

        value = value.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, '').trim();
        return value;
    }

    function toIsoDate(year, month, day) {
        let y = Number(year);
        let m = Number(month);
        let d = Number(day);
        if (y < 100) y += 2000;
        if (m > 12 && d <= 12) [m, d] = [d, m];
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    function parseDueIso(text) {
        const value = cleanupText(text);
        if (!value) return null;

        let match = value.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
        if (match) return toIsoDate(match[1], match[2], match[3]);

        match = value.match(/\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/);
        if (match) return toIsoDate(match[3], match[2], match[1]);

        const parsed = Date.parse(value.replace(/(\d)(st|nd|rd|th)\b/gi, '$1'));
        if (!isNaN(parsed)) {
            const date = new Date(parsed);
            return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
        }

        return null;
    }

    function daysUntil(isoDate) {
        if (!isoDate) return null;
        const [y, m, d] = isoDate.split('-').map(Number);
        const due = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((due - today) / 86400000);
    }

    function extractMoneyText(text) {
        const value = cleanupText(text);
        if (!value) return null;

        const patterns = [
            /[$€£¥₽₹]\s*\d[\d\s.,]*/i,
            /\b[A-Z]{3}\s*\d[\d\s.,]*/i,
            /\d[\d\s.,]*\s*[$€£¥₽₹]/i,
            /\d[\d\s.,]*\s*\b[A-Z]{3}\b/i,
            /\d[\d\s.,]*\s*(?:euro|eur|usd|gbp|chf|pln|czk|ron|bgn|try|uah|rub|byn|грн|руб(?:\.|л(?:ей|я|ь)?)?|zł|zl)\b/i
        ];

        for (const pattern of patterns) {
            const match = value.match(pattern);
            if (match) return cleanupText(match[0]);
        }

        return null;
    }

    function extractDefinitionPairs(container) {
        const pairs = [];
        if (!container) return pairs;

        for (const dl of container.querySelectorAll('dl')) {
            const children = [...dl.children];
            for (let i = 0; i < children.length; i += 1) {
                const current = children[i];
                const next = children[i + 1];
                if (!current || !next) continue;
                if (current.tagName !== 'DT' || next.tagName !== 'DD') continue;

                pairs.push({
                    label: cleanupText(current.textContent),
                    value: cleanupText(next.textContent),
                    normalizedLabel: normalizeText(current.textContent)
                });
            }
        }

        return pairs;
    }

    function findOverviewInfoContainer(doc) {
        const candidates = [...doc.querySelectorAll('#tabOverview .well, .well')];
        return candidates.find((candidate) => candidate.querySelector('dl dt') && candidate.querySelector('dl dd')) || null;
    }

    function parseBillingFromDoc(doc) {
        const infoContainer = findOverviewInfoContainer(doc);
        const pairs = extractDefinitionPairs(infoContainer);
        if (!pairs.length) return null;

        const amountPair = pairs.find((pair) => labelContainsAny(pair.normalizedLabel, AMOUNT_LABEL_HINTS) && extractMoneyText(pair.value)) ||
            pairs.find((pair) => extractMoneyText(pair.value));

        const cyclePair = pairs.find((pair) =>
            labelContainsAny(pair.normalizedLabel, BILLING_CYCLE_LABEL_HINTS) &&
            !extractMoneyText(pair.value) &&
            !looksLikeDate(pair.value)
        );

        let duePair = pairs.find((pair) =>
            labelContainsAny(pair.normalizedLabel, DUE_LABEL_HINTS) &&
            looksLikeDate(pair.value)
        );

        if (!duePair) {
            const datePairs = pairs.filter((pair) =>
                looksLikeDate(pair.value) &&
                !labelContainsAny(pair.normalizedLabel, REGISTRATION_LABEL_HINTS)
            );
            duePair = datePairs[datePairs.length - 1] || null;
        }

        const amountText = amountPair ? extractMoneyText(amountPair.value) : null;
        const cycleText = cyclePair ? cleanupText(cyclePair.value) : null;
        const dueText = duePair ? compactDateText(duePair.value) : null;
        const dueIso = duePair ? parseDueIso(duePair.value) : null;

        if (!amountText && !cycleText && !dueText) {
            return null;
        }

        return {
            amountText,
            cycleText,
            dueText,
            dueIso
        };
    }

    function parseServiceDataFromHtml(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        return {
            ips: parseIpsFromDoc(doc),
            traffic: parseTrafficFromDoc(doc) || null,
            billing: parseBillingFromDoc(doc)
        };
    }

    async function fetchServiceData(detailsPath, hostname, forceRefresh = false) {
        const url = absoluteUrl(detailsPath);

        if (!forceRefresh) {
            const cached = getCachedData(url, hostname);
            if (cached.ips && cached.traffic && cached.hasFreshBilling) {
                return cached;
            }
        } else {
            clearCachedData(url, hostname);
        }

        const html = await requestText(url);
        const parsed = parseServiceDataFromHtml(html);

        setCachedData(url, hostname, parsed);
        const finalCached = getCachedData(url, hostname);

        return {
            ips: parsed.ips.length ? parsed.ips : (finalCached.ips || []),
            traffic: parsed.traffic || finalCached.traffic || null,
            billing: parsed.billing,
            fetchedAt: getNow()
        };
    }

    // ---------------------------------------------------------------- UI

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function getTrafficColor(percent) {
        if (!isFinite(percent)) return '#9ca3af';
        if (percent < 60) return '#16a34a';
        if (percent < 85) return '#d97706';
        return '#dc2626';
    }

    function formatAge(ts) {
        if (!ts) return '';
        const minutes = Math.round((getNow() - ts) / 60000);
        if (minutes < 1) return 'только что';
        if (minutes < 60) return `${minutes} мин назад`;
        const hours = Math.round(minutes / 60);
        if (hours < 48) return `${hours} ч назад`;
        return `${Math.round(hours / 24)} дн назад`;
    }

    let toastNode = null;
    let toastTimer = null;

    function showToast(text) {
        if (!toastNode) {
            toastNode = el('div', 'tm-av-toast');
            document.body.appendChild(toastNode);
        }
        toastNode.textContent = text;
        // force reflow, чтобы анимация срабатывала на повторных показах
        void toastNode.offsetWidth;
        toastNode.classList.add('tm-av-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastNode.classList.remove('tm-av-show'), 1600);
    }

    async function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            return;
        }
        await navigator.clipboard.writeText(text);
    }

    async function copyWithFeedback(text, flashNode, flashClass) {
        try {
            await copyText(text);
            showToast('Скопировано:\n' + text);
            if (flashNode) {
                flashNode.classList.add(flashClass);
                setTimeout(() => flashNode.classList.remove(flashClass), 700);
            }
        } catch (err) {
            console.error(err);
            showToast('Не удалось скопировать');
        }
    }

    function makeRow(label) {
        const row = el('div', 'tm-av-row');
        const value = el('div', 'tm-av-v');
        row.append(el('span', 'tm-av-k', label), value);
        return { row, value };
    }

    function renderIps(container, ips) {
        if (!ips || !ips.length) {
            container.append(el('span', 'tm-av-muted', 'не найден'));
            return;
        }

        for (const ip of ips) {
            const chip = el('button', 'tm-av-ip', ip);
            chip.type = 'button';
            chip.title = 'Скопировать ' + ip;
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copyWithFeedback(ip, chip, 'tm-av-ok');
            });
            container.append(chip);
        }
    }

    function renderTraffic(container, traffic) {
        if (!traffic || !traffic.percentText) {
            container.append(el('span', 'tm-av-muted', 'не найден'));
            return;
        }

        const color = getTrafficColor(traffic.percent);
        const bar = el('span', 'tm-av-bar');
        const fill = el('i');
        fill.style.width = `${Math.max(2, traffic.percent)}%`;
        fill.style.background = color;
        bar.append(fill);

        const pct = el('span', 'tm-av-pct', traffic.percentText);
        pct.style.color = color;

        container.append(bar, pct, el('span', 'tm-av-muted', `${traffic.usedText} / ${traffic.totalText}`));
    }

    function renderBilling(container, billing) {
        if (!billing) {
            container.append(el('span', 'tm-av-muted', 'не найден'));
            return;
        }

        const price = [billing.amountText, billing.cycleText].filter(Boolean).join(' / ');
        if (price) container.append(el('span', null, price));
        if (billing.dueText) container.append(el('span', 'tm-av-muted', `до ${billing.dueText}`));

        const days = daysUntil(billing.dueIso);
        if (days !== null) {
            let text;
            if (days < 0) text = 'просрочено';
            else if (days === 0) text = 'сегодня';
            else text = `${days} дн.`;

            const pill = el('span', 'tm-av-pill', text);
            if (days <= 3) pill.classList.add('tm-av-bad');
            else if (days <= 10) pill.classList.add('tm-av-warn');
            container.append(pill);
        }
    }

    function createInfoBox({ href, hostname }) {
        const box = el('div', 'tm-av');
        let currentIps = [];
        let loading = false;

        const refreshBtn = el('button', 'tm-av-refresh', '↻');
        refreshBtn.type = 'button';

        function render(state) {
            box.replaceChildren();

            const ipRow = makeRow('IP');
            const trafficRow = makeRow('Трафик');
            const billingRow = makeRow('Оплата');

            if (state.status === 'loading') {
                [ipRow, trafficRow, billingRow].forEach((r) => r.value.append(el('span', 'tm-av-muted', 'загрузка…')));
            } else if (state.status === 'error') {
                ipRow.value.append(el('span', 'tm-av-muted', 'ошибка: ' + state.message));
                trafficRow.value.append(el('span', 'tm-av-muted', '—'));
                billingRow.value.append(el('span', 'tm-av-muted', '—'));
            } else {
                renderIps(ipRow.value, state.data.ips);
                renderTraffic(trafficRow.value, state.data.traffic);
                renderBilling(billingRow.value, state.data.billing);
            }

            currentIps = state.status === 'ok' ? (state.data.ips || []) : [];
            box.title = currentIps.length
                ? (currentIps.length > 1 ? 'Клик — скопировать все IP' : 'Клик — скопировать IP')
                : '';

            refreshBtn.classList.toggle('tm-av-spin', state.status === 'loading');
            refreshBtn.title = state.status === 'ok' && state.data.fetchedAt
                ? `Обновить (данные ${formatAge(state.data.fetchedAt)})`
                : 'Обновить';

            box.append(ipRow.row, trafficRow.row, billingRow.row, refreshBtn);
        }

        async function load(force) {
            if (loading) return;
            loading = true;
            render({ status: 'loading' });
            try {
                const data = await fetchServiceData(href, hostname, force);
                render({ status: 'ok', data });
            } catch (err) {
                console.error('Failed to fetch service data for', href, err);
                render({ status: 'error', message: err && err.message ? err.message : 'неизвестно' });
            } finally {
                loading = false;
            }
        }

        refreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            load(true);
        });

        // Клик по блоку не должен открывать карточку услуги — вместо этого копируем IP
        box.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentIps.length) return;
            if (window.getSelection && String(window.getSelection()).trim()) return; // пользователь выделяет текст
            copyWithFeedback(currentIps.join('\n'), box, 'tm-av-flash');
        });
        ['auxclick', 'dblclick'].forEach((type) => {
            box.addEventListener(type, (e) => e.stopPropagation());
        });

        box.load = load;
        return box;
    }

    function findHostnameElement(block) {
        const textBlocks = [...block.querySelectorAll('div.flex.justify-between.sm\\:block')];

        for (const node of textBlocks) {
            const txt = cleanupText(node.textContent);
            if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(txt)) {
                return { element: node, hostname: txt };
            }
        }

        return { element: null, hostname: null };
    }

    function processServiceBlock(block) {
        if (processed.has(block)) return;
        processed.add(block);

        const href = block.getAttribute('data-href');
        if (!href) return;

        const { element: hostEl, hostname } = findHostnameElement(block);
        if (!hostEl || !hostname) return;
        if (hostEl.querySelector('.tm-av')) return;

        hostEl.style.flexWrap = 'wrap';
        const box = createInfoBox({ href, hostname });
        hostEl.appendChild(box);
        box.load(false);
    }

    function scan() {
        document.querySelectorAll('.div-service-item[data-href]').forEach(processServiceBlock);
    }

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('Обновить все услуги', () => {
            clearAllCache();
            document.querySelectorAll('.tm-av').forEach((box) => box.load && box.load(true));
        });
        GM_registerMenuCommand('Очистить кэш', () => {
            clearAllCache();
            showToast('Кэш очищен');
        });
    }

    // ---------------------------------------------------------------- init

    injectStyles();
    cleanupExpiredCache();
    registerMenu();

    let scanScheduled = false;
    const observer = new MutationObserver(() => {
        if (scanScheduled) return;
        scanScheduled = true;
        requestAnimationFrame(() => {
            scanScheduled = false;
            scan();
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    scan();
})();
