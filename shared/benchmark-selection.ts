// null means all available web tabs, including pages opened after the panel.
export function selectedBenchmarkTabs<T extends { id: number }>(tabs: T[], selection: Set<number> | null): T[] {
  return selection === null ? tabs : tabs.filter((tab) => selection.has(tab.id));
}

export function toggleBenchmarkTab(tabs: { id: number }[], selection: Set<number> | null, id: number): Set<number> {
  const next = new Set(selectedBenchmarkTabs(tabs, selection).map((tab) => tab.id));
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
