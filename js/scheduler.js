// 遗忘曲线排程：标准艾宾浩斯节点 1/2/4/7/15/30 天
export const REVIEW_DAYS = [1, 2, 4, 7, 15, 30];

// 本地日期 -> YYYY-MM-DD
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function todayStr() {
  return toDateStr(new Date());
}

// 根据学习日期生成 6 个复习任务
export function buildReviewStates(createdAt) {
  return REVIEW_DAYS.map((day) => ({
    day,
    dueDate: addDays(createdAt, day),
    done: false,
  }));
}

// 当前未完成（待复习）的节点
export function currentStage(item) {
  return item.reviewStates.find((s) => !s.done);
}

// 某条目今天是否需要复习
export function isDue(item, today) {
  if (item.status === 'done') return false;
  const stage = currentStage(item);
  if (!stage) return false;
  return stage.dueDate <= today;
}

// 所有待复习条目
export function getDueItems(items, today) {
  return items.filter((i) => isDue(i, today));
}

// 标记当前节点完成；actualDate 为实际打勾日（默认今天）。
// 关键：从 actualDate（实际复习日）重新按遗忘曲线排后续节点，
// 因此"逾期后才复习"时，后续间隔从真实复习日算起，而非原定学习日。
export function markStageDone(item, actualDate = todayStr()) {
  const idx = item.reviewStates.findIndex((s) => !s.done);
  if (idx < 0) {
    item.status = 'done';
    return item;
  }
  item.reviewStates[idx].done = true; // 当前节点完成，dueDate 保持原到期日
  // 之后节点以"实际打勾日"为基准重排
  for (let j = idx + 1; j < item.reviewStates.length; j++) {
    item.reviewStates[j].dueDate = addDays(actualDate, item.reviewStates[j].day);
  }
  if (!item.reviewStates.some((s) => !s.done)) item.status = 'done';
  return item;
}

// 当前待复习节点已逾期天数（0 表示今天刚到期或尚未到期）
export function overdueDays(item, today) {
  const stage = currentStage(item);
  if (!stage) return 0;
  if (stage.dueDate >= today) return 0;
  const d1 = parseDateStr(stage.dueDate);
  const d2 = parseDateStr(today);
  return Math.round((d2 - d1) / 86400000);
}

// 进度
export function progress(item) {
  const total = item.reviewStates.length;
  const done = item.reviewStates.filter((s) => s.done).length;
  return { done, total };
}
