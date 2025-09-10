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
  space: { xl: 28, lg: 18, md: 12, sm: 8 },
  font: { h1: 28, body: 16, small: 12 },
};

const merge = (a, b) => ({ ...a, ...(b || {}) });

/* ---------- Layout shells ---------- */
export function CenterWrap({ children, style }) {
  return (
    <div
      style={merge(
        {
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: tokens.color.bg,
          color: tokens.color.text,
          padding: tokens.space.lg,
        },
        style
      )}
    >
      <div style={{ width: "100%", maxWidth: 800 }}>{children}</div>
    </div>
  );
}

export function Card({ children, style }) {
  return (
    <div
      style={merge(
        {
          background: tokens.color.card,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.lg,
          padding: tokens.space.xl,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        },
        style
      )}
    >
      {children}
    </div>
  );
}

export function H1({ children, style }) {
  return (
    <h1
      style={merge(
        { fontSize: tokens.font.h1, margin: 0, marginBottom: tokens.space.lg },
        style
      )}
    >
      {children}
    </h1>
  );
}

/* ---------- Tabs ---------- */
export function Tabs({ value, onChange, children, style }) {
  const items = React.Children.toArray(children);
  return (
    <div style={merge({}, style)}>
      <div style={{ display: "flex", gap: 8, marginBottom: tokens.space.md }}>
        {items.map((c) => {
          const v = c.props.value;
          const active = v === value;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: `1px solid ${tokens.color.borderMuted}`,
                background: active ? tokens.color.text : "transparent",
                color: active ? tokens.color.bg : tokens.color.text,
                cursor: "pointer",
              }}
            >
              {c.props.label}
            </button>
          );
        })}
      </div>
      <div>
        {items.find((c) => c.props.value === value) ||
          items[0] ||
          null}
      </div>
    </div>
  );
}

export function Tab({ children }) {
  return <div>{children}</div>;
}

/* ---------- Form bits ---------- */
export function Label({ children, style }) {
  return (
    <label style={merge({ display: "grid", gap: 6, fontSize: 14 }, style)}>
      {children}
    </label>
  );
}

export const Input = forwardRef(function Input({ style, ...props }, ref) {
  return (
    <input
      ref={ref}
      style={merge(
        {
          background: tokens.color.bg,
          color: tokens.color.text,
          border: `1px solid ${tokens.color.borderMuted}`,
          borderRadius: tokens.radius.md,
          padding: "10px 12px",
          outline: "none",
        },
        style
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ style, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      style={merge(
        {
          background: tokens.color.bg,
          color: tokens.color.text,
          border: `1px solid ${tokens.color.borderMuted}`,
          borderRadius: tokens.radius.md,
          padding: "10px 12px",
          outline: "none",
          resize: "vertical",
        },
        style
      )}
      {...props}
    />
  );
});

export function Button({ children, style, ...props }) {
  return (
    <button
      style={merge(
        {
          background: tokens.color.text,
          color: tokens.color.bg,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: "10px 14px",
          cursor: "pointer",
        },
        style
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, style, ...props }) {
  return (
    <button
      style={merge(
        {
          background: "transparent",
          color: tokens.color.text,
          border: `1px solid ${tokens.color.borderMuted}`,
          borderRadius: tokens.radius.md,
          padding: "10px 14px",
          cursor: "pointer",
        },
        style
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, style, ...props }) {
  return (
    <button
      style={merge(
        {
          background: tokens.color.danger,
          color: tokens.color.bg,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: "10px 14px",
          cursor: "pointer",
        },
        style
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ErrorText({ children, style }) {
  return <p style={merge({ color: tokens.color.danger, margin: 0 }, style)}>{children}</p>;
}

export function InfoText({ children, style }) {
  return <p style={merge({ color: tokens.color.info, margin: 0 }, style)}>{children}</p>;
}

export function Row({ children, style }) {
  return <div style={merge({ display: "flex", gap: 10, marginTop: tokens.space.lg, flexWrap: "wrap" }, style)}>{children}</div>;
}
