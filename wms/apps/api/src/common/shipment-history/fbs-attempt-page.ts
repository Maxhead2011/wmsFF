type DatedAttempt = { id: string; completedAt: Date | null; updatedAt: Date };

// FIX: fetch only a history-sized overlap, not every preceding live page.
export function fbsAttemptPageWindow(page: number, pageSize: number, historyCount: number) {
  const target = (page - 1) * pageSize;
  const skip = Math.max(0, target - historyCount);
  return { skip, take: pageSize + historyCount, offset: target - skip };
}

export function mergeFbsAttemptPage<T extends DatedAttempt>(current: T[], history: T[], offset: number, size: number) {
  return [...current, ...history].sort((a, b) =>
    (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) ||
    b.updatedAt.getTime() - a.updatedAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  ).slice(offset, offset + size);
}
