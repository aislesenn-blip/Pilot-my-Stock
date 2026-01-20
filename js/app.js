import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation } from './services.js';
import { supabase } from './supabase.js';

let profile = null;

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        profile = await getCurrentProfile(session.user.id);
        
        // Anti-Freeze Logic: Kama profile haipo, nenda setup
        if (!profile || !profile.organization_id) {
            window.location.href = 'setup.html';
            return; 
        }

        // Jaza UI Data
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // MOBILE MENU LISTENER (Hii inafanya hamburger ifanye kazi)
        const menuBtn = document.getElementById('mobile-menu-btn');
        if(menuBtn) {
            menuBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.toggle('hidden');
                sidebar.classList.toggle('absolute');
                sidebar.classList.toggle('inset-0');
                sidebar.classList.toggle('bg-white');
                sidebar.classList.toggle('z-50');
                sidebar.classList.toggle('w-full');
            });
        }
        
        // Funga sidebar ukibonyeza X (kwa mobile)
        const closeBtn = document.getElementById('close-sidebar');
        if(closeBtn) {
            closeBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.add('hidden');
                sidebar.classList.remove('absolute', 'inset-0', 'bg-white', 'z-50', 'w-full');
            });
        }

        // Fungua Inventory kama default
        router('inventory');

    } catch (error) {
        console.error("Critical Error:", error);
        logout();
    }
};

window.router = async (view) => {
    const app = document.getElementById('app-view');
    // Spinner ya muda mfupi wakati unahama page
    app.innerHTML = '<div class="flex items-center justify-center h-full"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div></div>';
    
    // Highlight Menu Item
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-50', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    // Routing Logic
    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderPlaceholder(app, 'Bar & POS', 'Point of Sale System Active.');
    else if (view === 'staff') await renderPlaceholder(app, 'Team Access', 'Manage user roles and permissions.');
    else if (view === 'approvals') await renderPlaceholder(app, 'Approvals', 'Pending requests require your attention.');
};

// --- VIEW GENERATORS ---

async function renderInventory(container) {
    try {
        const data = await getInventory(profile.organization_id);
        
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
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Qty</th></tr></thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No stock found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading inventory.</div>`; }
}

async function renderSettings(container) {
    try {
        const locations = await getLocations(profile.organization_id);
        
        // EDIT BUTTON LOGIC: Sasa inaita window.modalEditLocation
        const rows = locations.map(l => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-4 font-bold text-gray-900">${l.name}</td>
                <td class="p-4"><span class="bg-gray-100 px-2 py-1 rounded text-[10px] uppercase font-bold">${l.type.replace('_', ' ')}</span></td>
                <td class="p-4 text-right">
                    <button onclick="window.modalEditLocation('${l.id}', '${l.name}', '${l.type}')" class="text-xs font-bold text-gray-400 hover:text-black hover:underline">Edit</button>
                </td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Settings</h1><p class="text-gray-500 text-sm">Manage locations.</p></div>
                <button onclick="window.modalAddLocation()" class="btn-black px-5 py-2 text-sm font-bold shadow">+ Location</button>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr></thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No locations found.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading settings.</div>`; }
}

async function renderPlaceholder(container, title, subtitle) {
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-[60vh] text-center fade-in">
            <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            </div>
            <h1 class="text-xl font-bold text-gray-900">${title}</h1>
            <p class="text-gray-500 text-sm mt-1 max-w-xs">${subtitle}</p>
        </div>
    `;
}

// --- MODAL LOGIC (ADD & EDIT) ---

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

window.modalEditLocation = (id, currentName, currentType) => {
    const html = `
        <h3 class="text-lg font-bold mb-2">Edit Location</h3>
        <form onsubmit="window.submitEditLocation(event, '${id}')">
            <input id="editLocName" value="${currentName}" class="input-field w-full p-3 rounded-xl mb-3 text-sm" required>
            <select id="editLocType" class="input-field w-full p-3 rounded-xl mb-4 text-sm bg-white">
                <option value="camp_store" ${currentType === 'camp_store' ? 'selected' : ''}>Camp Store</option>
                <option value="main_store" ${currentType === 'main_store' ? 'selected' : ''}>Main Store</option>
                <option value="department" ${currentType === 'department' ? 'selected' : ''}>Internal Dept</option>
            </select>
            <button type="submit" class="btn-black w-full py-3 rounded-xl text-sm font-bold">Update Location</button>
            <button type="button" onclick="document.getElementById('modal').classList.add('hidden')" class="w-full mt-2 py-2 text-xs text-gray-400">Cancel</button>
        </form>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
};

window.saveLocation = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.innerText = 'Saving...'; btn.disabled = true;
    try {
        await createLocation(profile.organization_id, document.getElementById('newLocName').value, document.getElementById('newLocType').value);
        document.getElementById('modal').classList.add('hidden');
        renderSettings(document.getElementById('app-view'));
    } catch(err) { alert(err.message); btn.disabled = false; btn.innerText = 'Create'; }
};

window.submitEditLocation = async (e, id) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.innerText = 'Updating...'; btn.disabled = true;
    try {
        await updateLocation(id, {
            name: document.getElementById('editLocName').value,
            type: document.getElementById('editLocType').value
        });
        document.getElementById('modal').classList.add('hidden');
        renderSettings(document.getElementById('app-view'));
    } catch(err) { alert(err.message); btn.disabled = false; btn.innerText = 'Update Location'; }
};
