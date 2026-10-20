export type StaffSlots = { staffId: number; staffName: string; slots: Date[] };
export type AnySlot = { startsAt: Date; staffIds: number[] };

// Une los huecos de varias profesionales: para cada hora de inicio,
// qué profesionales están libres. Ordenado por hora.
export function mergeSlots(perStaff: StaffSlots[]): AnySlot[] {
  const byTime = new Map<number, number[]>();

  for (const s of perStaff) {
    for (const d of s.slots) {
      const key = d.getTime();
      const ids = byTime.get(key);
      if (ids) ids.push(s.staffId);
      else byTime.set(key, [s.staffId]);
    }
  }

  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, staffIds]) => ({ startsAt: new Date(t), staffIds }));
}