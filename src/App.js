import { useState, useEffect, useCallback } from "react";

const CLIENT_ID = "346630044108-7alqhklonsgivjnvfmn5mho6mtc3csrv.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar";

const FAMILY = [
  { id: "agata.goc.grzywnowicz@gmail.com",   name: "Mama",   color: "#F4820A" },
  { id: "marcin.grzywnowicz1978@gmail.com",  name: "Tata",   color: "#2E7D4F" },
  { id: "tomek.grzywnowicz@gmail.com",       name: "Tomek",  color: "#7B4FBF" },
  { id: "maciek.grzywnowicz@gmail.com",      name: "Maciek", color: "#F4A7C3", textDark: true },
];

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

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
function eventsForDay(events, day, activePersons) {
  return events.filter(ev => {
    const personMatch = !ev.personEmail || activePersons.includes(ev.personEmail);
    if (!personMatch) return false;
    if (ev.type === "trip") return dateInRange(day, ev.dateFrom, ev.dateTo);
    return sameDay(ev.date, day);
  });
}

function loadGoogleScript() {
  return new Promise((resolve) => {
    if (document.getElementById("google-gsi")) { resolve(); return; }
    const script = document.createElement("script");
    script.id = "google-gsi";
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    document.body.appendChild(script);
  });
}

async function fetchCalendarEvents(token, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250 });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

async function createCalendarEvent(token, calendarId, eventData) {
  const body = {
    summary: eventData.title,
    start: eventData.allDay ? { date: formatDate(eventData.date) } : { dateTime: new Date(`${formatDate(eventData.date)}T${eventData.start}:00`).toISOString() },
    end: eventData.allDay ? { date: formatDate(eventData.date) } : { dateTime: new Date(`${formatDate(eventData.date)}T${eventData.end}:00`).toISOString() },
  };
  if (eventData.type === "birthday") body.recurrence = ["RRULE:FREQ=YEARLY"];
  if (eventData.type === "trip") {
    const nextDay = new Date(eventData.dateTo);
    nextDay.setDate(nextDay.getDate() + 1);
    body.start = { date: formatDate(eventData.dateFrom) };
    body.end = { date: formatDate(nextDay) };
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.ok;
}

function parseGoogleEvents(items, personEmail, personColor) {
  return items.map(item => {
    const isAllDay = !!item.start.date;
    const date = isAllDay ? new Date(item.start.date + "T00:00:00") : new Date(item.start.dateTime);
    const endDate = isAllDay ? new Date(item.end.date + "T00:00:00") : new Date(item.end?.dateTime || item.start.dateTime);
    const isMultiDay = !sameDay(date, endDate) && isAllDay;
    return { id: item.id, type: isMultiDay ? "trip" : "event", title: item.summary || "(bez tytułu)", personEmail, color: personColor, date, dateFrom: date, dateTo: isMultiDay ? new Date(endDate.getTime() - 86400000) : date, start: isAllDay ? null : `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`, end: isAllDay ? null : `${String(endDate.getHours()).padStart(2,"0")}:${String(endDate.getMinutes()).padStart(2,"0")}`, allDay: isAllDay };
  });
}

function EventChip({ ev, small }) {
  const color = eventColor(ev);
  const dark = ev.color === "#F4A7C3" && ev.type === "event";
  return (
    <div style={{ backgroundColor: color, borderRadius: small ? 6 : 8, padding: small ? "3px 6px" : "5px 10px", cursor: "pointer", boxShadow: `0 1px 4px ${color}44`, marginBottom: small ? 0 : 4 }}>
      <div style={{ color: dark ? "#7a2a4a" : "white", fontSize: small ? 10 : 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</div>
      {!small && ev.start && <div style={{ color: dark ? "rgba(120,40,70,0.7)" : "rgba(255,255,255,0.75)", fontSize: 10 }}>{ev.start}{ev.end ? `–${ev.end}` : ""}</div>}
    </div>
  );
}

function DayView({ date, events, activePersons }) {
  const SLOT_HEIGHT = 56, START_HOUR = 6;
  const dayEvs = eventsForDay(events, date, activePersons);
  const timedEvs = dayEvs.filter(e => e.start);
  const allDayEvs = dayEvs.filter(e => !e.start);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 48, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{date.getDate()}</span>
        <span style={{ fontSize: 20, color: "#666", fontWeight: 500 }}>{getDayOfWeek(date)}, {getMonthName(date.getMonth())} {date.getFullYear()}</span>
      </div>
      {allDayEvs.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>{allDayEvs.map(ev => <EventChip key={ev.id} ev={ev} />)}</div>}
      {dayEvs.length === 0 && <div style={{ textAlign: "center", padding: "60px 0", color: "#aaa", fontSize: 16 }}>Brak wydarzeń 🎉</div>}
      <div style={{ position: "relative" }}>
        {HOURS.map(hour => (
          <div key={hour} style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ width: 48, minWidth: 48, color: "#bbb", fontSize: 12, fontWeight: 600, paddingTop: 4, textAlign: "right", paddingRight: 12, height: SLOT_HEIGHT }}>{hour}:00</div>
            <div style={{ flex: 1, borderTop: "1px solid #f0f0f0", height: SLOT_HEIGHT }} />
          </div>
        ))}
        {timedEvs.map(ev => {
          const color = eventColor(ev);
          const dark = ev.color === "#F4A7C3" && ev.type === "event";
          const startMin = timeToMinutes(ev.start) - START_HOUR * 60;
          const endMin = timeToMinutes(ev.end || ev.start) - START_HOUR * 60 + (ev.end ? 0 : 60);
          const top = (startMin / 60) * SLOT_HEIGHT;
          const height = Math.max(((endMin - startMin) / 60) * SLOT_HEIGHT, 32);
          const person = FAMILY.find(f => f.id === ev.personEmail);
          return (
            <div key={ev.id} style={{ position: "absolute", top, left: 60, right: 0, height, backgroundColor: color, borderRadius: 10, padding: "6px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: `0 2px 8px ${color}55`, cursor: "pointer", transition: "transform 0.1s" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.01)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
            >
              <div style={{ color: dark ? "#7a2a4a" : "white", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{ev.title}</div>
              <div style={{ color: dark ? "rgba(120,40,70,0.7)" : "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 2 }}>{person?.name || ""} · {ev.start}{ev.end ? `–${ev.end}` : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ date, events, activePersons }) {
  const today = new Date();
  const days = getWeekDays(date);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {days.map((day, i) => {
        const isToday = sameDay(day, today);
        const dayEvs = eventsForDay(events, day, activePersons);
        return (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ textAlign: "center", marginBottom: 8, padding: "8px 4px", borderRadius: 10, backgroundColor: isToday ? "#1a1a2e" : "transparent" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: isToday ? "#fff" : "#999", textTransform: "uppercase", letterSpacing: 1 }}>{getDayOfWeek(day)}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: isToday ? "#fff" : "#1a1a2e" }}>{day.getDate()}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dayEvs.map(ev => <EventChip key={ev.id} ev={ev} small />)}
              {dayEvs.length === 0 && <div style={{ height: 32 }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 6 }}>
        {["Pn","Wt","Śr","Cz","Pt","Sb","Nd"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: 1, padding: "4px 0" }}>{d}</div>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {week.map((day, di) => {
              if (!day) return <div key={di} />;
              const isToday = sameDay(day, today);
              const dayEvs = eventsForDay(events, day, activePersons);
              return (
                <div key={di} onClick={() => onDayClick(day)} style={{ minHeight: 64, borderRadius: 10, padding: "6px 6px 4px", backgroundColor: isToday ? "#1a1a2e" : "#f9f9f9", border: isToday ? "none" : "1px solid #eee", cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (!isToday) e.currentTarget.style.backgroundColor = "#f0f0f0"; }}
                  onMouseLeave={e => { if (!isToday) e.currentTarget.style.backgroundColor = "#f9f9f9"; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? "#fff" : "#333", marginBottom: 4 }}>{day.getDate()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {dayEvs.slice(0, 3).map(ev => <div key={ev.id} style={{ width: "100%", height: 5, borderRadius: 3, backgroundColor: eventColor(ev) }} />)}
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

const EVENT_TYPES = [
  { id: "event", label: "Spotkanie", icon: "📅", desc: "Z godziną" },
  { id: "birthday", label: "Urodziny", icon: "🎂", desc: "Co roku" },
  { id: "trip", label: "Wyjazd", icon: "✈️", desc: "Wielodniowy" },
];

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

  function handleSubmit() {
    if (!title.trim()) { setError("Wpisz tytuł wydarzenia."); return; }
    setError("");
    const person = FAMILY.find(f => f.id === calendarOwner);
    const base = { title: title.trim(), type, personEmail: calendarOwner, color: person?.color };
    if (type === "event") onAdd({ ...base, date: parseDate(date), start, end, allDay: false });
    else if (type === "birthday") onAdd({ ...base, date: parseDate(date), allDay: true });
    else onAdd({ ...base, dateFrom: parseDate(dateFrom), dateTo: parseDate(dateTo), allDay: true });
  }

  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#1a1a2e", backgroundColor: "#fafafa", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: 12, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e", marginBottom: 4, marginTop: 0 }}>Dodaj wydarzenie</h2>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 24, marginTop: 0 }}>Wydarzenie zostanie zapisane w Google Calendar wybranej osoby.</p>
      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>Typ</label>
        <div style={{ display: "flex", gap: 8 }}>
          {EVENT_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} style={{ flex: 1, padding: "12px 6px", borderRadius: 12, border: "2px solid", borderColor: type === t.id ? "#1a1a2e" : "#eee", backgroundColor: type === t.id ? "#1a1a2e" : "#fafafa", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{t.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: type === t.id ? "#fff" : "#444" }}>{t.label}</div>
              <div style={{ fontSize: 10, color: type === t.id ? "rgba(255,255,255,0.55)" : "#bbb", marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Tytuł</label>
        <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder={type === "birthday" ? "np. Urodziny Babci" : type === "trip" ? "np. Wakacje — Grecja" : "np. Wizyta u dentysty"} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Dodaj do kalendarza</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FAMILY.map(p => (
            <button key={p.id} onClick={() => setCalendarOwner(p.id)} style={{ padding: "7px 18px", borderRadius: 20, border: "2px solid", borderColor: calendarOwner === p.id ? p.color : "#eee", backgroundColor: calendarOwner === p.id ? p.color : "#fafafa", color: calendarOwner === p.id ? (p.textDark ? "#7a2a4a" : "white") : "#aaa", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 0.15s" }}>{p.name}</button>
          ))}
        </div>
      </div>
      {type === "trip" ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Od</label><input type="date" style={inp} value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Do</label><input type="date" style={inp} value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>{type === "birthday" ? "Data urodzin" : "Data"}</label>
          <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
        </div>
      )}
      {type === "event" && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Początek</label><input type="time" style={inp} value={start} onChange={e => setStart(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Koniec</label><input type="time" style={inp} value={end} onChange={e => setEnd(e.target.value)} /></div>
        </div>
      )}
      {type === "birthday" && <div style={{ backgroundColor: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}><div style={{ fontSize: 13, color: "#e65100", fontWeight: 500 }}>🔁 Urodziny będą pojawiać się co roku automatycznie.</div></div>}
      {error && <div style={{ backgroundColor: "#fff0f0", border: "1px solid #ffcccc", borderRadius: 10, padding: "10px 14px", marginBottom: 16, color: "#cc0000", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, color: "#666" }}>Anuluj</button>
        <button onClick={handleSubmit} style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", backgroundColor: "#1a1a2e", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, color: "white", boxShadow: "0 2px 12px rgba(26,26,46,0.25)" }}>Zapisz w Google Calendar</button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f4f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ backgroundColor: "white", borderRadius: 20, padding: 48, textAlign: "center", boxShadow: "0 4px 32px rgba(0,0,0,0.08)", maxWidth: 360, width: "100%" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏠</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#1a1a2e", margin: "0 0 8px" }}>Rodzinny Kalendarz</h1>
        <p style={{ color: "#888", fontSize: 15, margin: "0 0 32px", lineHeight: 1.5 }}>Zaloguj się swoim kontem Google, żeby zobaczyć kalendarz całej rodziny.</p>
        <button onClick={onLogin} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.5 35.5 26.9 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.5 5C9.5 39.5 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.2 5.2C40.8 35.5 44 30.1 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
          Zaloguj się przez Google
        </button>
        <p style={{ color: "#ccc", fontSize: 12, marginTop: 20 }}>Tylko dla członków rodziny Grzywnowicz</p>
      </div>
    </div>
  );
}

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
  const today = new Date();

  useEffect(() => {
    loadGoogleScript().then(() => {
      if (!window.google) return;
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.access_token) { setToken(resp.access_token); fetchUserInfo(resp.access_token); }
        },
      });
      setTokenClient(tc);
    });
  }, []);

  async function fetchUserInfo(accessToken) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    setCurrentUser({ email: data.email, name: data.name });
  }

  const loadEvents = useCallback(async (accessToken) => {
    setLoading(true);
    const timeMin = new Date(); timeMin.setMonth(timeMin.getMonth() - 1);
    const timeMax = new Date(); timeMax.setMonth(timeMax.getMonth() + 3);
    const allEvents = [];
    for (const person of FAMILY) {
      try {
        const items = await fetchCalendarEvents(accessToken, person.id, timeMin, timeMax);
        const parsed = parseGoogleEvents(items, person.id, person.color);
        allEvents.push(...parsed);
      } catch (e) {}
    }
    setEvents(allEvents);
    setLoading(false);
  }, []);

  useEffect(() => { if (token) loadEvents(token); }, [token, loadEvents]);

  function handleLogin() { if (tokenClient) tokenClient.requestAccessToken(); }

  async function handleAddEvent(eventData) {
    if (!token) return;
    const person = FAMILY.find(f => f.id === eventData.personEmail);
    if (!person) return;
    const ok = await createCalendarEvent(token, person.id, eventData);
    if (ok) { await loadEvents(token); setPage("calendar"); }
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

  if (!token) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f4f0", fontFamily: "'DM Sans', sans-serif", paddingBottom: 40 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #ebebeb", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🏠</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e", letterSpacing: -0.5 }}>Rodzinny Kalendarz</span>
        </div>
        {page === "calendar" && (
          <div style={{ display: "flex", gap: 2, backgroundColor: "#f0f0ec", borderRadius: 12, padding: 3 }}>
            {[["day","Dziś"],["week","Tydzień"],["month","Miesiąc"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, backgroundColor: view === v ? "#1a1a2e" : "transparent", color: view === v ? "#fff" : "#666", transition: "all 0.15s" }}>{label}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading && <span style={{ fontSize: 12, color: "#aaa" }}>Ładowanie...</span>}
          <button onClick={() => setPage(page === "calendar" ? "add" : "calendar")} style={{ padding: "8px 18px", borderRadius: 10, border: "none", backgroundColor: page === "add" ? "#eee" : "#1a1a2e", color: page === "add" ? "#666" : "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>
            {page === "add" ? "← Wróć" : "+ Dodaj"}
          </button>
        </div>
      </div>
      {page === "add" ? (
        <div style={{ padding: "32px 24px" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 2px 20px rgba(0,0,0,0.06)", maxWidth: 560, margin: "0 auto" }}>
            <AddEventPage onAdd={handleAddEvent} onCancel={() => setPage("calendar")} currentUser={currentUser} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #ebebeb", padding: "10px 24px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FAMILY.map(person => {
              const active = activePersons.includes(person.id);
              return <button key={person.id} onClick={() => togglePerson(person.id)} style={{ padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, backgroundColor: active ? person.color : "#f0f0f0", color: active ? (person.textDark ? "#7a2a4a" : "white") : "#aaa", transition: "all 0.15s", boxShadow: active ? `0 2px 8px ${person.color}44` : "none" }}>{person.name}</button>;
            })}
          </div>
          <div style={{ padding: "20px 24px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <button onClick={() => navigate(-1)} style={{ width: 36, height: 36, borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", minWidth: 220 }}>{navLabel()}</span>
              <button onClick={() => navigate(1)} style={{ width: 36, height: 36, borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
              <button onClick={() => setCurrentDate(today)} style={{ padding: "7px 14px", borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12, color: "#444" }}>Dzisiaj</button>
              <button onClick={() => loadEvents(token)} style={{ padding: "7px 14px", borderRadius: 10, border: "1.5px solid #ddd", backgroundColor: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12, color: "#444" }}>↻ Odśwież</button>
            </div>
            <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 2px 20px rgba(0,0,0,0.06)", minHeight: 400 }}>
              {view === "day" && <DayView date={currentDate} events={events} activePersons={activePersons} />}
              {view === "week" && <WeekView date={currentDate} events={events} activePersons={activePersons} />}
              {view === "month" && <MonthView date={currentDate} events={events} activePersons={activePersons} onDayClick={d => { setCurrentDate(d); setView("day"); }} />}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap", padding: "0 4px" }}>
              {FAMILY.map(p => <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color }} /><span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{p.name}</span></div>)}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#E8475F" }} /><span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>Urodziny</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#4A90D9" }} /><span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>Wyjazd</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
