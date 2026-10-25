import { Link } from "react-router";

type ConfigCategory = {
  id: string;
  title: string;
  icon: string;
  description: string;
  linkText: string;
  href: string;
};

const CONFIG_CATEGORIES: ConfigCategory[] = [
  {
    id: "constitution",
    title: "Camping Constitution",
    icon: "📜",
    description: "Edit rules, manage immutable versions & review member acknowledgments.",
    linkText: "Manage Constitution →",
    href: "/admin/constitution",
  },
  {
    id: "campsites",
    title: "Campsite Directory",
    icon: "🏕️",
    description: "Manage 7-site rotation, cabin capacities, host phone numbers & photo URLs.",
    linkText: "Manage Campsites →",
    href: "/admin/campsites",
  },
  {
    id: "responsibilities",
    title: "Master Responsibilities",
    icon: "🛠️",
    description: "Configure duty catalogs, workload weightings, descriptions, and quotas.",
    linkText: "Manage Responsibilities →",
    href: "/admin/responsibilities",
  },
  {
    id: "catalogs",
    title: "Master Catalogs & Activities",
    icon: "📦",
    description: "Manage master gear, groceries, supplies, and trip activities.",
    linkText: "Manage Catalogs →",
    href: "/admin/catalogs",
  },
  {
    id: "schedule-defaults",
    title: "Club Schedule Defaults",
    icon: "⚙️",
    description: "Configure rotation start, lead days, poll close times, and monthly generation.",
    linkText: "Manage Schedule Defaults →",
    href: "/admin/schedule-defaults",
  },
  {
    id: "members",
    title: "Members & Access",
    icon: "👥",
    description: "Review membership access requests, manage active members, roles, and status.",
    linkText: "Manage Members →",
    href: "/admin/members",
  },
];

export function AdminConfigurationPage() {
  return (
    <div className="container" style={{ maxWidth: "800px", margin: "0 auto", padding: "1rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem", color: "#1e293b", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>⚙️</span> Club Master Configuration
        </h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.95rem" }}>
          Unified administrative center: zero feature loss, organized for quick access.
        </p>
      </div>

      <div style={{ display: "grid", gap: "1rem" }} data-testid="admin-config-grid">
        {CONFIG_CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className="card"
            style={{
              padding: "1.25rem",
              borderRadius: "10px",
              border: "1px solid #e2e8f0",
              background: "#ffffff",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ fontSize: "1.5rem" }}>{cat.icon}</span>
              <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#0f172a" }}>{cat.title}</h2>
            </div>
            <p style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.88rem", color: "#64748b", lineHeight: 1.5 }}>
              {cat.description}
            </p>
            <div>
              <Link
                to={cat.href}
                className="secondary-button hub-card-action-link"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "44px",
                  padding: "0.5rem 1rem",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  borderRadius: "6px",
                }}
              >
                {cat.linkText}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
