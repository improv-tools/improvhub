import React, { forwardRef } from "react";

/* ---------- Design tokens ---------- */
export const tokens = {
  color: {
    bg: "#0b0b0e",
    card: "#14141a",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.8)",
    border: "rgba(255,255,255,0.06)",
    borderMuted: "rgba(255,255,255,0.2)",
    accent: "#ffffff",
    info: "#a0e7ff",
    danger: "#ff6b6b",
  },
  radius: { lg: 16, md: 10, sm: 8 },
  space: { xs: 6, sm: 8, md: 10, lg: 12, xl: 16, xxl: 20 },
  shadow: "0 10px 30px rgba(0,0,0,0.35)",
};

/* ---------- Helpers ---------- */
const merge = (a, b) => (b ? { ...a, ...b } : a);

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
      width: "100%",
      maxWidth: 560,
      background: tokens.color.card,
      color: tokens.color.text,
      borderRadius: tokens.radius.lg,
      padding: tokens.space.xxl,
      boxShadow: tokens.shadow,
      border: `1px solid ${tokens.color.border}`,
    }, style)}>
      {children}
    </div>
  );
}

/* ---------- Typography ---------- */
export function H1({ children, style }) {
  return <h1 style={merge({
    fontSize: 20, margin: 0, marginBottom: tokens.space.xl, letterSpacing: 0.3
  }, style)}>{children}</h1>;
}

/* ---------- Inputs ---------- */
export const Input = forwardRef(function Input(
  { style, ...props }, ref
) {
  return (
    <input
      ref={ref}
      style={merge({
        background: "#0f0f14",
        color: tokens.color.text,
        border: `1px solid ${tokens.color.borderMuted}`,
        borderRadius: tokens.radius.md,
        padding: "10px 12px",
        outline: "none",
        width: "100%",
      }, style)}
      {...props}
    />
  );
});

export function Label({ children, style }) {
  return <label style={merge({ display: "grid", gap: tokens.space.xs, fontSize: 14 }, style)}>{children}</label>;
}

/* ---------- Buttons ---------- */
export function Button({ children, style, ...props }) {
  return (
    <button
      style={merge({
        background: tokens.color.accent,
        color: "#000",
        border: "none",
        padding: "10px 14px",
        borderRadius: tokens.radius.md,
        cursor: "pointer",
        fontWeight: 600,
      }, style)}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, style, ...props }) {
  return (
    <button
      style={merge({
        background: "transparent",
        color: tokens.color.text,
        border: `1px solid ${tokens.color.borderMuted}`,
        padding: "10px 14px",
        borderRadius: tokens.radius.md,
        cursor: "pointer",
      }, style)}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Notices ---------- */
export function ErrorText({ children, style }) {
  return <p style={merge({ color: tokens.color.danger, margin: "0 0 12px" }, style)}>{children}</p>;
}
export function InfoText({ children, style }) {
  return <p style={merge({ color: tokens.color.info, margin: "0 0 12px" }, style)}>{children}</p>;
}

/* ---------- Tabs ---------- */
export function Tabs({ children, style }) {
  return (
    <div style={merge({
      display: "flex",
      gap: tokens.space.sm,
      marginBottom: tokens.space.lg,
      background: "#0f0f14",
      padding: tokens.space.sm,
      borderRadius: tokens.radius.md,
      flexWrap: "wrap",
    }, style)}>{children}</div>
  );
}
export function Tab({ active, children, style, ...props }) {
  return (
    <button
      style={merge({
        border: `1px solid ${tokens.color.borderMuted}`,
        padding: "8px 10px",
        borderRadius: tokens.radius.sm,
        background: active ? tokens.color.accent : "transparent",
        color: active ? "#000" : tokens.color.text,
        cursor: "pointer",
      }, style)}
      {...props}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, style, ...props }) {
  return (
    <button
      style={{
        background: tokens.color.danger,
        color: "#000",
        border: "none",
        padding: "10px 14px",
        borderRadius: tokens.radius.md,
        cursor: "pointer",
        fontWeight: 700,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}


/* ---------- Small layout helpers ---------- */
export function Row({ children, style }) {
  return <div style={merge({ display: "flex", gap: 10, marginTop: tokens.space.lg, flexWrap: "wrap" }, style)}>{children}</div>;
}
