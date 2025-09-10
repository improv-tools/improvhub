// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";

const CATEGORIES = ["rehearsal", "social", "performance"];
const FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const BYDAY = ["MO","TU","WE","TH","FR","SA","SU"];

/* ------------------------------ Small widgets ------------------------------ */
function DateTimeRow({ startDate, startTime, endTime, onChange }) {
  return (
    <Row>
      <Input type="date" value={startDate} onChange={(e)=>onChange({ startDate: e.target.value })} />
      <Input type="time" value={startTime} onChange={(e)=>onChange({ startTime: e.target.value })} />
      <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
      <Input type="time" value={endTime} onChange={(e)=>onChange({ endTime: e.target.value })} />
    </Row>
  );
}

const styles = {
  select: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
  panel: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 16 },
};

/* -------------------------------- Validators ------------------------------- */
function validateRecurrence({ recurFreq, endMode, endUntilDate, endCount, recurByday, recurByMonthday, recurWeekOfMonth
