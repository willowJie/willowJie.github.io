// 主逻辑：状态、渲染、事件绑定、初始化与通知检查（移动端优先）
import { getAll, put, remove, clearDone, exportAll, importAll } from './store.js';
import {
  REVIEW_DAYS,
  todayStr,
  buildReviewStates,
  getDueItems,
  markStageDone,
  progress,
  overdueDays,
  toDateStr,
} from './scheduler.js';
import {
  registerSW,
  notificationsSupported,
  notificationPermission,
  requestPermission,
  showNotification,
  ensureReminder,
} from './notify.js';

const $ = (id) => document.getElementById(id);

let items = [];
let currentView = 'today';
let toastTimer = null;

// ---------- 工具 ----------
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

function loadSettings() {
  const def = { notify: false, time: '09:00' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('masettings') || '{}') };
  } catch (_) {
    return def;
  }
}

function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  localStorage.setItem('masettings', JSON.stringify(s));
  return s;
}

// ---------- 渲染 ----------
function cardHTML(it) {
  const p = progress(it);
  const stage = it.reviewStates.find((s) => !s.done);
  const today = todayStr();
  const od = overdueDays(it, today);
  const stageDots = it.reviewStates
    .map((s) => {
      let cls = 'stage-dot';
      if (s.done) cls += ' done';
      else if (stage && s.day === stage.day && s.dueDate <= today) cls += ' due';
      return `<div class="${cls}" title="第${s.day}天"></div>`;
    })
    .join('');
  let actions;
  if (it.status === 'done') {
    actions = `<button class="edit-btn" data-act="edit" data-id="${it.id}">编辑</button>
               <button class="del-btn" data-act="del" data-id="${it.id}">删除</button>`;
  } else {
    const label = stage ? `已复习（第${stage.day}天）` : '复习完成';
    actions = `<button class="review-btn" data-act="review" data-id="${it.id}">${label}</button>
               <button class="edit-btn" data-act="edit" data-id="${it.id}">编辑</button>
               <button class="del-btn" data-act="del" data-id="${it.id}">删除</button>`;
  }
  const overdueTxt = od > 0 ? ` · <span class="overdue-tag">已逾期 ${od} 天</span>` : '';
  const meta =
    `学习于 ${it.createdAt} · 进度 ${p.done}/${p.total}` + (it.status === 'done' ? ' · 已完成 ✅' : overdueTxt);
  return `<div class="item ${it.status === 'done' ? 'done-stage' : od > 0 ? 'due-stage' : ''}">
    <div class="item-title">${esc(it.title || '未命名')}</div>
    <div class="stage-bar">${stageDots}</div>
    <div class="item-meta">${meta}</div>
    <div class="item-actions">${actions}</div>
  </div>`;
}

function renderToday() {
  const today = todayStr();
  const due = getDueItems(items, today);
  $('todayCount').textContent = due.length ? `今天有 ${due.length} 条待复习` : '今天没有待复习 🎉';
  if (!due.length) {
    $('todayList').innerHTML = `<div class="empty">暂时没有需要复习的内容。<br>在上方记下今天要记的东西吧。</div>`;
    return;
  }
  $('todayList').innerHTML = due.map(cardHTML).join('');
  bindItemActions($('todayList'));
}

function renderAll() {
  const status = $('filterStatus').value;
  let list = items.slice();
  if (status === 'active') list = list.filter((i) => i.status === 'active');
  else if (status === 'done') list = list.filter((i) => i.status === 'done');
  list.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));
  if (!list.length) {
    $('allList').innerHTML = `<div class="empty">没有匹配的条目。</div>`;
    return;
  }
  $('allList').innerHTML = list.map(cardHTML).join('');
  bindItemActions($('allList'));
}

function calcStreak() {
  const days = new Set(items.map((i) => i.createdAt));
  let streak = 0;
  let d = new Date();
  while (days.has(toDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  if (streak === 0) {
    d = new Date();
    d.setDate(d.getDate() - 1);
    while (days.has(toDateStr(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }
  return streak;
}

function renderStats() {
  const today = todayStr();
  const due = getDueItems(items, today).length;
  const active = items.filter((i) => i.status === 'active').length;
  const total = items.length;
  const streak = calcStreak();
  $('statCards').innerHTML = `
    <div class="stat-card"><div class="stat-num">${due}</div><div class="stat-label">今日待复习</div></div>
    <div class="stat-card"><div class="stat-num">${active}</div><div class="stat-label">进行中</div></div>
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">累计条目</div></div>
    <div class="stat-card"><div class="stat-num">${streak}</div><div class="stat-label">连续打卡(天)</div></div>`;
}

function renderAll2() {
  renderToday();
  renderAll();
  renderStats();
}

function bindItemActions(container) {
  container.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const it = items.find((i) => i.id === btn.dataset.id);
      if (!it) return;
      const act = btn.dataset.act;
      if (act === 'review') await doReview(it);
      else if (act === 'edit') openEdit(it);
      else if (act === 'del') await doDelete(it);
    };
  });
}

// ---------- 操作 ----------
async function addItem() {
  const title = $('quickInput').value.trim();
  if (!title) {
    toast('请输入标题');
    return;
  }
  const createdAt = $('quickDate').value || todayStr();
  const item = {
    id: uid(),
    title,
    content: '',
    tags: [],
    createdAt,
    reviewDays: REVIEW_DAYS.slice(),
    reviewStates: buildReviewStates(createdAt),
    status: 'active',
    createdTs: Date.now(),
  };
  await put(item);
  items = await getAll();
  $('quickInput').value = '';
  $('quickDate').value = todayStr();
  switchView('today');
  renderAll2();
  toast('已添加，开始记忆 🧠');
  ensureReminder();
}

async function doReview(it) {
  // 以今天为实际打勾日重算后续复习节点（逾期则从真实复习日重排）
  markStageDone(it, todayStr());
  await put(it);
  items = await getAll();
  renderAll2();
  const stage = it.reviewStates.find((s) => !s.done);
  toast(it.status === 'done' ? '全部复习完成，已归档 🎉' : `已复习，下次第${stage.day}天`);
  ensureReminder();
}

async function doDelete(it) {
  if (!confirm('确定删除这条记录？')) return;
  await remove(it.id);
  items = await getAll();
  renderAll2();
  ensureReminder();
  toast('已删除');
}

function openEdit(it) {
  $('editTitle').value = it.title || '';
  $('editDate').value = it.createdAt;
  $('editModal').dataset.id = it.id;
  $('editModal').hidden = false;
}

async function saveEdit() {
  const it = items.find((i) => i.id === $('editModal').dataset.id);
  if (!it) return;
  const newDate = $('editDate').value;
  it.title = $('editTitle').value.trim() || '未命名';
  if (newDate && newDate !== it.createdAt) {
    it.createdAt = newDate;
    it.reviewStates = buildReviewStates(newDate);
    it.status = 'active';
  }
  await put(it);
  items = await getAll();
  $('editModal').hidden = true;
  renderAll2();
  ensureReminder();
  toast('已保存');
}

function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'stats') renderStats();
  if (v === 'all') renderAll();
}

// ---------- 通知 ----------
function updateNotifyStatus() {
  const el = $('notifyStatus');
  if (!notificationsSupported()) {
    el.textContent = '当前环境不支持通知';
    return;
  }
  const perm = notificationPermission();
  el.textContent =
    perm === 'granted' ? '已授权，将常驻提醒' : perm === 'denied' ? '通知被拒绝，请在浏览器设置中开启' : '尚未授权';
}

// ---------- 初始化 ----------
function bindEvents() {
  $('addBtn').onclick = addItem;
  $('tabs').querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchView(t.dataset.view)));
  $('filterStatus').onchange = renderAll;

  $('notifyToggle').onchange = async () => {
    const on = $('notifyToggle').checked;
    if (on) {
      const perm = await requestPermission();
      if (perm !== 'granted') {
        $('notifyToggle').checked = false;
        toast('未授予通知权限');
        updateNotifyStatus();
        return;
      }
    }
    saveSettings({ notify: on });
    updateNotifyStatus();
    if (on) await ensureReminder();
  };
  $('notifyTime').onchange = () => saveSettings({ time: $('notifyTime').value });
  $('authNotifyBtn').onclick = async () => {
    await requestPermission();
    updateNotifyStatus();
    await ensureReminder();
  };
  $('testNotifyBtn').onclick = () => {
    showNotification('记忆助手 · 测试通知', '通知正常工作！未复习的内容会常驻在通知栏提醒你。')
      .then((ok) => toast(ok ? '已发送测试通知' : '未授权通知，请先授权'));
  };

  $('exportBtn').onclick = async () => {
    const json = await exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memory-backup-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出备份');
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const f = $('importFile').files[0];
    if (!f) return;
    try {
      await importAll(await f.text());
      items = await getAll();
      renderAll2();
      ensureReminder();
      toast('导入成功');
    } catch (_) {
      toast('导入失败：文件格式错误');
    }
    $('importFile').value = '';
  };
  $('clearDoneBtn').onclick = async () => {
    if (!confirm('清除所有已归档（已完成）的条目？')) return;
    await clearDone();
    items = await getAll();
    renderAll2();
    ensureReminder();
    toast('已清除归档条目');
  };

  $('editSave').onclick = saveEdit;
  $('editCancel').onclick = () => ($('editModal').hidden = true);

  // 安装到主屏
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBtn').hidden = true;
  };
}

async function init() {
  const s = loadSettings();
  $('quickDate').value = todayStr();
  $('editDate').value = todayStr();
  $('notifyToggle').checked = s.notify;
  $('notifyTime').value = s.time;
  updateNotifyStatus();

  await registerSW();
  items = await getAll();
  renderAll2();
  bindEvents();

  // 打开即评估提醒；每 15 分钟重新评估（确保被划掉的通知会回来）
  await ensureReminder();
  setInterval(ensureReminder, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureReminder();
  });
}

init();
