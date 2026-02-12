import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
getAuth,
signInWithEmailAndPassword,
createUserWithEmailAndPassword,
onAuthStateChanged,
signOut,
setPersistence,
browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
getFirestore,
doc,
setDoc,
collection,
addDoc,
updateDoc,
deleteDoc,
query,
orderBy,
onSnapshot,
serverTimestamp,
runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initSocialFeed } from "./social-feed.js"; // <-- Only change for GitHub Pages

// rest of your code unchanged ...


const firebaseConfig = {
apiKey: "AIzaSyAC_Grs2F0UEKfiUn1ckVYxE49Gj2UMAus",
authDomain: "v1999-bfd2e.firebaseapp.com",
projectId: "v1999-bfd2e",
storageBucket: "v1999-bfd2e.firebasestorage.app",
messagingSenderId: "243022609522",
appId: "1:243022609522:web:0c4667ef677fa961ff96eb",
measurementId: "G-GW63MXM2JT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose to window for social-feed.tsx fallback
(window as any).firebaseAuth = auth;
(window as any).firebaseDb = db;

setPersistence(auth, browserLocalPersistence);

const ADMIN_EMAIL = 'iijaggernut@gmail.com';
let isSimulatingUser = false;
let unsubscribeRoadmap: (() => void) | null = null;
let currentFilter = 'all';
let lastSnapshotDocs: any[] = [];
const syncingDocs = new Set<string>();

const checkAdmin = () => {
const user = auth.currentUser;
return user && user.email?.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
};

const showView = (viewId: string) => {
const loader = document.getElementById('global-loader');
const authView = document.getElementById('view-auth');
const roadmapView = document.getElementById('view-dashboard');
const feedView = document.getElementById('view-feed');
const sidebar = document.getElementById('sidebar');
if (loader) loader.classList.add('hidden');

if (viewId === 'view-auth') {
    authView?.classList.remove('hidden');
    roadmapView?.classList.add('hidden');
    feedView?.classList.add('hidden');
    sidebar?.classList.add('hidden');
} else {
    authView?.classList.add('hidden');
    sidebar?.classList.remove('hidden');
    if (viewId === 'view-dashboard') {
        roadmapView?.classList.remove('hidden');
        feedView?.classList.add('hidden');
    } else if (viewId === 'view-feed') {
        roadmapView?.classList.add('hidden');
        feedView?.classList.remove('hidden');
    }
}
window.scrollTo({ top: 0 });

};

(window as any).toggleSidebar = (force?: boolean) => {
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('sidebar-backdrop');
if (!sidebar || !backdrop) return;
const isMobile = window.innerWidth <= 640;

if (isMobile) {
    const isOpen = force !== undefined ? force : !sidebar.classList.contains('sidebar-open');
    if (isOpen) {
        sidebar.classList.add('sidebar-open');
        backdrop.classList.add('visible');
    } else {
        sidebar.classList.remove('sidebar-open');
        backdrop.classList.remove('visible');
    }
} else {
    const isCollapsed = force !== undefined ? !force : !sidebar.classList.contains('sidebar-collapsed');
    if (isCollapsed) {
        sidebar.classList.add('sidebar-collapsed');
    } else {
        sidebar.classList.remove('sidebar-collapsed');
    }
}
};

(window as any).switchView = (viewName: string) => {
const roadmapBtn = document.getElementById('nav-roadmap');
const feedBtn = document.getElementById('nav-feed');
if (viewName === 'roadmap') {
    roadmapBtn?.classList.add('active');
    feedBtn?.classList.remove('active');
    showView('view-dashboard');
} else {
    roadmapBtn?.classList.remove('active');
    feedBtn?.classList.add('active');
    showView('view-feed');
}

if (window.innerWidth <= 640) {
    (window as any).toggleSidebar(false);
}
};

const updateFormDropdowns = () => {
const postDependsSelect = document.getElementById('post-depends-on') as HTMLSelectElement;
if (postDependsSelect) {
const currentVal = postDependsSelect.value;
postDependsSelect.innerHTML = '<option value="">No Dependency (Standalone)</option>' +
lastSnapshotDocs.map(d => <option value="${d.id}">${d.data().title}</option>).join('');
postDependsSelect.value = currentVal;
}
};

const refreshDashboardUI = (user: any) => {
if (!user) return;
const adminPanel = document.getElementById('admin-panel');
const simCtrl = document.getElementById('admin-simulation-ctrl');
const simText = document.getElementById('sim-text');
const navRole = document.getElementById('nav-user-role');
const emailDisplay = document.getElementById('nav-user-email');
const filterBar = document.getElementById('filter-bar-container');
if(emailDisplay) emailDisplay.innerText = user.email;
const isAdmin = checkAdmin();

if (isAdmin) {
    simCtrl?.classList.remove('hidden');
} else {
    simCtrl?.classList.add('hidden');
}

if (isAdmin && !isSimulatingUser) {
    adminPanel?.classList.remove('hidden');
    filterBar?.classList.remove('hidden'); 
    if(simText) simText.innerText = "Simulate User";
    if(navRole) {
        navRole.innerText = "Admin (Live)";
        navRole.className = "px-2 py-0.5 bg-black text-white rounded text-[8px] font-black uppercase border border-black";
    }
    updateFormDropdowns();
} else {
    adminPanel?.classList.add('hidden');
    filterBar?.classList.add('hidden'); 
    if(simText) simText.innerText = "Return to Admin";
    if(navRole) {
        navRole.innerText = isAdmin ? "Admin (Preview)" : "Viewer";
        navRole.className = "px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded text-[8px] font-black uppercase border border-neutral-200";
    }
}
};

(window as any).setFilter = (filter: string) => {
currentFilter = filter;
document.querySelectorAll('.filter-pill').forEach(btn => {
const btnText = btn.textContent?.toLowerCase() || '';
if (btnText === filter) btn.classList.add('active');
else btn.classList.remove('active');
});
renderRoadmap(lastSnapshotDocs);
};

(window as any).moveMilestone = async (e: Event, id: string, direction: 'up' | 'down') => {
e.stopPropagation();
if (!checkAdmin() || isSimulatingUser) return;
const currentIndex = lastSnapshotDocs.findIndex(d => d.id === id);
if (currentIndex === -1) return;

const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
if (swapIndex < 0 || swapIndex >= lastSnapshotDocs.length) return;

const currentDoc = lastSnapshotDocs[currentIndex];
const swapDoc = lastSnapshotDocs[swapIndex];

try {
    await runTransaction(db, async (transaction) => {
        const currentRef = doc(db, 'updates', currentDoc.id);
        const swapRef = doc(db, 'updates', swapDoc.id);
        
        const currentPos = currentDoc.data().position ?? (Date.now() + currentIndex);
        const swapPos = swapDoc.data().position ?? (Date.now() + swapIndex);

        transaction.update(currentRef, { position: swapPos });
        transaction.update(swapRef, { position: currentPos });
    });
} catch (err) {
    console.error("Ordering sync failed:", err);
}
};

(window as any).toggleSubTask = async (docId: string, taskIndex: number) => {
if (!checkAdmin() || isSimulatingUser) return;
if (syncingDocs.has(docId)) return;
const docSnap = lastSnapshotDocs.find(d => d.id === docId);
if (!docSnap) return;

const data = docSnap.data();
const tasks = [...(data.tasks || [])];

if (tasks[taskIndex]) {
    if (typeof tasks[taskIndex] === 'string') {
        tasks[taskIndex] = { text: tasks[taskIndex], done: true };
    } else {
        tasks[taskIndex] = { ...tasks[taskIndex], done: !tasks[taskIndex].done };
    }
    
    syncingDocs.add(docId);
    try {
        await updateDoc(doc(db, 'updates', docId), { tasks });
    } catch (err) {
        console.error("Task update failed:", err);
    } finally {
        syncingDocs.delete(docId);
    }
}
};

(window as any).cycleStatus = async (e: Event, id: string, currentStatus: string) => {
e.stopPropagation();
if (!checkAdmin() || isSimulatingUser) return;
if (syncingDocs.has(id)) return;
syncingDocs.add(id);
const statuses = ['pending', 'active', 'completed', 'blocked'];
let normalized = (currentStatus || 'pending').toLowerCase();
if (normalized === 'in-progress') normalized = 'active';

const currIdx = statuses.indexOf(normalized);
const nextIdx = (currIdx === -1 ? 0 : currIdx + 1) % statuses.length;
const nextStatus = statuses[nextIdx];

try {
    await updateDoc(doc(db, 'updates', id), { status: nextStatus, lastUpdated: serverTimestamp() });
} catch (err) {
    console.error("Status cycle failed:", err);
} finally {
    syncingDocs.delete(id);
}
};

(window as any).toggleExpand = (id: string) => {
const details = document.getElementById(details-${id});
const arrow = document.getElementById(arrow-${id});
if (details) details.classList.toggle('expanded');
if (arrow) arrow.classList.toggle('rotate-180');
};

(window as any).toggleMilestoneMenu = (id: string) => {
const menu = document.getElementById(milestone-menu-${id});
if (menu) menu.classList.toggle('hidden');
};

(window as any).handleEdit = (id: string) => {
const docSnap = lastSnapshotDocs.find(d => d.id === id);
if (!docSnap) return;
const data = docSnap.data();
(document.getElementById('edit-id') as HTMLInputElement).value = id;
(document.getElementById('edit-title') as HTMLInputElement).value = data.title || '';
(document.getElementById('edit-short-desc') as HTMLTextAreaElement).value = data.shortDescription || '';
(document.getElementById('edit-long-desc') as HTMLTextAreaElement).value = data.longDescription || '';
(document.getElementById('edit-images') as HTMLInputElement).value = (data.images || []).join(', ');

const tasks = data.tasks || [];
const tasksStr = tasks.map((t: any) => typeof t === 'string' ? t : t.text).join('\n');
(document.getElementById('edit-tasks') as HTMLTextAreaElement).value = tasksStr;

const editDependsSelect = document.getElementById('edit-depends-on') as HTMLSelectElement;
if (editDependsSelect) {
    editDependsSelect.innerHTML = '<option value="">No Dependency (Standalone)</option>' + 
        lastSnapshotDocs
            .filter(d => d.id !== id)
            .map(d => `<option value="${d.id}">${d.data().title}</option>`).join('');
    editDependsSelect.value = data.dependsOn || '';
}

document.getElementById('edit-modal')?.classList.remove('hidden');
setTimeout(() => {
    document.getElementById('modal-overlay')?.classList.add('opacity-100');
    document.getElementById('modal-card')?.classList.add('scale-100', 'opacity-100');
}, 10);
};

(window as any).closeEditModal = () => {
document.getElementById('modal-overlay')?.classList.remove('opacity-100');
document.getElementById('modal-card')?.classList.remove('scale-100', 'opacity-100');
setTimeout(() => document.getElementById('edit-modal')?.classList.add('hidden'), 300);
};

onAuthStateChanged(auth, (user) => {
if (user) {
refreshDashboardUI(user);
setupRoadmapListener();
initSocialFeed(auth, db, checkAdmin() && !isSimulatingUser);
showView('view-dashboard');
} else {
showView('view-auth');
}
});

function setupRoadmapListener() {
if (unsubscribeRoadmap) unsubscribeRoadmap();
const q = query(collection(db, 'updates'), orderBy('position', 'asc'));
unsubscribeRoadmap = onSnapshot(q, (snap) => {
lastSnapshotDocs = snap.docs;
renderRoadmap(lastSnapshotDocs);
updateFormDropdowns();
});
}

function renderRoadmap(docs: any[]) {
const container = document.getElementById('roadmap-container');
if (!container) return;
const filteredDocs = currentFilter === 'all' ? docs : docs.filter(d => (d.data().status || 'pending').toLowerCase() === currentFilter);
if (filteredDocs.length === 0) {
    container.innerHTML = `<div class="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-neutral-100 w-full"><p class="text-[10px] text-neutral-300 font-black uppercase tracking-widest">No milestones in this category</p></div>`;
    return;
}

const isAdmin = checkAdmin() && !isSimulatingUser;
container.innerHTML = filteredDocs.map((docItem, idx) => {
    const data = docItem.data();
    const id = docItem.id;
    const status = (data.status || 'pending').toLowerCase();
    const isLast = idx === filteredDocs.length - 1;
    const isFirst = idx === 0;
    const tasks = data.tasks || [];
    const dependsOnId = data.dependsOn;
    const parentDoc = dependsOnId ? docs.find(d => d.id === dependsOnId) : null;
    const parentTitle = parentDoc ? parentDoc.data().title : null;

    const completedCount = tasks.filter((t: any) => (typeof t === 'object' ? t.done : false)).length;
    const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
    const time = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString(undefined, {month:'short', year:'numeric'}) : 'Syncing...';

    let markerClass = 'bg-neutral-200'; let icon = '';
    let badgeClass = 'bg-white text-neutral-400'; 
    let badgeText = 'Pending';

    if (status === 'active' || status === 'in-progress') { 
        markerClass = 'bg-black'; 
        icon = '<div class="w-2 h-2 rounded-full bg-white animate-pulse"></div>';
        badgeClass = 'border border-black bg-black text-white';
        badgeText = 'Current';
    } else if (status === 'completed') { 
        markerClass = 'bg-black'; 
        icon = '<svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>';
        badgeClass = 'border border-black bg-white text-black';
        badgeText = 'Completed';
    } else if (status === 'blocked') { 
        markerClass = 'bg-neutral-400'; 
        icon = '<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="3" d="M6 18L18 6M6 6l12 12"/></svg>';
        badgeClass = 'border border-neutral-200 bg-neutral-100 text-neutral-500 line-through decoration-neutral-400';
        badgeText = 'Blocked';
    }

    const isPending = status === 'pending';
    const titleColorClass = isPending ? 'text-neutral-400' : 'text-black';
    const pillBorderClass = (isAdmin && !isPending) ? 'border-2 border-black' : 'border border-neutral-100';

    return `
    <div class="flex gap-4 sm:gap-14 stagger-item w-full relative" style="animation-delay: ${idx * 0.1}s">
        <div class="relative flex flex-col items-center flex-shrink-0 w-12 sm:w-16">
            <div class="roadmap-line ${isLast ? 'roadmap-line-gradient' : ''}"></div>
            ${isAdmin ? `
            <div class="flex flex-col items-center gap-1 mb-2 z-20">
                ${!isFirst ? `<button onclick="window.moveMilestone(event, '${id}', 'up')" class="p-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-300 hover:text-black shadow-sm active:scale-90 transition-transform"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="4" d="M5 15l7-7 7 7"/></svg></button>` : '<div class="h-6"></div>'}
            </div>` : ''}
            <div 
                ${isAdmin ? `onclick="window.cycleStatus(event, '${id}', '${status}')"` : ''}
                class="z-10 w-12 h-20 sm:w-16 sm:h-24 flex items-center justify-center rounded-full bg-white shadow-inner ${isAdmin ? 'cursor-pointer hover:ring-4 hover:ring-neutral-100 transition-all' : ''} ${pillBorderClass}"
            >
                <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-full ${markerClass} flex items-center justify-center shadow-lg">
                    ${icon}
                </div>
            </div>
            ${isAdmin ? `
            <div class="flex flex-col items-center gap-1 mt-2 z-20">
                ${!isLast ? `<button onclick="window.moveMilestone(event, '${id}', 'down')" class="p-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-300 hover:text-black shadow-sm active:scale-90 transition-transform"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="4" d="M19 9l-7 7-7-7"/></svg></button>` : ''}
            </div>` : ''}
        </div>

        <div class="flex-1 pb-20 relative">
            <div onclick="window.toggleExpand('${id}')" class="hover-card bg-white p-6 sm:p-10 rounded-[2rem] border border-neutral-100 shadow-sm cursor-pointer relative group">
                <div class="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="px-2.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest ${badgeClass}">${badgeText}</span>
                            ${parentTitle ? `<span class="px-2.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border border-neutral-100 text-neutral-400">Step After: ${parentTitle}</span>` : ''}
                        </div>
                        <h3 class="text-xl sm:text-3xl font-black ${titleColorClass} leading-tight tracking-tight">${data.title || 'Untitled Milestone'}</h3>
                    </div>
                    
                    <div class="flex items-center gap-3 self-end sm:self-start">
                        <span class="text-[10px] font-black text-neutral-300 uppercase tracking-widest">${time}</span>
                        <div id="arrow-${id}" class="w-8 h-8 rounded-full border border-neutral-100 flex items-center justify-center text-neutral-300 group-hover:text-black group-hover:border-black transition-all">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="3" d="M19 9l-7 7-7-7"/></svg>
                        </div>

                        ${isAdmin ? `
                        <div class="relative ml-2">
                            <button onclick="event.stopPropagation(); window.toggleMilestoneMenu('${id}')" class="p-2 rounded-full hover:bg-neutral-100 transition-all text-neutral-300 hover:text-black">
                                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                            <div id="milestone-menu-${id}" class="hidden absolute right-0 mt-2 w-40 bg-white border border-black shadow-2xl rounded-2xl z-[100] py-2 overflow-hidden animate-in fade-in slide-in-from-top-2">
                                <button onclick="event.stopPropagation(); window.handleEdit('${id}'); window.toggleMilestoneMenu('${id}')" class="w-full text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-neutral-50 flex items-center gap-2">
                                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                                    Edit
                                </button>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <p class="text-sm sm:text-lg font-medium text-neutral-600 leading-relaxed max-w-2xl">${data.shortDescription || ''}</p>
                
                <div class="mt-8 flex items-center gap-4">
                    <div class="flex-1 h-1.5 bg-neutral-50 rounded-full overflow-hidden border border-neutral-100">
                        <div class="h-full bg-black transition-all duration-1000" style="width: ${progress}%"></div>
                    </div>
                    <span class="text-[10px] font-black text-black uppercase tracking-widest">${progress}% Done</span>
                </div>

                <div id="details-${id}" class="milestone-details">
                    <div class="pt-8 border-t border-neutral-100 space-y-8">
                        <div>
                            <h4 class="text-[10px] font-black text-neutral-400 uppercase tracking-[0.3em] mb-4">Milestone Overview</h4>
                            <p class="text-neutral-800 leading-relaxed font-medium whitespace-pre-wrap">${data.longDescription || 'No additional details provided.'}</p>
                        </div>

                        ${tasks.length > 0 ? `
                        <div>
                            <h4 class="text-[10px] font-black text-neutral-400 uppercase tracking-[0.3em] mb-4">Action Items</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                ${tasks.map((t: any, tIdx: number) => {
                                    const done = typeof t === 'object' ? t.done : false;
                                    const text = typeof t === 'object' ? t.text : t;
                                    return `
                                    <div 
                                        ${isAdmin ? `onclick="event.stopPropagation(); window.toggleSubTask('${id}', ${tIdx})"` : ''}
                                        class="flex items-center gap-3 p-4 rounded-2xl border transition-all ${done ? 'bg-neutral-50 border-neutral-200 opacity-60' : 'bg-white border-neutral-100'} ${isAdmin ? 'cursor-pointer hover:border-black' : ''}"
                                    >
                                        <div class="w-5 h-5 rounded-md border flex items-center justify-center ${done ? 'bg-black border-black' : 'bg-white border-neutral-300'}">
                                            ${done ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="4"><path d="M5 13l4 4L19 7"/></svg>' : ''}
                                        </div>
                                        <span class="text-xs font-bold ${done ? 'line-through text-neutral-500' : 'text-black'}">${text}</span>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>` : ''}

                        ${(data.images && data.images.length > 0) ? `
                        <div>
                            <h4 class="text-[10px] font-black text-neutral-400 uppercase tracking-[0.3em] mb-4">Gallery</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                ${data.images.map((img: string) => `
                                    <div class="rounded-3xl overflow-hidden border border-neutral-100 shadow-sm aspect-video bg-neutral-50">
                                        <img src="${img}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-700" loading="lazy">
                                    </div>
                                `).join('')}
                            </div>
                        </div>` : ''}
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}).join('');
}

const editForm = document.getElementById('edit-form');
if (editForm) {
editForm.onsubmit = async (e) => {
e.preventDefault();
if (!checkAdmin() || isSimulatingUser) return;
const id = (document.getElementById('edit-id') as HTMLInputElement).value;
const title = (document.getElementById('edit-title') as HTMLInputElement).value.trim();
const shortDescription = (document.getElementById('edit-short-desc') as HTMLTextAreaElement).value.trim();
const longDescription = (document.getElementById('edit-long-desc') as HTMLTextAreaElement).value.trim();
const dependsOn = (document.getElementById('edit-depends-on') as HTMLSelectElement).value;
const tasksRaw = (document.getElementById('edit-tasks') as HTMLTextAreaElement).value.trim().split('\n').filter(s => s);
const existingDoc = lastSnapshotDocs.find(d => d.id === id);
    const existingTasks = existingDoc?.data().tasks || [];
    const tasks = tasksRaw.map(t => {
        const found = existingTasks.find((et: any) => (typeof et === 'object' ? et.text === t : et === t));
        return { text: t, done: (typeof found === 'object') ? found.done : false };
    });

    const imagesStr = (document.getElementById('edit-images') as HTMLInputElement).value.trim();
    const images = imagesStr ? imagesStr.split(',').map(s => s.trim()).filter(s => s) : [];
    const btn = document.getElementById('edit-submit-btn') as HTMLButtonElement;

    btn.disabled = true; btn.innerText = "Saving...";
    try {
        await updateDoc(doc(db, 'updates', id), { 
            title, shortDescription, longDescription, images, tasks, dependsOn,
            lastUpdated: serverTimestamp() 
        });
        (window as any).closeEditModal();
    } catch (err: any) {
        console.error("Update error:", err);
        alert(`Update Rejected: ${err.message}`);
    } finally {
        btn.disabled = false; btn.innerText = "Save";
    }
};
}

const postForm = document.getElementById('post-form') as HTMLFormElement | null;
if (postForm) {
postForm.onsubmit = async (e) => {
e.preventDefault();
if (!checkAdmin() || isSimulatingUser) return;
const title = (document.getElementById('post-title') as HTMLInputElement).value.trim();
const shortDescription = (document.getElementById('post-short-desc') as HTMLTextAreaElement).value.trim();
const longDescription = (document.getElementById('post-long-desc') as HTMLTextAreaElement).value.trim();
const tasksRaw = (document.getElementById('post-tasks') as HTMLTextAreaElement).value.trim().split('\n').filter(s => s);
const dependsOn = (document.getElementById('post-depends-on') as HTMLSelectElement).value;
const tasks = tasksRaw.map(t => ({ text: t, done: false }));
const imagesStr = (document.getElementById('post-images') as HTMLInputElement).value.trim();
    const images = imagesStr ? imagesStr.split(',').map(s => s.trim()).filter(s => s) : [];
    const btn = document.getElementById('post-submit-btn') as HTMLButtonElement;

    btn.disabled = true; btn.innerText = "Adding...";
    try {
        const pos = lastSnapshotDocs.length > 0 ? (lastSnapshotDocs[lastSnapshotDocs.length - 1].data().position || 0) + 1000 : Date.now();
        await addDoc(collection(db, 'updates'), {
            title, shortDescription, longDescription, images, tasks, dependsOn,
            status: 'pending', 
            timestamp: serverTimestamp(), 
            author: auth.currentUser?.email,
            uid: auth.currentUser?.uid,
            position: pos
        });
        postForm.reset();
    } catch (err: any) {
        alert(`Post Rejected: ${err.message}`);
    } finally {
        btn.disabled = false; btn.innerText = "Manual Post";
    }
};
}

const authForm = document.getElementById('auth-form');
if (authForm) {
authForm.onsubmit = async (e) => {
e.preventDefault();
const email = (document.getElementById('email') as HTMLInputElement).value.trim();
const password = (document.getElementById('password') as HTMLInputElement).value;
const btn = document.getElementById('auth-submit-btn') as HTMLButtonElement;
const isLogin = (document.getElementById('auth-title') as HTMLElement).innerText === 'Sign In';
btn.innerText = "Authenticating...";
try {
const res = await (isLogin ? signInWithEmailAndPassword(auth, email, password) : createUserWithEmailAndPassword(auth, email, password));
if (!isLogin) {
await setDoc(doc(db, 'users', res.user.uid), {
email,
uid: res.user.uid,
role: (email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'viewer'),
createdAt: serverTimestamp()
});
}
} catch (err: any) {
alert(err.message);
btn.innerText = isLogin ? "Enter Dashboard" : "Join Team";
}
};
}

const authToggle = document.getElementById('auth-toggle');
if (authToggle) {
authToggle.onclick = () => {
const title = document.getElementById('auth-title') as HTMLElement;
const btn = document.getElementById('auth-submit-btn') as HTMLElement;
const isLogin = title.innerText === 'Sign In';
title.innerText = isLogin ? 'Create Account' : 'Sign In';
btn.innerText = isLogin ? 'Join Team' : 'Enter Dashboard';
authToggle.innerText = isLogin ? "Already have an account? Sign In" : "New user? Create account";
};
}

const logoutBtn = document.getElementById('sidebar-logout-btn');
if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

document.getElementById('toggle-sim-mode')?.addEventListener('click', () => {
isSimulatingUser = !isSimulatingUser;
refreshDashboardUI(auth.currentUser);
renderRoadmap(lastSnapshotDocs);
initSocialFeed(auth, db, checkAdmin() && !isSimulatingUser);
});



