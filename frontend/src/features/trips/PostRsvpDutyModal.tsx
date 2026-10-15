type Props = {
  tripTitle: string;
  quotaTarget?: number;
  dailyTarget?: number | null;
  dailySatisfied?: boolean;
  onChooseDuties: () => void;
  onClose: () => void;
};

export function PostRsvpDutyModal({
  tripTitle,
  quotaTarget = 2,
  dailyTarget,
  dailySatisfied,
  onChooseDuties,
  onClose,
}: Props) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="duty-prompt-title">
      <div className="modal-card" style={{ maxWidth: "480px", textAlign: "center", padding: "2rem 1.75rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.5rem", lineHeight: 1 }} aria-hidden="true">
          🎉
        </div>
        <h2 id="duty-prompt-title" style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0.25rem 0 0.75rem 0", color: "#111827" }}>
          You&apos;re Going to {tripTitle}! 🎉
        </h2>
        <p style={{ color: "#4b5563", fontSize: "0.98rem", lineHeight: 1.55, margin: "0 0 1.5rem 0" }}>
          {dailyTarget != null && dailySatisfied ? <>No additional task selections are needed. Your daily targets are met, or no eligible tasks remain.</> : dailyTarget != null ? <>Next step: Select camping duties totaling at least <strong>{Number(dailyTarget)}× each day</strong> while eligible slots remain. If all slots are taken, no additional selection is required.</>
            : <>Next step: Select your <strong>{quotaTarget} camping duties</strong>. Every attendee helps keep the trip smooth with {quotaTarget} shared responsibilities.</>}
        </p>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {!(dailyTarget != null && dailySatisfied) && <button
            type="button"
            className="primary-button"
            style={{ width: "100%", padding: "0.75rem 1rem", fontSize: "1rem", fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}
            onClick={onChooseDuties}
          >
            Choose My Duties Now &rarr;
          </button>}
          <button
            type="button"
            className="secondary-button"
            style={{ width: "100%", padding: "0.6rem 1rem", fontSize: "0.95rem" }}
            onClick={onClose}
          >
            {dailyTarget != null && dailySatisfied ? 'Done' : <>I&apos;ll choose later</>}
          </button>
        </div>
      </div>
    </div>
  );
}
