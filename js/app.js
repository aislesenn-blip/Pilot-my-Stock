import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation } from './services.js';
import { supabase } from './supabase.js';
import { formatDate } from './utils.js';

let profile = null;

// --- 1. MZIZI WA TATIZO UMETATULIWA HAPA ---
window.onload = async () => {
    // Angalia kama kuna Session
    const session = await getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    try {
        // Jaribu kuvuta Profile
        profile = await getCurrentProfile(session.user.id);
        
        // LOGIC MPYA: KAMA PROFILE HAIPO (NULL), USIGANDE! NENDA SETUP.
        // Hii ndio inazuia ile spinning ya milele
        if (!profile || !profile.organization_id) {
            console.warn("Profile not found or incomplete. Redirecting to Setup...");
            window.location.href = 'setup.html';
            return; 
        }

        // Kama Profile ipo, jaza UI
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Anza Mfumo
        router('inventory');

    } catch (error) {
        console.error("Critical Error:", error);
        // Ikitokea error yoyote mbaya, mtoe nje aanze upya badala ya kuganda
        localStorage.clear();
        window.location.href = 'index.html';
    }
};

window.router = async (view) => {
    const app = document.getElementById('app-view');
    // Weka Spinner wakati anahama page
    app.innerHTML = '<div class="flex items-center justify-center h-full"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div></div>';
    
    // Highlight Menu
    document.querySelectorAll('.nav-item').forEach(b => {
        b.classList.remove('bg-gray-50', 'text-black');
        // Reset icons color if needed
    });
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    if (view === 'inventory') await renderInventory(app);
    if (view === 'settings') await renderSettings(app);
    // Ongeza modules zingine hapa (bar, staff, etc)
};

// --- VIEW: INVENTORY ---
async function renderInventory(container) {
    try {
        const data = await getInventory(profile.organization_id, profile.role === 'manager' ? null : profile.assigned_location_id);
        
        const rows = data.map(i => `
            <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">
                <td class="p-4 font-bold text-gray-900">${i.products?.name || 'Unknown Item'}</td>
                <td class="p-4 text-gray-500 text-xs">${i.locations?.name || 'Unknown Loc'}</td>
                <td class="p-4 font-mono font-medium">${Number(i.quantity).toFixed(2)} ${i.products?.unit || ''}</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Inventory</h1>
                    <p class="text-gray-500 mt-1">Live stock levels.</p>
                </div>
            </div>
            <div class="glass rounded-2xl overflow-hidden fade-in shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50/50 border-b border-gray-100 text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                        <tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Qty</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No stock found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="text-red-500 p-10 text-center">Failed to load inventory. <br> <button onclick="window.location.reload()" class="underline">Retry</button></div>`;
    }
}

// --- VIEW: SETTINGS ---
async function renderSettings(container) {
    try {
        const locations = await getLocations(profile.organization_id);

        const rows = locations.map(l => `
            <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">
                <td class="p-4 font-bold text-gray-900">${l.name}</td>
                <td class="p-4"><span class="badge ${l.type === 'main_store' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} px-2 py-1 rounded-full text-[10px] uppercase font-bold tracking-wide">${l.type.replace('_', ' ')}</span></td>
                <td class="p-4 text-xs text-gray-400 text-right">Edit</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Settings</h1>
                    <p class="text-gray-500 mt-1">Manage camps and stores.</p>
                </div>
                <button onclick="window.modalAddLocation()" class="btn-black px-5 py-3 rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition">
                    + New Location
                </button>
            </div>

            <div class="glass rounded-2xl overflow-hidden fade-in shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50/50 border-b border-gray-100 text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                        <tr><th class="p-4">Location Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No locations found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="text-red-500 p-10 text-center">Failed to load settings.</div>`;
    }
}

// --- MODAL LOGIC ---
window.modalAddLocation = () => {
    const html = `
        <h3 class="text-lg font-bold mb-1">Add Location</h3>
        <p class="text-xs text-gray-500 mb-4">Create a new operational unit.</p>
        <form onsubmit="window.saveLocation(event)">
            <input id="newLocName" placeholder="e.g. Baobab Ruaha Camp" class="input-field w-full p-3 rounded-xl mb-3 text-sm" required>
            <select id="newLocType" class="input-field w-full p-3 rounded-xl mb-4 text-sm bg-white">
                <option value="camp_store">Camp Store</option>
                <option value="main_store">Main Store</option>
                <option value="department">Internal Dept</option>
            </select>
            <button type="submit" class="btn-black w-full py-3 rounded-xl text-sm font-bold">Create Location</button>
            <button type="button" onclick="document.getElementById('modal').classList.add('hidden')" class="w-full mt-2 py-2 text-xs text-gray-400 hover:text-black">Cancel</button>
        </form>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
};

window.saveLocation = async (e) => {
    e.preventDefault();
    const name = document.getElementById('newLocName').value;
    const type = document.getElementById('newLocType').value;
    const btn = e.target.querySelector('button[type="submit"]');

    btn.innerText = 'Saving...'; btn.disabled = true;

    try {
        await createLocation(profile.organization_id, name, type);
        document.getElementById('modal').classList.add('hidden');
        renderSettings(document.getElementById('app-view')); 
    } catch(err) {
        alert("Error: " + err.message);
        btn.innerText = 'Create Location'; btn.disabled = false;
    }
};
