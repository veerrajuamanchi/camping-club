import { useEffect, useState } from "react";

export type MealSlotItem = {
  id: string;
  label: string;
  date: string;
};

export type MealPreferences = {
  saturdayBeverage: "coffee" | "tea" | "none";
  sundayBeverage: "coffee" | "tea" | "none";
  defaultDiet: "vegetarian" | "non_vegetarian";
  mealChoices: Record<string, "veg" | "non_veg" | "skip">;
  allergiesNotes?: string | null;
  alcoholBeverages?: string[];
};

export type MealPreferencesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  mealSlots: MealSlotItem[];
  initialPreferences?: MealPreferences | null;
  onSave: (prefs: {
    saturdayBeverage: "coffee" | "tea" | "none";
    sundayBeverage: "coffee" | "tea" | "none";
    defaultDiet: "vegetarian" | "non_vegetarian";
    mealChoices: Record<string, "veg" | "non_veg" | "skip">;
    allergiesNotes?: string | null;
    alcoholBeverages: string[];
  }) => Promise<void>;
};

export function MealPreferencesModal({
  isOpen,
  onClose,
  mealSlots,
  initialPreferences,
  onSave,
}: MealPreferencesModalProps) {
  const [saturdayBeverage, setSaturdayBeverage] = useState<"coffee" | "tea" | "none">(
    initialPreferences?.saturdayBeverage ?? "coffee"
  );
  const [sundayBeverage, setSundayBeverage] = useState<"coffee" | "tea" | "none">(
    initialPreferences?.sundayBeverage ?? "tea"
  );
  const [alcoholBeverages, setAlcoholBeverages] = useState<string[]>(
    initialPreferences?.alcoholBeverages && initialPreferences.alcoholBeverages.length > 0
      ? initialPreferences.alcoholBeverages
      : ["none"]
  );
  const [defaultDiet, setDefaultDiet] = useState<"vegetarian" | "non_vegetarian">(
    initialPreferences?.defaultDiet ?? "vegetarian"
  );
  const [mealChoices, setMealChoices] = useState<Record<string, "veg" | "non_veg" | "skip">>(
    initialPreferences?.mealChoices ?? {}
  );
  const [allergiesNotes, setAllergiesNotes] = useState<string>(
    initialPreferences?.allergiesNotes ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSaturdayBeverage(initialPreferences?.saturdayBeverage ?? "coffee");
      setSundayBeverage(initialPreferences?.sundayBeverage ?? "tea");
      setAlcoholBeverages(
        initialPreferences?.alcoholBeverages && initialPreferences.alcoholBeverages.length > 0
          ? initialPreferences.alcoholBeverages
          : ["none"]
      );
      setDefaultDiet(initialPreferences?.defaultDiet ?? "vegetarian");
      setMealChoices(initialPreferences?.mealChoices ?? {});
      setAllergiesNotes(initialPreferences?.allergiesNotes ?? "");
      setErrorMsg(null);
    }
  }, [isOpen, initialPreferences]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  function handleSetAllVeg() {
    setDefaultDiet("vegetarian");
    const updated: Record<string, "veg" | "non_veg" | "skip"> = {};
    for (const slot of mealSlots) {
      updated[slot.id] = "veg";
    }
    setMealChoices(updated);
  }

  function handleSetAllNonVeg() {
    setDefaultDiet("non_vegetarian");
    const updated: Record<string, "veg" | "non_veg" | "skip"> = {};
    for (const slot of mealSlots) {
      updated[slot.id] = "non_veg";
    }
    setMealChoices(updated);
  }

  function handleSlotChoiceChange(slotId: string, choice: "veg" | "non_veg" | "skip") {
    setMealChoices((prev) => ({
      ...prev,
      [slotId]: choice,
    }));
  }

  function handleToggleAlcohol(item: "beer" | "wine" | "liquor" | "byob" | "none") {
    setAlcoholBeverages((prev) => {
      if (item === "none") {
        return ["none"];
      }
      const withoutNone = prev.filter((a) => a !== "none");
      if (withoutNone.includes(item)) {
        const remaining = withoutNone.filter((a) => a !== item);
        return remaining.length > 0 ? remaining : ["none"];
      } else {
        return [...withoutNone, item];
      }
    });
  }

  async function handleSaveClick() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const effectiveChoices: Record<string, "veg" | "non_veg" | "skip"> = {};
      for (const slot of mealSlots) {
        effectiveChoices[slot.id] = mealChoices[slot.id] || (defaultDiet === "non_vegetarian" ? "non_veg" : "veg");
      }
      await onSave({
        saturdayBeverage,
        sundayBeverage,
        defaultDiet,
        mealChoices: effectiveChoices,
        allergiesNotes: allergiesNotes.trim() ? allergiesNotes.trim() : null,
        alcoholBeverages: alcoholBeverages.length > 0 ? alcoholBeverages : ["none"],
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg((err as Error)?.message || "Failed to save meal preferences. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meal-prefs-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "680px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#ffffff",
          borderRadius: "14px",
          padding: 0,
          border: "2px solid #0284c7",
          boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            background: "#f0f9ff",
            padding: "14px 20px",
            borderBottom: "1px solid #bae6fd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3 id="meal-prefs-modal-title" style={{ margin: 0, color: "#0369a1", fontSize: "1.15rem", fontWeight: 700 }}>
              ☕🍽️ Edit Meal &amp; Beverage Preferences
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "#64748b" }}>
              Saved choices automatically sync with the cook and shopping rosters.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              fontSize: "1.3rem",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {errorMsg && (
            <div className="card form-error" role="alert" style={{ margin: 0, padding: "0.75rem 1rem" }}>
              {errorMsg}
            </div>
          )}

          {/* PART 1: MORNING HOT BEVERAGES */}
          <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
            <div style={{ display: "flex", justifySelf: "unset", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🌅</span> <strong>Morning Hot Beverage</strong>
              </h4>
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#e2e8f0", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
                Rule Requirement
              </span>
            </div>
            <p style={{ margin: "0 0 12px 0", fontSize: "0.825rem", color: "#64748b" }}>
              Help the breakfast team brew the right amount of coffee and tea each morning.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
              {/* Saturday Morning */}
              <div
                style={{
                  background: "#ffffff",
                  border: `1.5px solid ${saturdayBeverage ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0369a1" }}>Saturday Morning</span>
                  <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600 }}>Selected</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: saturdayBeverage === "coffee" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: saturdayBeverage === "coffee" ? 600 : 400,
                      color: saturdayBeverage === "coffee" ? "#1e40af" : "#1e293b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sat_beverage"
                      value="coffee"
                      checked={saturdayBeverage === "coffee"}
                      onChange={() => setSaturdayBeverage("coffee")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    ☕ Fresh Brewed Coffee
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: saturdayBeverage === "tea" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: saturdayBeverage === "tea" ? 600 : 400,
                      color: saturdayBeverage === "tea" ? "#1e40af" : "#1e293b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sat_beverage"
                      value="tea"
                      checked={saturdayBeverage === "tea"}
                      onChange={() => setSaturdayBeverage("tea")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    🍵 Hot Chai / Tea
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: saturdayBeverage === "none" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: saturdayBeverage === "none" ? 600 : 400,
                      color: saturdayBeverage === "none" ? "#1e40af" : "#64748b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sat_beverage"
                      value="none"
                      checked={saturdayBeverage === "none"}
                      onChange={() => setSaturdayBeverage("none")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    🚫 Neither (Water / Bring Own)
                  </label>
                </div>
              </div>

              {/* Sunday Morning */}
              <div
                style={{
                  background: "#ffffff",
                  border: `1.5px solid ${sundayBeverage ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0369a1" }}>Sunday Morning</span>
                  <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600 }}>Selected</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: sundayBeverage === "coffee" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: sundayBeverage === "coffee" ? 600 : 400,
                      color: sundayBeverage === "coffee" ? "#1e40af" : "#1e293b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sun_beverage"
                      value="coffee"
                      checked={sundayBeverage === "coffee"}
                      onChange={() => setSundayBeverage("coffee")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    ☕ Fresh Brewed Coffee
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: sundayBeverage === "tea" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: sundayBeverage === "tea" ? 600 : 400,
                      color: sundayBeverage === "tea" ? "#1e40af" : "#1e293b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sun_beverage"
                      value="tea"
                      checked={sundayBeverage === "tea"}
                      onChange={() => setSundayBeverage("tea")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    🍵 Hot Chai / Tea
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      padding: "6px 8px",
                      background: sundayBeverage === "none" ? "#eff6ff" : "transparent",
                      borderRadius: "4px",
                      fontWeight: sundayBeverage === "none" ? 600 : 400,
                      color: sundayBeverage === "none" ? "#1e40af" : "#64748b",
                    }}
                  >
                    <input
                      type="radio"
                      name="sun_beverage"
                      value="none"
                      checked={sundayBeverage === "none"}
                      onChange={() => setSundayBeverage("none")}
                      style={{ accentColor: "#0284c7" }}
                    />
                    🚫 Neither (Water / Bring Own)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* PART 1.5: SOCIAL & EVENING DRINKS (ALCOHOL) */}
          <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "0.5rem" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🍷</span> <strong>Evening &amp; Campfire Drinks (Alcohol)</strong>
              </h4>
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#e2e8f0", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
                Multi-Select
              </span>
            </div>
            <p style={{ margin: "0 0 12px 0", fontSize: "0.825rem", color: "#64748b" }}>
              Help organizers and grocery shoppers plan evening drinks around the campfire.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  background: alcoholBeverages.includes("beer") ? "#eff6ff" : "#ffffff",
                  border: `1.5px solid ${alcoholBeverages.includes("beer") ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "6px",
                  fontWeight: alcoholBeverages.includes("beer") ? 600 : 400,
                  color: alcoholBeverages.includes("beer") ? "#1e40af" : "#1e293b",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  name="alcohol_beer"
                  aria-label="Beer / Cider / Seltzers"
                  checked={alcoholBeverages.includes("beer")}
                  onChange={() => handleToggleAlcohol("beer")}
                  style={{ accentColor: "#0284c7" }}
                />
                🍺 Beer / Cider / Seltzers
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  background: alcoholBeverages.includes("wine") ? "#eff6ff" : "#ffffff",
                  border: `1.5px solid ${alcoholBeverages.includes("wine") ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "6px",
                  fontWeight: alcoholBeverages.includes("wine") ? 600 : 400,
                  color: alcoholBeverages.includes("wine") ? "#1e40af" : "#1e293b",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  name="alcohol_wine"
                  aria-label="Wine (Red / White)"
                  checked={alcoholBeverages.includes("wine")}
                  onChange={() => handleToggleAlcohol("wine")}
                  style={{ accentColor: "#0284c7" }}
                />
                🍷 Wine (Red / White)
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  background: alcoholBeverages.includes("liquor") ? "#eff6ff" : "#ffffff",
                  border: `1.5px solid ${alcoholBeverages.includes("liquor") ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "6px",
                  fontWeight: alcoholBeverages.includes("liquor") ? 600 : 400,
                  color: alcoholBeverages.includes("liquor") ? "#1e40af" : "#1e293b",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  name="alcohol_liquor"
                  aria-label="Cocktails / Spirits"
                  checked={alcoholBeverages.includes("liquor")}
                  onChange={() => handleToggleAlcohol("liquor")}
                  style={{ accentColor: "#0284c7" }}
                />
                🍹 Cocktails / Spirits
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  background: alcoholBeverages.includes("byob") ? "#eff6ff" : "#ffffff",
                  border: `1.5px solid ${alcoholBeverages.includes("byob") ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "6px",
                  fontWeight: alcoholBeverages.includes("byob") ? 600 : 400,
                  color: alcoholBeverages.includes("byob") ? "#1e40af" : "#1e293b",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  name="alcohol_byob"
                  aria-label="Bring My Own (BYOB)"
                  checked={alcoholBeverages.includes("byob")}
                  onChange={() => handleToggleAlcohol("byob")}
                  style={{ accentColor: "#0284c7" }}
                />
                🎒 Bring My Own (BYOB)
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  background: alcoholBeverages.includes("none") ? "#eff6ff" : "#ffffff",
                  border: `1.5px solid ${alcoholBeverages.includes("none") ? "#0284c7" : "#cbd5e1"}`,
                  borderRadius: "6px",
                  fontWeight: alcoholBeverages.includes("none") ? 600 : 400,
                  color: alcoholBeverages.includes("none") ? "#1e40af" : "#64748b",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  name="alcohol_none"
                  aria-label="No Alcohol (Abstaining)"
                  checked={alcoholBeverages.includes("none")}
                  onChange={() => handleToggleAlcohol("none")}
                  style={{ accentColor: "#0284c7" }}
                />
                🚫 No Alcohol (Abstaining)
              </label>
            </div>
          </div>

          {/* PART 2: DIETARY PREFERENCE & PER-MEAL CHOICES */}
          <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px", flexWrap: "wrap", gap: "0.5rem" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🍲</span> <strong>Trip Meal Plan &amp; Diet</strong>
              </h4>
              <span style={{ fontSize: "0.78rem", color: defaultDiet === "vegetarian" ? "#16a34a" : "#b45309", fontWeight: 600 }}>
                Whole Trip Default: {defaultDiet === "vegetarian" ? "Vegetarian" : "Non-Vegetarian"}
              </span>
            </div>

            <p style={{ margin: "0 0 14px 0", fontSize: "0.825rem", color: "#64748b" }}>
              Choose your default diet or customize per meal if you are skipping any meal (e.g. eating trail food or outside).
            </p>

            {/* Quick 1-Click Action Buttons */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleSetAllVeg}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8rem",
                  background: defaultDiet === "vegetarian" ? "#dcfce7" : "#ffffff",
                  border: `1px solid ${defaultDiet === "vegetarian" ? "#86efac" : "#cbd5e1"}`,
                  color: defaultDiet === "vegetarian" ? "#166534" : "#475569",
                  borderRadius: "6px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ✓ Set All: 🥗 Vegetarian
              </button>
              <button
                type="button"
                onClick={handleSetAllNonVeg}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8rem",
                  background: defaultDiet === "non_vegetarian" ? "#fef3c7" : "#ffffff",
                  border: `1px solid ${defaultDiet === "non_vegetarian" ? "#fde68a" : "#cbd5e1"}`,
                  color: defaultDiet === "non_vegetarian" ? "#92400e" : "#475569",
                  borderRadius: "6px",
                  fontWeight: defaultDiet === "non_vegetarian" ? 700 : 600,
                  cursor: "pointer",
                }}
              >
                Set All: 🍖 Non-Vegetarian
              </button>
            </div>

            {/* Per-Meal Granular Selector Table */}
            {mealSlots.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: "0.85rem", fontStyle: "italic", margin: 0 }}>
                No meal slots configured for this trip yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {mealSlots.map((slot) => {
                  const effectiveChoice = mealChoices[slot.id] || (defaultDiet === "non_vegetarian" ? "non_veg" : "veg");
                  return (
                    <div
                      key={slot.id}
                      className="meal-slot-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 12px",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "0.88rem", color: "#1e293b" }}>{slot.label}</strong>
                        {slot.date && (
                          <span style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "6px" }}>
                            ({slot.date})
                          </span>
                        )}
                      </div>

                      {/* Toggle Pills */}
                      <div
                        style={{
                          display: "inline-flex",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          overflow: "hidden",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSlotChoiceChange(slot.id, "veg")}
                          style={{
                            background: effectiveChoice === "veg" ? "#16a34a" : "#ffffff",
                            color: effectiveChoice === "veg" ? "#ffffff" : "#64748b",
                            padding: "4px 10px",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          🥗 Veg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSlotChoiceChange(slot.id, "non_veg")}
                          style={{
                            background: effectiveChoice === "non_veg" ? "#ea580c" : "#ffffff",
                            color: effectiveChoice === "non_veg" ? "#ffffff" : "#64748b",
                            padding: "4px 10px",
                            border: "none",
                            borderLeft: "1px solid #cbd5e1",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          🍖 Non-Veg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSlotChoiceChange(slot.id, "skip")}
                          style={{
                            background: effectiveChoice === "skip" ? "#475569" : "#ffffff",
                            color: effectiveChoice === "skip" ? "#ffffff" : "#64748b",
                            padding: "4px 10px",
                            border: "none",
                            borderLeft: "1px solid #cbd5e1",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          🚫 Skip
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* PART 3: OPTIONAL NOTES / ALLERGIES */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.85rem", color: "#334155", display: "block", marginBottom: "4px" }}>
              Allergies or Dietary Restrictions (Optional)
            </label>
            <input
              type="text"
              maxLength={500}
              placeholder="e.g. Peanut allergy, gluten-free, lactose intolerant..."
              value={allergiesNotes}
              onChange={(e) => setAllergiesNotes(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "0.85rem",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Action Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              borderTop: "1px solid #e2e8f0",
              paddingTop: "14px",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 16px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleSaveClick}
              disabled={busy}
              style={{
                padding: "8px 20px",
                background: "#16a34a",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Saving…" : "Save Preferences ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
