// Service Worker：离线缓存 + 后台周期检查并弹通知 + 常驻提醒控制
const CACHE = 'memory-assistant-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/scheduler.js',
  './js/notify.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (cached) => cached || fetch(e.request).catch(() => caches.match('./index.html'))
    )
  );
});

// 通知点击 -> 打开/聚焦页面
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

// 页面发来的控制请求
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d) return;
  if (d.type === 'close-reminders') {
    self.registration
      .getNotifications({ tag: 'review-reminder' })
      .then((ns) => ns.forEach((n) => n.close()));
  } else if (d.type === 'ensure-reminder' || d.type === 'notify') {
    e.waitUntil(doBackgroundCheck());
  }
});

// ---- 与 scheduler.js 一致的纯逻辑（SW 内联，避免模块依赖）----
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDateStr(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function overdueOf(it, today) {
  const stage = (it.reviewStates || []).find((s) => !s.done);
  if (!stage || stage.dueDate >= today) return 0;
  return Math.round((parseDateStr(today) - parseDateStr(stage.dueDate)) / 86400000);
}

function getAllItems() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('memory-assistant', 1);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('items', 'readonly');
        const os = tx.objectStore('items');
        const r = os.getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      } catch (err) {
        reject(err);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function doBackgroundCheck() {
  let items = [];
  try {
    items = await getAllItems();
  } catch (_) {
    return;
  }
  const today = toDateStr(new Date());
  const due = items.filter((it) => {
    if (it.status === 'done') return false;
    const stage = (it.reviewStates || []).find((s) => !s.done);
    return stage && stage.dueDate <= today;
  });
  if (due.length === 0) {
    // 无未复习项：清除可能残留的通知
    try {
      const ns = await self.registration.getNotifications({ tag: 'review-reminder' });
      ns.forEach((n) => n.close());
    } catch (_) {}
    return;
  }
  const overdue = due.filter((i) => overdueOf(i, today) > 0).length;
  const title = `🧠 还有 ${due.length} 条没复习`;
  let body =
    due
      .slice(0, 3)
      .map((i) => i.title || '未命名')
      .join('、') + (due.length > 3 ? ' 等' : '');
  if (overdue > 0) body = `⚠️ ${overdue} 条已逾期！` + body;
  try {
    await self.registration.showNotification(title, {
      body,
      tag: 'review-reminder',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
    });
  } catch (_) {
    /* 未授权则忽略 */
  }
}

// 后台周期性同步：检查并弹/清通知
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'review-check') {
    e.waitUntil(doBackgroundCheck());
  }
});
