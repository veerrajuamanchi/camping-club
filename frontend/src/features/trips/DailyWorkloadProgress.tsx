export type DailyWorkload = {
  target: number | null;
  tripVersion: number;
  satisfied: boolean;
  days: Array<{
    date: string;
    selectedWeight: number;
    totalWeight: number;
    remainingWeight: number;
    eligibleSlots: number;
    status: "target_met" | "needs_selection" | "no_tasks_available" | "no_tasks_scheduled";
  }>;
};

export function dailyWorkloadLabel(progress: DailyWorkload) {
  const missing = progress.days.filter(day => day.status === "needs_selection").length;
  return missing ? `Daily workload: ${missing} ${missing === 1 ? "day needs" : "days need"} selection` : "Daily workload: no additional selections needed";
}

export function DailyWorkloadProgress({ progress }: { progress: DailyWorkload }) {
  if (progress.target == null) return null;
  return <section className="card" aria-label="Daily workload progress">
    <h3>Your Daily Workload</h3>
    <p>Select tasks totaling at least {Number(progress.target)}× each day while eligible slots remain.</p>
    <ul className="stack" style={{ paddingLeft: "1.25rem" }}>
      {progress.days.map(day => <li key={day.date}>
        <strong>{day.date}</strong> · <span>{Number(day.selectedWeight)}× / {Number(progress.target)}×</span>
        <p style={{ margin: "0.25rem 0" }}>
          {day.status === "target_met" ? "Daily target reached (tasks selected)."
            : day.status === "no_tasks_available" ? "No tasks available. No additional selection required."
            : day.status === "no_tasks_scheduled" ? "No active tasks scheduled. No selection required."
            : `Select at least ${Number((Number(progress.target) - Number(day.selectedWeight)).toFixed(1))}× more while slots remain.`}
        </p>
        <small>Scheduled volunteer workload: {Number(day.totalWeight)}× · Unfilled workload: {Number(day.remainingWeight)}×</small>
      </li>)}
    </ul>
    <p>Trip-wide driver credits are shown separately and are never repeated across days.</p>
  </section>;
}
