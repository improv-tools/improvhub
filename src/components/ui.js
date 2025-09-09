
import React, { forwardRef } from "react";

/* ---------- Design tokens ---------- */
export const tokens = {
  color: {
    bg: "#0b0b0e",
    card: "#14141a",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.8)",
    border: "rgba(255,255,255,0.08)",
    borderMuted: "rgba(255,255,255,0.2)",
    accent: "#ffffff",
    info: "#a0e7ff",
    danger: "#ff6b6b",
  },
  radius: { lg: 16, md: 10, sm: 8 },
  space: { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 },
};

const merge = (...os) => Object.assign({}, ...os);

/* ---------- Layout ---------- */
export function CenterWrap({ children, style }) {
  return (
    <div style={merge({
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: tokens.space.xl,
      background: tokens.color.bg,
      color: tokens.color.text,
    }, style)}>
      {children}
    </div>
  );
}

/* ---------- Card ---------- */
export function Card({ children, style }) {
  return (
    <div style={merge({
      width: "min(1200px, 96vw)",
      background: tokens.color.card,
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space.lg,
      boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
    }, style)}>
      {children}
    </div>
  );
}

/* ---------- Headings & text ---------- */
export function H1({ children, style }) {
  return <h1 style={merge({ margin: 0, fontSize: 28, letterSpacing: 0.3 }, style)}>{children}</h1>;
}

export function ErrorText({ children, style }) {
  return <div style={merge({ color: tokens.color.danger, fontSize: 14 }, style)}>{children}</div>;
}
export function InfoText({ children, style }) {
  return <div style={merge({ color: tokens.color.info, fontSize: 14 }, style)}>{children}</div>;
}

/* ---------- Form elements ---------- */
export function Label({ children, style }) {
  return <label style={merge({ display: "grid", gap: 6, fontSize: 14 }, style)}>{children}</label>;
}

export const Input = forwardRef(function Input({ style, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      style={merge({
        background: "transparent",
        border: `1px solid ${tokens.color.borderMuted}`,
        color: tokens.color.text,
        padding: "10px 12px",
        borderRadius: tokens.radius.sm,
        outline: "none",
      }, style)}
    />
  );
});

function baseBtnStyle(kind="solid") {
  const common = {
    borderRadius: tokens.radius.sm,
    padding: "9px 14px",
    fontWeight: 600,
    cursor: "pointer",
    background: "transparent",
    color: tokens.color.text,
    border: `1px solid ${tokens.color.borderMuted}`,
  };
  if (kind === "solid") {
    return merge(common, { background: "#1f1f29", borderColor: tokens.color.border });
  }
  if (kind === "danger") {
    return merge(common, { background: "transparent", borderColor: tokens.color.danger, color: tokens.color.danger });
  }
  // ghost
  return merge(common, { background: "transparent", borderColor: tokens.color.border });
}

export function Button({ children, style, ...props }) {
  return <button {...props} style={merge(baseBtnStyle("solid"), style)}>{children}</button>;
}
export function GhostButton({ children, style, ...props }) {
  return <button {...props} style={merge(baseBtnStyle("ghost"), style)}>{children}</button>;
}
export function DangerButton({ children, style, ...props }) {
  return <button {...props} style={merge(baseBtnStyle("danger"), style)}>{children}</button>;
}

/* ---------- Simple tabs ---------- */
export function Tabs({ value, onChange, tabs, style }) {
  return (
    <div style={merge({ display: "flex", gap: 8 }, style)}>
      {tabs.map(t => (
        <Tab key={t.key} active={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}
        </Tab>
      ))}
    </div>
  );
}
export function Tab({ children, active, style, ...props }) {
  return (
    <button
      {...props}
      style={merge({
        borderRadius: 999,
        padding: "6px 12px",
        border: `1px solid ${active ? tokens.color.text : tokens.color.borderMuted}`,
        background: "transparent",
        color: active ? tokens.color.text : tokens.color.textMuted,
        cursor: "pointer",
      }, style)}
    >
      {children}
    </button>
  );
}

/* ---------- Misc layout ---------- */
export function Row({ children, style }) {
  return <div style={merge({ display: "flex", gap: 10, alignItems: "center" }, style)}>{children}</div>;
}
