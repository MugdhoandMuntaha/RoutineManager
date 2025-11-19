/* eslint @typescript-eslint/no-unused-vars: "error" */
/* eslint-disable */
'use client';
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Client, Databases, ID } from "appwrite";

type Routine = {
    $id?: string;
    courseName: string;
    courseCode: string;
    teacherName: string;
    teacherAvatar?: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    ownerId?: string;
    createdAt?: string;
    updatedAt?: string;
};

const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "")
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT || "");

const databases = new Databases(client);
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "691c464a002b469ae69b";
const COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_COLLECTION_ID || "COLLECTION_ID";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}

function minutesToTime(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad(h)}:${pad(m)}`;
}

function nextOccurrenceOf(dayOfWeek: number, timeHHMM: string): Date {
    const now = new Date();
    const target = new Date(now);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    target.setHours(hh, mm, 0, 0);
    
    const diffDays = (dayOfWeek + 7 - target.getDay()) % 7;
    if (diffDays === 0 && target <= now) {
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
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    
    const timersRef = useRef<Record<string, number>>({});
    const pollRef = useRef<number | null>(null);

    const fetchRoutines = useCallback(async () => {
        setLoading(true);
        try {
            const res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID);
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
            toast("Failed to load routines");
        } finally {
            setLoading(false);
        }
    }, []);

    const toast = useCallback((msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3500);
    }, []);

    const clearAllTimers = useCallback(() => {
        Object.values(timersRef.current).forEach(timer => clearTimeout(timer));
        timersRef.current = {};
    }, []);

    const startPolling = useCallback(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = window.setInterval(() => {
            fetchRoutines();
        }, 20000);
    }, [fetchRoutines]);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const requestNotificationPermission = useCallback(async () => {
        if (!("Notification" in window)) return;
        try {
            if (Notification.permission === "default") {
                await Notification.requestPermission();
            }
        } catch (err) {
            console.warn("Notification permission request failed", err);
        }
    }, []);

    const playBeep = useCallback(() => {
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
        } catch (err) {
            console.warn("Audio playback failed:", err);
        }
    }, []);

    const showNotificationFor = useCallback((r: Routine) => {
        toast(`Class starting soon: ${r.courseName} (${r.startTime})`);
        
        if (("Notification" in window) && Notification.permission === "granted") {
            try {
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
                console.warn("Notification failed:", err);
            }
        }
        playBeep();
    }, [toast, playBeep]);

    const scheduleNotificationsForAll = useCallback(() => {
        clearAllTimers();
        const now = new Date().getTime();
        
        routines.forEach(r => {
            const next = nextOccurrenceOf(r.dayOfWeek, r.startTime);
            const notifyAt = new Date(next.getTime() - 5 * 60 * 1000);
            const key = r.$id || `${r.courseCode}-${r.dayOfWeek}-${r.startTime}`;
            const lastNotifiedKey = `routine-notified-${key}`;
            
            if (notifyAt.getTime() < now) return;
            
            const lastNotified = Number(localStorage.getItem(lastNotifiedKey) || "0");
            if (lastNotified >= notifyAt.getTime()) return;
            
            const delay = notifyAt.getTime() - now;
            if (delay > 1000 * 60 * 60 * 24 * 30) return;
            
            const t = window.setTimeout(() => {
                showNotificationFor(r);
                localStorage.setItem(lastNotifiedKey, String(notifyAt.getTime()));
                delete timersRef.current[key];
            }, delay);
            timersRef.current[key] = t;
        });
    }, [routines, clearAllTimers, showNotificationFor]);

    useEffect(() => {
        fetchRoutines();
        startPolling();
        requestNotificationPermission();
        return () => {
            stopPolling();
            clearAllTimers();
        };
    }, [fetchRoutines, startPolling, requestNotificationPermission, stopPolling, clearAllTimers]);

    useEffect(() => {
        scheduleNotificationsForAll();
    }, [scheduleNotificationsForAll]);

    const createRoutine = async (data: Routine) => {
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
            await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), payload);
            await fetchRoutines();
            closeModal();
            toast("Routine created successfully");
        } catch (err) {
            console.error(err);
            toast("Failed to create routine");
        }
    };

    const updateRoutine = async (id: string, data: Routine) => {
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
            toast("Routine updated successfully");
        } catch (err) {
            console.error(err);
            toast("Failed to update routine");
        }
    };

    const deleteRoutine = async (id: string) => {
        if (!confirm("Are you sure you want to delete this routine?")) return;
        try {
            await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, id);
            await fetchRoutines();
            toast("Routine deleted successfully");
        } catch (err) {
            console.error(err);
            toast("Failed to delete routine");
        }
    };

    const openModalForCreate = () => {
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
    };

    const openModalForEdit = (r: Routine) => {
        setIsEditing(true);
        setForm({ ...r });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setIsEditing(false);
    };

    const handleFormSubmit = () => {
        if (!form.courseName || !form.courseCode || !form.teacherName) {
            toast("Please fill in all required fields");
            return;
        }
        if (isEditing && form.$id) {
            updateRoutine(form.$id, form);
        } else {
            createRoutine(form);
        }
    };

    const filteredRoutines = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return routines;
        return routines.filter(r =>
            r.courseName.toLowerCase().includes(q) ||
            r.courseCode.toLowerCase().includes(q) ||
            r.teacherName.toLowerCase().includes(q)
        );
    }, [routines, search]);

    const overviewByDay = useMemo(() => {
        const map: Record<number, Routine[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
        filteredRoutines.forEach(r => {
            if (!map[r.dayOfWeek]) map[r.dayOfWeek] = [];
            map[r.dayOfWeek].push(r);
        });
        Object.keys(map).forEach(k => {
            map[Number(k)].sort((a,b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        });
        return map;
    }, [filteredRoutines]);

    const ClassCard = ({ r }: { r: Routine }) => (
        <div
            onClick={() => setSelectedRoutine(r)}
            className="flex gap-3 items-center p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-lg transition cursor-pointer"
        >
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                {r.teacherAvatar ? (
                    <img src={r.teacherAvatar} alt={r.teacherName} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                    r.teacherName.charAt(0).toUpperCase()
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                    <div className="font-semibold text-slate-900 dark:text-white truncate">{r.courseName}</div>
                    <span className="text-xs text-slate-500 flex-shrink-0">{r.courseCode}</span>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 truncate">{r.teacherName} • {r.startTime} - {r.endTime}</div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-3 items-center justify-center">
                                <h1 className="text-center text-3xl sm:text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                                    Routine Manager
                                </h1>
                            </div>
                            <p className="text-center text-slate-600 dark:text-slate-400 mt-2">Your smart Routine Manager</p>
                        </div>
                        <button onClick={openModalForCreate} className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:shadow-lg transition font-medium whitespace-nowrap">
                            + Add Routine
                        </button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search classes, teacher or code"
                            className="w-full sm:flex-1 px-4 py-3 border rounded-xl bg-gray/80 backdrop-blur text-sm shadow-sm min-w-0"
                        />
                        <div className="flex gap-2">
                            <button onClick={() => setViewMode('overview')} className={`px-4 py-3 rounded-xl text-sm font-medium transition ${viewMode==='overview' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-700 bg-white hover:bg-slate-50'}`}>
                                7-day
                            </button>
                            <button onClick={() => setViewMode('single')} className={`px-4 py-3 rounded-xl text-sm font-medium transition ${viewMode==='single' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-700 bg-white hover:bg-slate-50'}`}>
                                Single
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-8">
                    {viewMode === 'overview' ? (
                        <div className="overflow-x-auto -mx-4 px-4 pb-4">
                            <div className="flex items-center flex-col gap-4 min-w-max md:grid md:grid-cols-7 md:min-w-0">
                                {DAYS.map((d, i) => (
                                    <div key={d} className="w-72 md:w-auto flex-shrink-0">
                                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-4 h-full">
                                            <div className="font-bold text-lg mb-1">{d}</div>
                                            <div className="text-xs text-slate-500 mb-4">{overviewByDay[i]?.length || 0} classes</div>
                                            <div className="space-y-3">
                                                {overviewByDay[i]?.length ? overviewByDay[i].map(r => (
                                                    <div
                                                        key={r.$id}
                                                        onClick={() => setSelectedRoutine(r)}
                                                        className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
                                                    >
                                                        <div className="font-semibold text-sm mb-1 truncate">{r.courseName}</div>
                                                        <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">{r.startTime} - {r.endTime}</div>
                                                        <div className="text-xs text-slate-500 truncate">{r.teacherName}</div>
                                                        <div className="text-xs text-slate-400 mt-1">{r.courseCode}</div>
                                                    </div>
                                                )) : (
                                                    <div className="text-center text-slate-400 py-8 text-sm">No classes</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredRoutines.length ? filteredRoutines.map(r => (
                                <div key={r.$id} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-4">
                                    <ClassCard r={r} />
                                    <div className="flex gap-2 mt-4">
                                        <button onClick={() => openModalForEdit(r)} className="px-4 py-2 text-sm rounded-lg border hover:bg-slate-50 flex-1">
                                            Edit
                                        </button>
                                        <button onClick={() => deleteRoutine(r.$id || "")} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 flex-1">
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )) : (
                                <div className="col-span-full text-center text-slate-400 py-12">No routines found.</div>
                            )}
                        </div>
                    )}
                </div>

                {selectedRoutine && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedRoutine(null)}>
                        <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6">
                                <div className="flex items-start gap-4 mb-6">
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                                        {selectedRoutine.teacherAvatar ? (
                                            <img src={selectedRoutine.teacherAvatar} alt={selectedRoutine.teacherName} className="w-16 h-16 rounded-full object-cover" />
                                        ) : (
                                            selectedRoutine.teacherName.charAt(0).toUpperCase()
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-xl font-bold mb-1">{selectedRoutine.courseName}</h3>
                                        <p className="text-sm text-slate-500">{selectedRoutine.courseCode}</p>
                                    </div>
                                </div>
                                <div className="space-y-3 mb-6">
                                    <div className="text-slate-700 dark:text-slate-300">{selectedRoutine.teacherName}</div>
                                    <div className="text-sm text-slate-600 dark:text-slate-400">
                                        {DAYS[selectedRoutine.dayOfWeek]} • {selectedRoutine.startTime} - {selectedRoutine.endTime}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => {
                                            openModalForEdit(selectedRoutine);
                                            setSelectedRoutine(null);
                                        }}
                                        className="px-4 py-2 rounded-lg border hover:bg-slate-50 dark:hover:bg-slate-700 flex-1 min-w-[100px]"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => {
                                            deleteRoutine(selectedRoutine.$id || "");
                                            setSelectedRoutine(null);
                                        }}
                                        className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex-1 min-w-[100px]"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={() => setSelectedRoutine(null)}
                                        className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 flex-1 min-w-[100px]"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showModal && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={closeModal}>
                        <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-bold">{isEditing ? "Edit Routine" : "Create Routine"}</h2>
                                    <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Course name *</label>
                                        <input value={form.courseName} onChange={(e) => setForm(s => ({...s, courseName: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Course code *</label>
                                        <input value={form.courseCode} onChange={(e) => setForm(s => ({...s, courseCode: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Teacher name *</label>
                                        <input value={form.teacherName} onChange={(e) => setForm(s => ({...s, teacherName: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Teacher avatar (URL)</label>
                                        <input value={form.teacherAvatar} onChange={(e) => setForm(s => ({...s, teacherAvatar: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Day of week</label>
                                        <select value={form.dayOfWeek} onChange={(e) => setForm(s => ({...s, dayOfWeek: Number(e.target.value)}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                                            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Start time</label>
                                            <input type="time" value={form.startTime} onChange={(e) => setForm(s => ({...s, startTime: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">End time</label>
                                            <input type="time" value={form.endTime} onChange={(e) => setForm(s => ({...s, endTime: e.target.value}))} className="mt-1 block w-full rounded-lg p-3 border focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 p-6 bg-slate-50 dark:bg-slate-900 rounded-b-2xl">
                                <button onClick={closeModal} className="px-6 py-3 rounded-lg border flex-1 hover:bg-white dark:hover:bg-slate-800 transition">
                                    Cancel
                                </button>
                                <button onClick={handleFormSubmit} className="px-6 py-3 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex-1 hover:shadow-lg transition">
                                    {isEditing ? "Save" : "Create"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {toastMessage && (
                    <div className="fixed bottom-6 right-6 z-50">
                        <div className="bg-slate-900 text-white px-6 py-4 rounded-xl shadow-2xl">
                            {toastMessage}
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-40">
                        <div className="bg-white dark:bg-slate-800 px-8 py-6 rounded-2xl shadow-2xl">
                            <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                            <div className="font-medium">Loading...</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}