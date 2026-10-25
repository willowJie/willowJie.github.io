// 通知与后台唤醒：安卓常驻/强力提醒策略
// 核心：未复习的到期项 -> 通知 requireInteraction（不自动收起）+ 固定 tag + 周期重弹 = 一直提示；
//       打勾后重新评估，无未复习项则关闭通知。
import { getAll } from './store.js';
import { todayStr, getDueItems, overdueDays } from './scheduler.js';

const REMINDER_TAG = 'review-reminder';

// 强力通知参数：安卓 Chrome 上 requireInteraction 使通知不自动收起，需用户处理；
// vibrate 增强存在感；固定 tag 保证同一提醒被替换而非堆叠。
const N_OPTS = {
  requireInteraction: true,
  vibrate: [200, 100, 200, 100, 200],
  tag: REMINDER_TAG,
  renotify: true,
};

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (reg && 'periodicSync' in reg) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await reg.periodicSync.register('review-check', { minInterval: 15 * 60 * 1000 });
        }
      } catch (_) {
        /* 不支持或不授权则静默降级 */
      }
    }
    return reg;
  } catch (_) {
    return null;
  }
}

export function notificationsSupported() {
  return 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
}

async function swRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch (_) {
    return null;
  }
}

// 通过 Service Worker 弹通知（后台更可靠）；退回普通 Notification
export async function showNotification(title, body = '') {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  const reg = await swRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, { ...N_OPTS, body });
      return true;
    } catch (_) {
      /* fallthrough */
    }
  }
  try {
    new Notification(title, { ...N_OPTS, body });
    return true;
  } catch (_) {
    return false;
  }
}

// 关闭所有复习提醒通知
export async function closeReminders() {
  const reg = await swRegistration();
  if (!reg) return;
  try {
    const ns = await reg.getNotifications({ tag: REMINDER_TAG });
    ns.forEach((n) => n.close());
  } catch (_) {
    /* 忽略 */
  }
}

// 主逻辑：有未复习到期项 -> 确保通知存在（被划掉也重弹）；无 -> 关闭
export async function ensureReminder() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const items = await getAll();
  const today = todayStr();
  const due = getDueItems(items, today);
  if (due.length === 0) {
    await closeReminders();
    return;
  }
  const overdue = due.filter((i) => overdueDays(i, today) > 0).length;
  const title = `🧠 还有 ${due.length} 条没复习`;
  let body =
    due
      .slice(0, 3)
      .map((i) => i.title || '未命名')
      .join('、') + (due.length > 3 ? ' 等' : '');
  if (overdue > 0) body = `⚠️ ${overdue} 条已逾期！` + body;
  await showNotification(title, body);
}

// 兼容旧调用（open 即检查）
export async function checkAndNotify() {
  return ensureReminder();
}
