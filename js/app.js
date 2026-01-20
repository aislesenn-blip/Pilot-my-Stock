import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation } from './services.js';
import { supabase } from './supabase.js';

let profile = null;

window.onload = async () => {
    // 1. ANGALIA KAMA MTU KA-LOGIN
    const session = await getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    try {
        // 2. JARIBU KUVUTA PROFILE YAKE DATABASE
        profile = await getCurrentProfile(session.user.id);
        
        // --- HAPA NDIPO PENYE DAWA YA KUZUIA KUGANDA ---
        // Kama profile ni NULL (Haipo), mpeleke Setup akaanze upya.
        // Usiruhusu code iendelee chini.
        if (!profile || !profile.organization_id) {
            console.warn("Hakuna Profile! Inaenda Setup...");
            window.location.href = 'setup.html';
            return; 
        }
        // -----------------------------------------------

        // 3. KAMA PROFILE IPO, JAZA UI
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // 4. FUNGUA INVENTORY
        router('inventory');

    } catch (error) {
        console.error("Critical Error:", error);
        // Ikitokea shida yoyote, mtoe nje aanze upya
        logout();
    }
};

// --- ROUTER & VIEWS ---

window.router = async (view) => {
    const app = document.getElementById('app-view');
    // Spinner inaonekana tu wakati wa kuhama page, sio milele
    app.innerHTML = '<div class="flex items-center justify-center h-full"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div></div>';
    
    // Update Menu Icons
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-50', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    if (view === 'inventory') await renderInventory(app);
    if (view === 'settings') await renderSettings(app);
};

// --- INVENTORY VIEW ---
async function renderInventory(container) {
    try {
        const data = await getInventory(profile.organization_id, profile.role === 'manager' ? null : profile.assigned_location_id);
        
        const rows = data.map(i => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-4 font-bold text-gray-900">${i.products?.name || 'Item'}</td>
                <td class="p-4 text-xs text-gray-500">${i.locations?.name || 'Loc'}</td>
                <td class="p-4 font-mono font-medium">${Number(i.quantity).toFixed(2)} ${i.products?.unit || ''}</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Inventory</h1><p class="text-gray-500 text-sm">Real-time stock levels.</p></div>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold">
                        <tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Qty</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No stock found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="p-10 text-center text-red-500">Failed to load inventory.</div>`;
    }
}

// --- SETTINGS VIEW ---
async function renderSettings(container) {
    try {
        const locations = await getLocations(profile.organization_id);

        const rows = locations.map(l => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-4 font-bold text-gray-900">${l.name}</td>
                <td class="p-4"><span class="bg-gray-100 px-2 py-1 rounded text-[10px] uppercase font-bold">${l.type.replace('_', ' ')}</span></td>
                <td class="p-4 text-right text-xs text-gray-400">Edit</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Settings</h1><p class="text-gray-500 text-sm">Manage locations.</p></div>
                <button onclick="window.modalAddLocation()" class="btn-black px-5 py-2 text-sm font-bold shadow">+ Location</button>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold">
                        <tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No locations found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="p-10 text-center text-red-500">Failed to load settings.</div>`;
    }
}

// --- MODAL LOGIC ---
window.modalAddLocation = () => {
    const html = `
        <h3 class="text-lg font-bold mb-2">Add Location</h3>
        <form onsubmit="window.saveLocation(event)">
            <input id="newLocName" placeholder="Location Name" class="input-field w-full p-3 rounded-xl mb-3 text-sm" required>
            <select id="newLocType" class="input-field w-full p-3 rounded-xl mb-4 text-sm bg-white">
                <option value="camp_store">Camp Store</option>
                <option value="main_store">Main Store</option>
                <option value="department">Internal Dept</option>
            </select>
            <button type="submit" class="btn-black w-full py-3 rounded-xl text-sm font-bold">Create</button>
            <button type="button" onclick="document.getElementById('modal').classList.add('hidden')" class="w-full mt-2 py-2 text-xs text-gray-400">Cancel</button>
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
        btn.innerText = 'Create'; btn.disabled = false;
    }
};
