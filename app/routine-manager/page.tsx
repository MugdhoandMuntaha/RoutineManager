/* eslint @typescript-eslint/no-unused-vars: "error" */
'use client';

import React, { useEffect, useMemo, useState, useRef } from "react";
import { Client, Databases, ID, Models } from "appwrite";


type Routine = {
    $id?: string;
    courseName: string;
    courseCode: string;
    teacherName: string;
    teacherAvatar?: string;
    dayOfWeek: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday
    startTime: string; // "HH:MM" 24-hour
    endTime: string;   // "HH:MM"
    ownerId?: string; // user id (if you manage users)
    createdAt?: string;
    updatedAt?: string;
};

const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "") // e.g. https://cloud.appwrite.io/v1
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT || "");

const databases = new Databases(client);
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "691c464a002b469ae69b";
const COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_COLLECTION_ID || "COLLECTION_ID";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMinutes(t: string) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}
function pad(n: number) { return n.toString().padStart(2, "0"); }
function minutesToTime(min: number) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad(h)}:${pad(m)}`;
}
function nextOccurrenceOf(dayOfWeek: number, timeHHMM: string) {
    const now = new Date();
    const target = new Date(now);
    // set target to today's date but with time
    const [hh, mm] = timeHHMM.split(":").map(Number);
    target.setHours(hh, mm, 0, 0);
    const diffDays = (dayOfWeek + 7 - target.getDay()) % 7;
    if (diffDays === 0 && target <= now) {
        // same day but already passed -> next week
        target.setDate(target.getDate() + 7);
    } else {
        target.setDate(target.getDate() + diffDays);
    }
    return target;
}

export default function RoutineManager() {
    const [routines, setRoutines] = useState<Routine[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'overview' | 'single'>('overview');
    const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [form, setForm] = useState<Routine>({
        courseName: "",
        courseCode: "",
        teacherName: "",
        teacherAvatar: "",
        dayOfWeek: new Date().getDay(),
        startTime: "09:00",
        endTime: "10:00",
    });
    const [search, setSearch] = useState("");
    const timersRef = useRef<Record<string, number | NodeJS.Timeout>>({});
    const pollRef = useRef<number | null>(null);

    useEffect(() => {
        fetchRoutines();
        startPolling();
        requestNotificationPermission();
        return () => {
            stopPolling();
            clearAllTimers();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        scheduleNotificationsForAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routines]);

    // Poll every 20 seconds for simplicity (or implement Appwrite Realtime if you prefer)
    function startPolling() {
        stopPolling();
        pollRef.current = window.setInterval(() => {
            fetchRoutines();
        }, 20000);
    }
    function stopPolling() {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }

    async function fetchRoutines() {
        setLoading(true);
        try {
            // Query: fetch all documents in the collection
            const res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID);
            // Appwrite returns documents as an array of objects with $id and $createdAt etc.
            const docs = (res.documents || []) as any[];
            const parsed = docs.map((d) => ({
                $id: d.$id,
                courseName: d.courseName,
                courseCode: d.courseCode,
                teacherName: d.teacherName,
                teacherAvatar: d.teacherAvatar,
                dayOfWeek: Number(d.dayOfWeek),
                startTime: d.startTime,
                endTime: d.endTime,
                createdAt: d.$createdAt,
                updatedAt: d.$updatedAt,
                ownerId: d.ownerId,
            })) as Routine[];
            setRoutines(parsed.sort((a, b) => {
                if (a.dayOfWeek === b.dayOfWeek) {
                    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
                }
                return a.dayOfWeek - b.dayOfWeek;
            }));
        } catch (err) {
            console.error("Failed to fetch routines:", err);
        } finally {
            setLoading(false);
        }
    }

    async function createRoutine(data: Routine) {
        try {
            const payload = {
                courseName: data.courseName,
                courseCode: data.courseCode,
                teacherName: data.teacherName,
                teacherAvatar: data.teacherAvatar || "",
                dayOfWeek: String(data.dayOfWeek),
                startTime: data.startTime,
                endTime: data.endTime,
            };
            const res = await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), payload);
            await fetchRoutines();
            closeModal();
            toast("Routine created");
        } catch (err) {
            console.error(err);
            toast("Failed to create routine");
        }
    }

    async function updateRoutine(id: string, data: Routine) {
        try {
            const payload: any = {
                courseName: data.courseName,
                courseCode: data.courseCode,
                teacherName: data.teacherName,
                teacherAvatar: data.teacherAvatar || "",
                dayOfWeek: String(data.dayOfWeek),
                startTime: data.startTime,
                endTime: data.endTime,
            };
            await databases.updateDocument(DATABASE_ID, COLLECTION_ID, id, payload);
            await fetchRoutines();
            closeModal();
            toast("Routine updated");
        } catch (err) {
            console.error(err);
            toast("Failed to update");
        }
    }

    async function deleteRoutine(id: string) {
        if (!confirm("Delete this routine?")) return;
        try {
            await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, id);
            await fetchRoutines();
            toast("Deleted");
        } catch (err) {
            console.error(err);
            toast("Delete failed");
        }
    }

    function openModalForCreate() {
        setIsEditing(false);
        setForm({
            courseName: "",
            courseCode: "",
            teacherName: "",
            teacherAvatar: "",
            dayOfWeek: new Date().getDay(),
            startTime: "09:00",
            endTime: "10:00",
        });
        setShowModal(true);
    }
    function openModalForEdit(r: Routine) {
        setIsEditing(true);
        setForm({ ...r });
        setShowModal(true);
    }
    function closeModal() {
        setShowModal(false);
        setIsEditing(false);
    }

    function onFormSubmit(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (!form.courseName || !form.courseCode || !form.teacherName) {
            toast("Please fill required fields");
            return;
        }
        if (isEditing && form.$id) {
            updateRoutine(form.$id, form);
        } else {
            createRoutine(form);
        }
    }

    function filteredRoutines() {
        const q = search.trim().toLowerCase();
        if (!q) return routines;
        return routines.filter(r =>
            r.courseName.toLowerCase().includes(q) ||
            r.courseCode.toLowerCase().includes(q) ||
            r.teacherName.toLowerCase().includes(q)
        );
    }

    // UI helpers for overview view
    const overviewByDay = useMemo(() => {
        const map: Record<number, Routine[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
        filteredRoutines().forEach(r => {
            (map[r.dayOfWeek] ||= []).push(r);
        });
        Object.keys(map).forEach(k => {
            map[Number(k)].sort((a,b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        });
        return map;
    }, [routines, search]);

    // Notification utilities
    async function requestNotificationPermission() {
        if (!("Notification" in window)) return;
        try {
            if (Notification.permission === "default") {
                await Notification.requestPermission();
            }
        } catch (err) {
            console.warn("Notification permission request failed", err);
        }
    }

    function clearAllTimers() {
        for (const k in timersRef.current) {
            try { clearTimeout(timersRef.current[k] as any); } catch {}
        }
        timersRef.current = {};
    }

    function scheduleNotificationsForAll() {
        clearAllTimers();
        const now = new Date().getTime();
        routines.forEach(r => {
            // compute next occurrence of this routine
            const next = nextOccurrenceOf(r.dayOfWeek, r.startTime);
            const notifyAt = new Date(next.getTime() - 5 * 60 * 1000); // 5 minutes before
            const key = r.$id || `${r.courseCode}-${r.dayOfWeek}-${r.startTime}`;
            const lastNotifiedKey = `routine-notified-${key}`;

            // Avoid scheduling timers too far in future—still we schedule if within 7 days
            if (notifyAt.getTime() < now) return; // already passed for this cycle
            // set only if not already fired recently (persist check)
            const lastNotified = Number(localStorage.getItem(lastNotifiedKey) || "0");
            if (lastNotified >= notifyAt.getTime()) {
                // already notified or scheduled previously
                return;
            }
            const delay = notifyAt.getTime() - now;
            // safety: if delay > 30 days skip
            if (delay > 1000 * 60 * 60 * 24 * 30) return;
            // schedule
            const t = setTimeout(() => {
                showNotificationFor(r);
                localStorage.setItem(lastNotifiedKey, String(notifyAt.getTime()));
                delete timersRef.current[key];
            }, delay);
            timersRef.current[key] = t;
        });
    }

    function showNotificationFor(r: Routine) {
        // in-app toast
        toast(`Class starting soon: ${r.courseName} (${r.startTime})`);
        // browser notification
        if (("Notification" in window) && Notification.permission === "granted") {
            try {
                // @ts-ignore
                const n = new Notification(r.courseName, {
                    body: `${r.teacherName} — ${r.startTime} - ${r.endTime} (starts in 5 minutes)`,
                    icon: r.teacherAvatar || undefined,
                    tag: r.$id || `${r.courseCode}-${r.startTime}`,
                    renotify: true,
                });
                n.onclick = () => {
                    window.focus();
                    setSelectedRoutine(r);
                };
            } catch (err) {
                // ignore
            }
        }
        // optional sound
        playBeep();
    }

    function playBeep() {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.value = 880;
            o.connect(g);
            g.connect(ctx.destination);
            o.start();
            g.gain.setValueAtTime(0.02, ctx.currentTime);
            o.stop(ctx.currentTime + 0.25);
        } catch (err) {}
    }

    // Simple toast (inline)
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    function toast(msg: string) {
        setToastMessage(msg);
        window.setTimeout(() => setToastMessage(null), 3500);
    }

    // Render helpers
    function ClassCard({ r }: { r: Routine }) {
        return (
            <div
                onClick={() => { setSelectedRoutine(r); }}
                className="flex gap-3 items-center p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-lg transition cursor-pointer"
            >
                <img src={r.teacherAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.teacherName)}&background=0D9488&color=fff`} alt={r.teacherName}
                     className="w-12 h-12 rounded-full object-cover flex-none" />
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">{r.courseName}</h4>
                        <span className="text-xs text-slate-500">{r.courseCode}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{r.teacherName} • {r.startTime} - {r.endTime}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 p-6">
            <div className="max-w-6xl mx-auto">
                <header className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">Routine Manager</h1>
                        <p className="text-sm text-slate-500">Plan your weekly classes. Modern, sleek and Appwrite-powered.</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search classes, teacher or code"
                               className="px-3 py-2 border rounded-lg bg-white/80 backdrop-blur text-sm shadow-sm" />
                        <div className="flex gap-2 bg-white/70 p-1 rounded-lg shadow-sm">
                            <button onClick={() => setViewMode('overview')} className={`px-3 py-2 rounded-lg text-sm ${viewMode==='overview' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>7-day</button>
                            <button onClick={() => setViewMode('single')} className={`px-3 py-2 rounded-lg text-sm ${viewMode==='single' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>Single</button>
                        </div>
                        <button onClick={openModalForCreate} className="px-4 py-2 bg-indigo-600 text-white rounded-lg shadow hover:brightness-105">+ Add Routine</button>
                    </div>
                </header>

                {/* MAIN */}
                <main>
                    {viewMode === 'overview' ? (
                        <section className="grid grid-cols-1 md:grid-cols-7 gap-4">
                            {DAYS.map((d, i) => (
                                <div key={d} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-sm font-semibold">{d}</h3>
                                        <span className="text-xs text-slate-500">{overviewByDay[i]?.length || 0} classes</span>
                                    </div>
                                    <div className="space-y-2">
                                        {overviewByDay[i]?.length ? overviewByDay[i].map(r => (
                                            <div key={r.$id || `${r.courseCode}-${r.startTime}`} onClick={() => setSelectedRoutine(r)}
                                                 className="p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="text-sm font-medium">{r.courseName}</div>
                                                        <div className="text-xs text-slate-500">{r.startTime} - {r.endTime} • {r.teacherName}</div>
                                                    </div>
                                                    <div className="text-xs px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800">{r.courseCode}</div>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="text-xs text-slate-400 italic">No classes</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </section>
                    ) : (
                        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {filteredRoutines().length ? filteredRoutines().map(r => (
                                <div key={r.$id || `${r.courseCode}-${r.startTime}`} className="rounded-2xl">
                                    <ClassCard r={r} />
                                    <div className="mt-2 flex justify-end gap-2">
                                        <button onClick={() => openModalForEdit(r)} className="px-3 py-1 text-xs rounded-md border">Edit</button>
                                        <button onClick={() => deleteRoutine(r.$id || "")} className="px-3 py-1 text-xs rounded-md bg-red-600 text-white">Delete</button>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-sm text-slate-500">No routines found.</div>
                            )}
                        </section>
                    )}
                </main>

                {/* Selected routine popup */}
                {selectedRoutine && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
                        <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedRoutine(null)} />
                        <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-lg z-50">
                            <div className="flex items-start gap-4">
                                <img src={selectedRoutine.teacherAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedRoutine.teacherName)}&background=0D9488&color=fff`} alt="avatar" className="w-16 h-16 rounded-full object-cover" />
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold">{selectedRoutine.courseName}</h3>
                                        <div className="text-sm text-slate-500">{selectedRoutine.courseCode}</div>
                                    </div>
                                    <p className="text-sm text-slate-500 mt-1">{selectedRoutine.teacherName}</p>
                                    <p className="text-sm text-slate-500 mt-2">{DAYS[selectedRoutine.dayOfWeek]} • {selectedRoutine.startTime} - {selectedRoutine.endTime}</p>
                                    <div className="mt-4 flex gap-2">
                                        <button onClick={() => { openModalForEdit(selectedRoutine); setSelectedRoutine(null); }} className="px-4 py-2 rounded-lg border">Edit</button>
                                        <button onClick={() => { deleteRoutine(selectedRoutine.$id || ""); setSelectedRoutine(null); }} className="px-4 py-2 rounded-lg bg-red-600 text-white">Delete</button>
                                        <button onClick={() => setSelectedRoutine(null)} className="px-4 py-2 rounded-lg">Close</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal - Create/Edit */}
                {showModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                        <div className="absolute inset-0 bg-black/40" onClick={closeModal}></div>
                        <form onSubmit={onFormSubmit} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-lg z-50">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold">{isEditing ? "Edit Routine" : "Create Routine"}</h3>
                                <button type="button" onClick={closeModal} className="text-slate-500">Close</button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-600">Course name</label>
                                    <input value={form.courseName} onChange={e => setForm(s => ({...s, courseName: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-600">Course code</label>
                                    <input value={form.courseCode} onChange={e => setForm(s => ({...s, courseCode: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-600">Teacher name</label>
                                    <input value={form.teacherName} onChange={e => setForm(s => ({...s, teacherName: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-600">Teacher avatar (URL)</label>
                                    <input value={form.teacherAvatar} onChange={e => setForm(s => ({...s, teacherAvatar: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-600">Day of week</label>
                                    <select value={String(form.dayOfWeek)} onChange={e => setForm(s => ({...s, dayOfWeek: Number(e.target.value)}))} className="mt-1 block w-full rounded-lg p-2 border">
                                        {DAYS.map((d, i) => <option value={i} key={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="block text-xs text-slate-600">Start time</label>
                                        <input type="time" value={form.startTime} onChange={e => setForm(s => ({...s, startTime: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-xs text-slate-600">End time</label>
                                        <input type="time" value={form.endTime} onChange={e => setForm(s => ({...s, endTime: e.target.value}))} className="mt-1 block w-full rounded-lg p-2 border" />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button type="button" onClick={closeModal} className="px-4 py-2 rounded-lg border">Cancel</button>
                                <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white">{isEditing ? "Save" : "Create"}</button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Toast */}
                {toastMessage && (
                    <div className="fixed right-6 bottom-6 z-50">
                        <div className="bg-slate-900 text-white py-2 px-4 rounded-lg shadow">{toastMessage}</div>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="fixed left-4 bottom-6 z-40">
                        <div className="bg-white px-3 py-2 rounded-lg shadow">Loading...</div>
                    </div>
                )}
            </div>
        </div>
    );
}
