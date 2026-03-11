import { useState, useEffect, useCallback, useRef } from "react";

const CLIENT_ID = "346630044108-7alqhklonsgivjnvfmn5mho6mtc3csrv.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar";

const FAMILY = [
  { id: "agata.goc.grzywnowicz@gmail.com",   name: "Mama",   color: "#F4820A" },
  { id: "marcin.grzywnowicz1978@gmail.com",  name: "Tata",   color: "#2E7D4F" },
  { id: "tomek.grzywnowicz@gmail.com",       name: "Tomek",  color: "#7B4FBF" },
  { id: "maciek.grzywnowicz@gmail.com",      name: "Maciek", color: "#F4A7C3", textDark: true },
];

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const SLOT_HEIGHT = 64;
const START_HOUR = 6;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateInRange(date, from, to) {
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}
function getDayOfWeek(date) {
  return ["Nd","Pn","Wt","Śr","Cz","Pt","Sb"][date.getDay()];
}
function getMonthName(month) {
  return ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"][month];
}
function getWeekDays(date) {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number); return h * 60 + m;
}
function minutesToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`;
}
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDate(s) {
  const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d);
}
function eventColor(ev) {
  if (ev.type === "trip") return "#4A90D9";
  if (ev.type === "birthday") return "#E8475F";
  return ev.color || "#888";
}
function isTextDark(ev) {
  return ev.color === "#F4A7C3" && ev.type === "event";
}
function eventsForDay(events, day, activePersons) {
  return events.filter(ev => {
    const personMatch = !ev.personEmail || activePersons.includes(ev.personEmail);
    if (!personMatch) return false;
    if (ev.type === "trip") return dateInRange(day, ev.dateFrom, ev.dateTo);
    return sameDay(ev.date, day);
  });
}

// ---- GOOGLE API ----
function loadGoogleScript() {
  return new Promise((resolve) => {
    if (document.getElementById("google-gsi")) { resolve(); return; }
    const s = document.createElement("script");
    s.id = "google-gsi"; s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve; document.body.appendChild(s);
  });
}
async function fetchCalendarEvents(token, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250, fields: "items(id,summary,start,end,recurringEventId)" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  return (await res.json()).items || [];
}
function buildRRule(recurrence) {
  if (!recurrence || recurrence.freq === "none") return null;
  const { freq, interval, days, endType, endCount, endDate } = recurrence;
  let rule = `RRULE:FREQ=${freq.toUpperCase()}`;
  if (interval > 1) rule += `;INTERVAL=${interval}`;
  if (freq === "weekly" && days && days.length > 0) {
    const dayMap = { pn: "MO", wt: "TU", sr: "WE", cz: "TH", pt: "FR", sb: "SA", nd: "SU" };
    rule += `;BYDAY=${days.map(d => dayMap[d]).join(",")}`;
  }
  if (endType === "count") rule += `;COUNT=${endCount}`;
  if (endType === "date" && endDate) rule += `;UNTIL=${endDate.replace(/-/g,"")}T000000Z`;
  return rule;
}

async function createCalendarEvent(token, calendarId, eventData) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateStr = formatDate(eventData.date);
  const body = {
    summary: eventData.title,
    start: eventData.allDay
      ? { date: dateStr }
      : { dateTime: `${dateStr}T${eventData.start}:00`, timeZone: tz },
    end: eventData.allDay
      ? { date: dateStr }
      : { dateTime: `${dateStr}T${eventData.end}:00`, timeZone: tz },
  };
  if (eventData.type === "birthday") body.recurrence = ["RRULE:FREQ=YEARLY"];
  if (eventData.type === "trip") {
    const nd = new Date(eventData.dateTo); nd.setDate(nd.getDate() + 1);
    body.start = { date: formatDate(eventData.dateFrom) };
    body.end = { date: formatDate(nd) };
  }
  if (eventData.type === "event" && eventData.recurrence) {
    const rule = buildRRule(eventData.recurrence);
    if (rule) body.recurrence = [rule];
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.json(); console.error("Google API error:", err); }
  return res.ok;
}
async function updateCalendarEvent(token, calendarId, eventId, eventData, scope) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateStr = formatDate(eventData.date);
  const body = {
    summary: eventData.title,
    start: eventData.allDay ? { date: dateStr } : { dateTime: `${dateStr}T${eventData.start}:00`, timeZone: tz },
    end: eventData.allDay ? { date: dateStr } : { dateTime: `${dateStr}T${eventData.end}:00`, timeZone: tz },
  };
  // scope "all" = edit master recurring event
  const id = (scope === "all" && eventData.recurringEventId) ? eventData.recurringEventId : eventId;
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.ok;
}
async function deleteCalendarEvent(token, calendarId, eventId, recurringEventId, scope) {
  const id = (scope === "all" && recurringEventId) ? recurringEventId : eventId;
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  return res.ok || res.status === 204;
}
function parseGoogleEvents(items, personEmail, personColor) {
  return items.map(item => {
    const isAllDay = !!item.start.date;
    const date = isAllDay ? new Date(item.start.date + "T00:00:00") : new Date(item.start.dateTime);
    const endDate = isAllDay ? new Date(item.end.date + "T00:00:00") : new Date(item.end?.dateTime || item.start.dateTime);
    const isMultiDay = !sameDay(date, endDate) && isAllDay;
    return {
      id: item.id,
      recurringEventId: item.recurringEventId || null,
      type: isMultiDay ? "trip" : "event",
      title: item.summary || "(bez tytułu)", personEmail, color: personColor,
      date, dateFrom: date,
      dateTo: isMultiDay ? new Date(endDate.getTime() - 86400000) : date,
      start: isAllDay ? null : `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`,
      end: isAllDay ? null : `${String(endDate.getHours()).padStart(2,"0")}:${String(endDate.getMinutes()).padStart(2,"0")}`,
      allDay: isAllDay,
    };
  });
}

// ---- EDIT MODAL ----
function EditModal({ ev, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(ev.title);
  const [date, setDate] = useState(formatDate(ev.date));
  const [start, setStart] = useState(ev.start || "09:00");
  const [end, setEnd] = useState(ev.end || "10:00");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState("edit"); // "edit" | "delete_scope" | "save_scope"
  const isRecurring = !!ev.recurringEventId;

  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: "#1a1a2e", backgroundColor: "#fafafa", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 };
  const person = FAMILY.find(f => f.id === ev.personEmail);
  const color = eventColor(ev);

  async function doSave(scope) {
    setSaving(true);
    await onSave({ ...ev, title, date: parseDate(date), start: ev.allDay ? null : start, end: ev.allDay ? null : end }, scope);
    setSaving(false);
  }

  async function doDelete(scope) {
    await onDelete(ev, scope);
  }

  const ScopeButtons = ({ onSingle, onAll, actionLabel }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <p style={{ fontSize: 14, color: "#444", margin: "0 0 4px", fontWeight: 600 }}>To jest wydarzenie cykliczne. Co chcesz {actionLabel}?</p>
      <button onClick={onSingle} style={{ padding: "13px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, color: "#1a1a2e", textAlign: "left" }}>
        📌 Tylko to jedno wydarzenie
      </button>
      <button onClick={onAll} style={{ padding: "13px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, color: "#1a1a2e", textAlign: "left" }}>
        🔁 Wszystkie wydarzenia w cyklu
      </button>
      <button onClick={() => setStep("edit")} style={{ padding: "13px", borderRadius: 12, border: "none", backgroundColor: "#f0f0f0", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, color: "#666" }}>
        Anuluj
      </button>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ backgroundColor: "white", borderRadius: "20px 20px 0 0", padding: 24, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#888" }}>{person?.name}</span>
          {isRecurring && <span style={{ fontSize: 11, backgroundColor: "#f0f0f0", borderRadius: 6, padding: "2px 8px", color: "#888", fontWeight: 600 }}>🔁 Cykliczne</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: "#f0f0f0", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>×</button>
        </div>

        {step === "delete_scope" && (
          <ScopeButtons
            actionLabel="usunąć"
            onSingle={() => doDelete("single")}
            onAll={() => doDelete("all")}
          />
        )}

        {step === "save_scope" && (
          <ScopeButtons
            actionLabel="zmodyfikować"
            onSingle={() => doSave("single")}
            onAll={() => doSave("all")}
          />
        )}

        {step === "edit" && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Tytuł</label>
              <input style={inp} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Data</label>
              <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {!ev.allDay && (
              <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Początek</label>
                  <input type="time" style={inp} value={start} onChange={e => {
                    const newStart = e.target.value;
                    setStart(newStart);
                    const newEndMin = timeToMinutes(newStart) + 60;
                    if (newEndMin <= 23 * 60) setEnd(minutesToTime(newEndMin));
                  }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Koniec</label>
                  <input type="time" style={inp} value={end} min={minutesToTime(timeToMinutes(start) + 15)} onChange={e => setEnd(e.target.value)} />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setStep("delete_scope")} style={{ padding: "12px 16px", borderRadius: 12, border: "none", backgroundColor: "#fff0f0", color: "#cc3333", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }}>🗑 Usuń</button>
              <button onClick={() => isRecurring ? setStep("save_scope") : doSave("single")} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", backgroundColor: "#1a1a2e", color: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Zapisuję..." : "Zapisz zmiany"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- EVENT CHIP ----
function EventChip({ ev, small, onEdit }) {
  const color = eventColor(ev);
  const dark = isTextDark(ev);
  return (
    <div onClick={() => onEdit && onEdit(ev)} style={{ backgroundColor: color, borderRadius: small ? 6 : 8, padding: small ? "4px 7px" : "6px 10px", cursor: "pointer", boxShadow: `0 1px 4px ${color}44`, marginBottom: small ? 0 : 4, WebkitTapHighlightColor: "transparent" }}>
      <div style={{ color: dark ? "#7a2a4a" : "white", fontSize: small ? 11 : 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</div>
      {!small && ev.start && <div style={{ color: dark ? "rgba(120,40,70,0.7)" : "rgba(255,255,255,0.75)", fontSize: 11 }}>{ev.start}{ev.end ? `–${ev.end}` : ""}</div>}
    </div>
  );
}

// ---- DAY VIEW with drag ----
function DayView({ date, events, activePersons, onEdit, token, loadEvents }) {
  const dayEvs = eventsForDay(events, date, activePersons);
  const timedEvs = dayEvs.filter(e => e.start);
  const allDayEvs = dayEvs.filter(e => !e.start);
  const gridRef = useRef(null);
  const dragRef = useRef(null);

  function handleDragStart(e, ev) {
    dragRef.current = { ev, startY: e.clientY, origStart: timeToMinutes(ev.start), origEnd: timeToMinutes(ev.end || ev.start) };
    e.dataTransfer.effectAllowed = "move";
  }

  async function handleDrop(e) {
    e.preventDefault();
    if (!dragRef.current || !gridRef.current) return;
    const { ev, origStart, origEnd } = dragRef.current;
    const rect = gridRef.current.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const newStartMin = Math.round((relY / SLOT_HEIGHT) * 60 / 15) * 15 + START_HOUR * 60;
    const duration = origEnd - origStart;
    const newEndMin = newStartMin + duration;
    if (newStartMin < START_HOUR * 60 || newEndMin > 22 * 60) return;
    const person = FAMILY.find(f => f.id === ev.personEmail);
    if (!person || !token) return;
    await updateCalendarEvent(token, person.id, ev.id, {
      ...ev, start: minutesToTime(newStartMin), end: minutesToTime(newEndMin),
    });
    await loadEvents(token);
    dragRef.current = null;
  }

  // Touch drag
  const touchDragRef = useRef(null);
  function handleTouchStart(e, ev) {
    touchDragRef.current = { ev, startY: e.touches[0].clientY, origStart: timeToMinutes(ev.start), origEnd: timeToMinutes(ev.end || ev.start) };
  }
  async function handleTouchEnd(e) {
    if (!touchDragRef.current || !gridRef.current) return;
    const { ev, startY, origStart, origEnd } = touchDragRef.current;
    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - startY;
    if (Math.abs(deltaY) < 10) { onEdit(ev); touchDragRef.current = null; return; }
    const deltaMin = Math.round((deltaY / SLOT_HEIGHT) * 60 / 15) * 15;
    const newStartMin = origStart + deltaMin;
    const newEndMin = origEnd + deltaMin;
    if (newStartMin < START_HOUR * 60 || newEndMin > 22 * 60) { touchDragRef.current = null; return; }
    const person = FAMILY.find(f => f.id === ev.personEmail);
    if (!person || !token) return;
    await updateCalendarEvent(token, person.id, ev.id, { ...ev, start: minutesToTime(newStartMin), end: minutesToTime(newEndMin) });
    await loadEvents(token);
    touchDragRef.current = null;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 44, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{date.getDate()}</span>
        <span style={{ fontSize: 17, color: "#666", fontWeight: 500 }}>{getDayOfWeek(date)}, {getMonthName(date.getMonth())} {date.getFullYear()}</span>
      </div>
      {allDayEvs.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{allDayEvs.map(ev => <EventChip key={ev.id} ev={ev} onEdit={onEdit} />)}</div>}
      {dayEvs.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#bbb", fontSize: 15 }}>Brak wydarzeń 🎉</div>}

      <div style={{ position: "relative" }} ref={gridRef} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
        {HOURS.map(hour => (
          <div key={hour} style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ width: 44, minWidth: 44, color: "#bbb", fontSize: 11, fontWeight: 600, paddingTop: 4, textAlign: "right", paddingRight: 10, height: SLOT_HEIGHT }}>{hour}:00</div>
            <div style={{ flex: 1, borderTop: "1px solid #f0f0f0", height: SLOT_HEIGHT }} />
          </div>
        ))}
        {(() => {
          // Oblicz kolumny dla nakładających się wydarzeń
          const cols = [];
          timedEvs.forEach(ev => {
            const s = timeToMinutes(ev.start);
            const e = timeToMinutes(ev.end || ev.start) + (ev.end ? 0 : 60);
            let placed = false;
            for (let ci = 0; ci < cols.length; ci++) {
              const last = cols[ci][cols[ci].length - 1];
              const ls = timeToMinutes(last.start);
              const le = timeToMinutes(last.end || last.start) + (last.end ? 0 : 60);
              if (s >= le) { cols[ci].push(ev); placed = true; break; }
            }
            if (!placed) cols.push([ev]);
          });
          const totalCols = cols.length;
          return cols.flatMap((col, ci) => col.map(ev => {
            const color = eventColor(ev);
            const dark = isTextDark(ev);
            const startMin = timeToMinutes(ev.start) - START_HOUR * 60;
            const endMin = timeToMinutes(ev.end || ev.start) - START_HOUR * 60 + (ev.end ? 0 : 60);
            const top = (startMin / 60) * SLOT_HEIGHT;
            const height = Math.max(((endMin - startMin) / 60) * SLOT_HEIGHT, 36);
            const person = FAMILY.find(f => f.id === ev.personEmail);
            const colWidth = `calc((100% - 52px) / ${totalCols})`;
            const colLeft = `calc(52px + ${ci} * (100% - 52px) / ${totalCols})`;
            return (
              <div key={ev.id}
                draggable
                onDragStart={e => handleDragStart(e, ev)}
                onTouchStart={e => handleTouchStart(e, ev)}
                onTouchEnd={handleTouchEnd}
                onClick={() => onEdit(ev)}
                style={{ position: "absolute", top, left: colLeft, width: colWidth, height, backgroundColor: color, borderRadius: 10, padding: "5px 8px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: `0 2px 8px ${color}55`, cursor: "grab", touchAction: "none", WebkitTapHighlightColor: "transparent", border: "2px solid rgba(255,255,255,0.35)" }}
              >
                <div style={{ color: dark ? "#7a2a4a" : "white", fontWeight: 700, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                <div style={{ color: dark ? "rgba(120,40,70,0.7)" : "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {person?.name} · {ev.start}{ev.end ? `–${ev.end}` : ""}
                </div>
              </div>
            );
          }));
        })()}
      </div>
    </div>
  );
}

// ---- WEEK VIEW ----
function WeekView({ date, events, activePersons, onEdit }) {
  const today = new Date();
  const days = getWeekDays(date);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {days.map((day, i) => {
        const isToday = sameDay(day, today);
        const dayEvs = eventsForDay(events, day, activePersons);
        return (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ textAlign: "center", marginBottom: 6, padding: "6px 2px", borderRadius: 10, backgroundColor: isToday ? "#1a1a2e" : "transparent" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? "#fff" : "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>{getDayOfWeek(day)}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: isToday ? "#fff" : "#1a1a2e" }}>{day.getDate()}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {dayEvs.map(ev => <EventChip key={ev.id} ev={ev} small onEdit={onEdit} />)}
              {dayEvs.length === 0 && <div style={{ height: 28 }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- MONTH VIEW ----
function MonthView({ date, events, activePersons, onDayClick }) {
  const today = new Date();
  const year = date.getFullYear(), month = date.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: startOffset + daysInMonth }, (_, i) => i < startOffset ? null : new Date(year, month, i - startOffset + 1));
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {["Pn","Wt","Śr","Cz","Pt","Sb","Nd"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#bbb", textTransform: "uppercase", padding: "3px 0" }}>{d}</div>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {week.map((day, di) => {
              if (!day) return <div key={di} />;
              const isToday = sameDay(day, today);
              const dayEvs = eventsForDay(events, day, activePersons);
              return (
                <div key={di} onClick={() => onDayClick(day)} style={{ minHeight: 56, borderRadius: 8, padding: "4px 4px 3px", backgroundColor: isToday ? "#1a1a2e" : "#f9f9f9", border: isToday ? "none" : "1px solid #eee", cursor: "pointer" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? "#fff" : "#333", marginBottom: 3 }}>{day.getDate()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {dayEvs.slice(0, 3).map(ev => <div key={ev.id} style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: eventColor(ev) }} />)}
                    {dayEvs.length > 3 && <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600 }}>+{dayEvs.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- ADD EVENT ----
const EVENT_TYPES = [
  { id: "event", label: "Wydarzenie", icon: "📅", desc: "Z godziną" },
  { id: "birthday", label: "Urodziny", icon: "🎂", desc: "Co roku" },
  { id: "trip", label: "Wyjazd", icon: "✈️", desc: "Wielodniowy" },
];

const WEEKDAYS = [
  { id: "pn", label: "Pn" }, { id: "wt", label: "Wt" }, { id: "sr", label: "Śr" },
  { id: "cz", label: "Cz" }, { id: "pt", label: "Pt" }, { id: "sb", label: "Sb" }, { id: "nd", label: "Nd" },
];

function RecurrencePanel({ recurrence, onChange, inp, lbl }) {
  const { freq, interval, days, endType, endCount, endDate } = recurrence;

  function set(key, val) { onChange({ ...recurrence, [key]: val }); }
  function toggleDay(d) {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    set("days", next);
  }

  return (
    <div style={{ backgroundColor: "#f7f7f5", borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Wzorzec powtarzania</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["none","Nie"], ["daily","Codziennie"], ["weekly","Tygodniowo"], ["monthly","Miesięcznie"], ["yearly","Rocznie"]].map(([v, label]) => (
            <button key={v} onClick={() => set("freq", v)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid", borderColor: freq === v ? "#1a1a2e" : "#ddd", backgroundColor: freq === v ? "#1a1a2e" : "white", color: freq === v ? "white" : "#555", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>

      {freq !== "none" && (
        <>
          {(freq === "weekly" || freq === "monthly" || freq === "daily") && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <label style={{ ...lbl, marginBottom: 0, whiteSpace: "nowrap" }}>Co ile</label>
              <input type="number" min={1} max={99} value={interval} onChange={e => set("interval", parseInt(e.target.value) || 1)}
                style={{ ...inp, width: 70, padding: "8px 12px" }} />
              <span style={{ fontSize: 13, color: "#666" }}>
                {freq === "daily" ? "dni" : freq === "weekly" ? "tygodni" : "miesięcy"}
              </span>
            </div>
          )}

          {freq === "weekly" && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Dni tygodnia</label>
              <div style={{ display: "flex", gap: 6 }}>
                {WEEKDAYS.map(d => (
                  <button key={d.id} onClick={() => toggleDay(d.id)} style={{ width: 36, height: 36, borderRadius: 10, border: "2px solid", borderColor: days.includes(d.id) ? "#1a1a2e" : "#ddd", backgroundColor: days.includes(d.id) ? "#1a1a2e" : "white", color: days.includes(d.id) ? "white" : "#666", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{d.label}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 4 }}>
            <label style={lbl}>Koniec cyklu</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[["never","Bez końca"], ["count","Po X wystąpieniach"], ["date","Do daty"]].map(([v, label]) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="radio" checked={endType === v} onChange={() => set("endType", v)} style={{ accentColor: "#1a1a2e", width: 16, height: 16 }} />
                  <span style={{ fontSize: 14, color: "#444" }}>{label}</span>
                  {v === "count" && endType === "count" && (
                    <input type="number" min={1} max={999} value={endCount} onChange={e => set("endCount", parseInt(e.target.value) || 1)}
                      style={{ ...inp, width: 70, padding: "6px 10px" }} />
                  )}
                  {v === "date" && endType === "date" && (
                    <input type="date" value={endDate} onChange={e => set("endDate", e.target.value)}
                      style={{ ...inp, flex: 1, padding: "6px 10px" }} />
                  )}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AddEventPage({ onAdd, onCancel, currentUser }) {
  const [type, setType] = useState("event");
  const [title, setTitle] = useState("");
  const [calendarOwner, setCalendarOwner] = useState(currentUser?.email || FAMILY[0].id);
  const [date, setDate] = useState(formatDate(new Date()));
  const [dateFrom, setDateFrom] = useState(formatDate(new Date()));
  const [dateTo, setDateTo] = useState(formatDate(new Date()));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [error, setError] = useState("");
  const [recurrence, setRecurrence] = useState({ freq: "none", interval: 1, days: [], endType: "never", endCount: 10, endDate: formatDate(new Date()) });

  function handleSubmit() {
    if (!title.trim()) { setError("Wpisz tytuł wydarzenia."); return; }
    setError("");
    const person = FAMILY.find(f => f.id === calendarOwner);
    const base = { title: title.trim(), type, personEmail: calendarOwner, color: person?.color };
    if (type === "event") onAdd({ ...base, date: parseDate(date), start, end, allDay: false, recurrence });
    else if (type === "birthday") onAdd({ ...base, date: parseDate(date), allDay: true });
    else onAdd({ ...base, dateFrom: parseDate(dateFrom), dateTo: parseDate(dateTo), allDay: true });
  }

  const inp = { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: "#1a1a2e", backgroundColor: "#fafafa", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1a1a2e", marginBottom: 4, marginTop: 0 }}>Dodaj wydarzenie</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20, marginTop: 0 }}>Zapisze się w Google Calendar wybranej osoby.</p>

      <div style={{ marginBottom: 18 }}>
        <label style={lbl}>Typ</label>
        <div style={{ display: "flex", gap: 8 }}>
          {EVENT_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: "2px solid", borderColor: type === t.id ? "#1a1a2e" : "#eee", backgroundColor: type === t.id ? "#1a1a2e" : "#fafafa", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              <div style={{ fontSize: 20, marginBottom: 3 }}>{t.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: type === t.id ? "#fff" : "#444" }}>{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Tytuł</label>
        <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder={type === "birthday" ? "np. Urodziny Babci" : type === "trip" ? "np. Wakacje — Grecja" : "np. Wizyta u dentysty"} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Dla kogo</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FAMILY.map(p => (
            <button key={p.id} onClick={() => setCalendarOwner(p.id)} style={{ padding: "8px 16px", borderRadius: 20, border: "2px solid", borderColor: calendarOwner === p.id ? p.color : "#eee", backgroundColor: calendarOwner === p.id ? p.color : "#fafafa", color: calendarOwner === p.id ? (p.textDark ? "#7a2a4a" : "white") : "#aaa", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {type === "trip" ? (
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Od</label><input type="date" style={inp} value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Do</label><input type="date" style={inp} value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>{type === "birthday" ? "Data urodzin" : "Data"}</label>
          <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
        </div>
      )}

      {type === "event" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Początek</label>
              <input type="time" style={inp} value={start} onChange={e => {
                const newStart = e.target.value;
                setStart(newStart);
                const newEndMin = timeToMinutes(newStart) + 60;
                if (newEndMin <= 23 * 60) setEnd(minutesToTime(newEndMin));
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Koniec</label>
              <input type="time" style={inp} value={end} min={minutesToTime(timeToMinutes(start) + 15)} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <RecurrencePanel recurrence={recurrence} onChange={setRecurrence} inp={inp} lbl={lbl} />
        </>
      )}

      {type === "birthday" && <div style={{ backgroundColor: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}><div style={{ fontSize: 13, color: "#e65100", fontWeight: 500 }}>🔁 Będą pojawiać się co roku.</div></div>}
      {error && <div style={{ backgroundColor: "#fff0f0", border: "1px solid #ffcccc", borderRadius: 10, padding: "10px 14px", marginBottom: 14, color: "#cc0000", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, color: "#666" }}>Anuluj</button>
        <button onClick={handleSubmit} style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", backgroundColor: "#1a1a2e", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, color: "white" }}>Zapisz</button>
      </div>
    </div>
  );
}

// ---- LOGIN ----
function LoginScreen({ onLogin }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f4f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 24 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ backgroundColor: "white", borderRadius: 20, padding: "40px 32px", textAlign: "center", boxShadow: "0 4px 32px rgba(0,0,0,0.08)", maxWidth: 360, width: "100%" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏠</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a2e", margin: "0 0 8px" }}>Rodzinny Kalendarz</h1>
        <p style={{ color: "#888", fontSize: 14, margin: "0 0 28px", lineHeight: 1.5 }}>Zaloguj się swoim kontem Google żeby zobaczyć kalendarz całej rodziny.</p>
        <button onClick={onLogin} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.5 35.5 26.9 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.5 5C9.5 39.5 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.2 5.2C40.8 35.5 44 30.1 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
          Zaloguj się przez Google
        </button>
        <p style={{ color: "#ccc", fontSize: 11, marginTop: 16 }}>Tylko dla rodziny Grzywnowicz</p>
      </div>
    </div>
  );
}

// ---- MAIN APP ----
export default function App() {
  const [page, setPage] = useState("calendar");
  const [view, setView] = useState("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activePersons, setActivePersons] = useState(FAMILY.map(f => f.id));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [tokenClient, setTokenClient] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const today = new Date();

  useEffect(() => {
    loadGoogleScript().then(() => {
      if (!window.google) return;
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (resp) => { if (resp.access_token) { setToken(resp.access_token); fetchUserInfo(resp.access_token); } },
      });
      setTokenClient(tc);
    });
  }, []);

  async function fetchUserInfo(t) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t}` } });
    const d = await res.json();
    setCurrentUser({ email: d.email, name: d.name });
  }

  const loadEvents = useCallback(async (t) => {
    setLoading(true);
    const timeMin = new Date(); timeMin.setMonth(timeMin.getMonth() - 1);
    const timeMax = new Date(); timeMax.setMonth(timeMax.getMonth() + 3);
    const all = [];
    for (const person of FAMILY) {
      try {
        const items = await fetchCalendarEvents(t, person.id, timeMin, timeMax);
        all.push(...parseGoogleEvents(items, person.id, person.color));
      } catch (e) {}
    }
    setEvents(all);
    setLoading(false);
  }, []);

  useEffect(() => { if (token) loadEvents(token); }, [token, loadEvents]);

  async function handleAddEvent(eventData) {
    if (!token) return;
    const person = FAMILY.find(f => f.id === eventData.personEmail);
    if (!person) return;
    await createCalendarEvent(token, person.id, eventData);
    await loadEvents(token);
    setPage("calendar");
  }

  async function handleSaveEdit(eventData, scope) {
    if (!token) return;
    const person = FAMILY.find(f => f.id === eventData.personEmail);
    if (!person) return;
    await updateCalendarEvent(token, person.id, eventData.id, eventData, scope);
    await loadEvents(token);
    setEditingEvent(null);
  }

  async function handleDeleteEvent(ev, scope) {
    if (!token) return;
    const person = FAMILY.find(f => f.id === ev.personEmail);
    if (!person) return;
    await deleteCalendarEvent(token, person.id, ev.id, ev.recurringEventId, scope);
    await loadEvents(token);
    setEditingEvent(null);
  }

  function togglePerson(id) { setActivePersons(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]); }

  function navigate(dir) {
    const d = new Date(currentDate);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  }

  const navLabel = () => {
    if (view === "day") return `${getDayOfWeek(currentDate)}, ${currentDate.getDate()} ${getMonthName(currentDate.getMonth())}`;
    if (view === "week") { const d = getWeekDays(currentDate); return `${d[0].getDate()} – ${d[6].getDate()} ${getMonthName(currentDate.getMonth())}`; }
    return `${getMonthName(currentDate.getMonth())} ${currentDate.getFullYear()}`;
  };

  if (!token) return <LoginScreen onLogin={() => tokenClient?.requestAccessToken()} />;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f4f0", fontFamily: "'DM Sans', sans-serif", paddingBottom: 32 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />

      {/* HEADER — mobile friendly */}
      <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #ebebeb", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 20 }}>🏠</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>Rodzinny Kalendarz</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {loading && <span style={{ fontSize: 11, color: "#bbb" }}>⏳</span>}
            <button onClick={() => loadEvents(token)} style={{ width: 34, height: 34, borderRadius: 9, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>↻</button>
            <button onClick={() => setPage(page === "calendar" ? "add" : "calendar")} style={{ padding: "8px 14px", borderRadius: 10, border: "none", backgroundColor: page === "add" ? "#eee" : "#1a1a2e", color: page === "add" ? "#666" : "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>
              {page === "add" ? "← Wróć" : "+ Dodaj"}
            </button>
          </div>
        </div>
        {page === "calendar" && (
          <div style={{ padding: "0 16px 10px", display: "flex", gap: 2, backgroundColor: "white" }}>
            <div style={{ display: "flex", gap: 2, backgroundColor: "#f0f0ec", borderRadius: 10, padding: 3, flex: 1 }}>
              {[["day","Dziś"],["week","Tydzień"],["month","Miesiąc"]].map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, backgroundColor: view === v ? "#1a1a2e" : "transparent", color: view === v ? "#fff" : "#666", transition: "all 0.15s" }}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {page === "add" ? (
        <div style={{ padding: "20px 16px" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 2px 20px rgba(0,0,0,0.06)" }}>
            <AddEventPage onAdd={handleAddEvent} onCancel={() => setPage("calendar")} currentUser={currentUser} />
          </div>
        </div>
      ) : (
        <>
          {/* PERSON FILTERS */}
          <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #ebebeb", padding: "8px 16px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FAMILY.map(person => {
              const active = activePersons.includes(person.id);
              return <button key={person.id} onClick={() => togglePerson(person.id)} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, backgroundColor: active ? person.color : "#f0f0f0", color: active ? (person.textDark ? "#7a2a4a" : "white") : "#aaa", transition: "all 0.15s", WebkitTapHighlightColor: "transparent" }}>{person.name}</button>;
            })}
          </div>

          <div style={{ padding: "14px 16px 0" }}>
            {/* DATE NAV */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <button onClick={() => navigate(-1)} style={{ width: 38, height: 38, borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>‹</button>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#1a1a2e", textAlign: "center" }}>{navLabel()}</span>
              <button onClick={() => navigate(1)} style={{ width: 38, height: 38, borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>›</button>
              <button onClick={() => setCurrentDate(today)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12, color: "#444", flexShrink: 0 }}>Dziś</button>
            </div>

            <div style={{ backgroundColor: "#fff", borderRadius: 14, padding: "16px 12px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", minHeight: 360 }}>
              {view === "day" && <DayView date={currentDate} events={events} activePersons={activePersons} onEdit={setEditingEvent} token={token} loadEvents={loadEvents} />}
              {view === "week" && <WeekView date={currentDate} events={events} activePersons={activePersons} onEdit={setEditingEvent} />}
              {view === "month" && <MonthView date={currentDate} events={events} activePersons={activePersons} onDayClick={d => { setCurrentDate(d); setView("day"); }} />}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", padding: "0 2px" }}>
              {FAMILY.map(p => <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: p.color }} /><span style={{ fontSize: 11, color: "#999", fontWeight: 500 }}>{p.name}</span></div>)}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: "#E8475F" }} /><span style={{ fontSize: 11, color: "#999", fontWeight: 500 }}>Urodziny</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: "#4A90D9" }} /><span style={{ fontSize: 11, color: "#999", fontWeight: 500 }}>Wyjazd</span></div>
            </div>
          </div>
        </>
      )}

      {/* EDIT MODAL */}
      {editingEvent && (
        <EditModal
          ev={editingEvent}
          onSave={handleSaveEdit}
          onDelete={handleDeleteEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </div>
  );
}
