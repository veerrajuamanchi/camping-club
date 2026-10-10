import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";

export type Campsite = {
  campsiteId: string;
  name: string;
  locationDescription: string;
  availabilityUrl: string | null;
  directions: string | null;
  cabinCapacity: number | null;
  cabinTypes: string[];
  reservationInstructions: string | null;
  estimatedRateCents: number | null;
  availabilityStatus: string;
  availabilitySourceUrl: string | null;
  imageUrl?: string | null;
  campHostName?: string | null;
  campHostPhone?: string | null;
  campFeatures?: string[];
  cabinInformation?: string | null;
  adminNotes?: string;
  version: number;
};

type CalendarResponse = {
  campsites: Campsite[];
};

type Props = {
  api?: <T = unknown>(action: string, input?: unknown) => Promise<T>;
};

export function AdminCampsitesPage({ api = invokeTripApi }: Props = {}) {
  const [campsites, setCampsites] = useState<Campsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit / Create State
  const [editingSite, setEditingSite] = useState<Campsite | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [campHostName, setCampHostName] = useState("");
  const [campHostPhone, setCampHostPhone] = useState("");
  const [campFeatures, setCampFeatures] = useState("");
  const [cabinInfo, setCabinInfo] = useState("");
  const [directions, setDirections] = useState("");
  const [availabilityUrl, setAvailabilityUrl] = useState("");

  async function loadCampsites() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<CalendarResponse>("get_calendar");
      setCampsites(data.campsites ?? []);
    } catch {
      setError("Could not load campsites.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCampsites();
  }, []);

  function startEdit(site: Campsite) {
    setEditingSite(site);
    setIsCreating(false);
    setName(site.name);
    setAddress(site.locationDescription);
    setImageUrl(site.imageUrl ?? "");
    setCampHostName(site.campHostName ?? "");
    setCampHostPhone(site.campHostPhone ?? "");
    setCampFeatures((site.campFeatures ?? []).join(", "));
    setCabinInfo(site.cabinInformation ?? "");
    setDirections(site.directions ?? "");
    setAvailabilityUrl(site.availabilityUrl ?? "");
    setMessage(null);
  }

  function startCreate() {
    setEditingSite(null);
    setIsCreating(true);
    setName("");
    setAddress("");
    setImageUrl("");
    setCampHostName("");
    setCampHostPhone("");
    setCampFeatures("");
    setCabinInfo("");
    setDirections("");
    setAvailabilityUrl("");
    setMessage(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const featuresArray = campFeatures
        .split(/[\n,]+/)
        .map((f) => f.trim())
        .filter(Boolean);

      let cleanImageUrl = imageUrl.trim();
      if (cleanImageUrl && !/^https?:\/\//i.test(cleanImageUrl)) {
        cleanImageUrl = `https://${cleanImageUrl}`;
      }

      let cleanAvailabilityUrl = availabilityUrl.trim();
      if (cleanAvailabilityUrl && !/^https?:\/\//i.test(cleanAvailabilityUrl)) {
        cleanAvailabilityUrl = `https://${cleanAvailabilityUrl}`;
      }

      if (isCreating) {
        await api("admin_create_campsite", {
          name: name.trim(),
          locationDescription: address.trim(),
          imageUrl: cleanImageUrl || null,
          campHostName: campHostName.trim() || null,
          campHostPhone: campHostPhone.trim() || null,
          campFeatures: featuresArray,
          cabinInformation: cabinInfo.trim() || null,
          directions: directions.trim() || null,
          availabilityUrl: cleanAvailabilityUrl || null,
          reason: "Administrator added new campsite",
        });
        setMessage("Campsite created successfully!");
      } else if (editingSite) {
        await api("admin_update_campsite", {
          campsiteId: editingSite.campsiteId,
          expectedVersion: editingSite.version,
          name: name.trim(),
          locationDescription: address.trim(),
          imageUrl: cleanImageUrl || null,
          campHostName: campHostName.trim() || null,
          campHostPhone: campHostPhone.trim() || null,
          campFeatures: featuresArray,
          cabinInformation: cabinInfo.trim() || null,
          directions: directions.trim() || null,
          availabilityUrl: cleanAvailabilityUrl || null,
          cabinCapacity: editingSite.cabinCapacity,
          cabinTypes: editingSite.cabinTypes,
          reservationInstructions: editingSite.reservationInstructions,
          estimatedRateCents: editingSite.estimatedRateCents,
          availabilityStatus: editingSite.availabilityStatus,
          availabilitySourceUrl: editingSite.availabilitySourceUrl || null,
          availabilityVerifiedAt: null,
          adminNotes: editingSite.adminNotes ?? "",
          reason: "Administrator updated campsite",
        });
        setMessage("Campsite updated successfully!");
      }
      setIsCreating(false);
      setEditingSite(null);
      await loadCampsites();
    } catch (err) {
      setMessage(err instanceof TripApiError ? "Could not save campsite. Verify input values." : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <Link to="/" className="back-link">
        ← Back to Camping
      </Link>

      <div className="feed-header">
        <div>
          <h1 className="feed-title">Campsite Directory</h1>
          <p style={{ margin: "0.2rem 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Manage club campsites, host details, and cabin specs.
          </p>
        </div>
        <button type="button" onClick={startCreate}>
          + Add Campsite
        </button>
      </div>

      {loading && <p role="status">Loading campsites…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {message && <p role="status" style={{ color: "#15803d", fontWeight: 600 }}>{message}</p>}

      {/* Edit / Create Form Modal */}
      {(isCreating || editingSite) && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2>{isCreating ? "Add New Campsite" : `Edit ${editingSite?.name}`}</h2>
            <form onSubmit={(e) => void handleSave(e)}>
              <label>
                Campsite Name *
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Del Monte" />
              </label>

              <label>
                Campsite Address *
                <textarea
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, City, State ZIP"
                  rows={2}
                />
              </label>

              <label>
                Image URL
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                />
              </label>

              <div className="form-grid">
                <label>
                  Camp Host Name
                  <input
                    value={campHostName}
                    onChange={(e) => setCampHostName(e.target.value)}
                    placeholder="e.g. John Doe"
                  />
                </label>
                <label>
                  Camp Host Phone
                  <input
                    type="tel"
                    value={campHostPhone}
                    onChange={(e) => setCampHostPhone(e.target.value)}
                    placeholder="e.g. (555) 123-4567"
                  />
                </label>
              </div>

              <label>
                Camp Features (comma-separated)
                <textarea
                  value={campFeatures}
                  onChange={(e) => setCampFeatures(e.target.value)}
                  placeholder="Fire pits, Showers, River access, Electric hookup"
                  rows={3}
                />
              </label>

              <label>
                Cabin Information
                <textarea
                  value={cabinInfo}
                  onChange={(e) => setCabinInfo(e.target.value)}
                  placeholder="e.g. Eight units sleep 6 people each. Full kitchen, heating..."
                  rows={6}
                />
              </label>

              <label>
                Reservation / Website URL
                <input
                  type="url"
                  value={availabilityUrl}
                  onChange={(e) => setAvailabilityUrl(e.target.value)}
                  placeholder="https://parks.ca.gov/..."
                />
              </label>

              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <button type="submit" disabled={busy}>
                  {busy ? "Saving…" : isCreating ? "Create Campsite" : "Save Changes"}
                </button>
                <button
                  type="button"
                  style={{ background: "#f3f4f6", color: "#374151" }}
                  onClick={() => {
                    setIsCreating(false);
                    setEditingSite(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Campsite Cards List */}
      <div className="stack">
        {campsites.map((site) => (
          <div key={site.campsiteId} className="card" style={{ display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{site.name}</h2>
                <p style={{ margin: "0.2rem 0", color: "#4b5563" }}>
                  <strong>Campsite Address:</strong> {site.locationDescription || "None listed"}
                </p>
              </div>
              <button
                type="button"
                style={{ padding: "0.4rem 0.85rem", fontSize: "0.85rem", background: "#f3f4f6", color: "#111827" }}
                onClick={() => startEdit(site)}
              >
                ✏️ Edit
              </button>
            </div>

            {site.imageUrl && (
              <img
                src={site.imageUrl}
                alt={site.name}
                style={{ width: "100%", maxHeight: "200px", objectFit: "cover", borderRadius: "8px" }}
              />
            )}

            {(site.campHostName || site.campHostPhone) && (
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#374151" }}>
                <strong>Camp Host:</strong> {site.campHostName || "Host"} {site.campHostPhone ? `· ${site.campHostPhone}` : ""}
              </p>
            )}

            {site.campFeatures && site.campFeatures.length > 0 && (
              <div>
                <strong style={{ fontSize: "0.85rem", color: "#374151" }}>Features: </strong>
                <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.2rem" }}>
                  {site.campFeatures.map((f, i) => (
                    <span key={i} className="attendee-chip" style={{ fontSize: "0.78rem" }}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {site.cabinInformation && (
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
                <strong>Cabin Info:</strong> {site.cabinInformation}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
