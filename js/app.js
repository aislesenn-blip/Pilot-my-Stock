import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, dispatchStock, recordBarSale, requestAdjustment, approveAdjustment, inviteStaff, getStaffList } from './services.js';
import { supabase } from './supabase.js';
import { formatCurrency, formatDate } from './utils.js';

let profile = null;

// --- INITIALIZATION ---
window.onload = async () => {
    const session = await getSession();
    profile = await getCurrentProfile(session.user.id);
    
    if(!profile) window.location.href = 'setup.html';

    // UI Bindings
    document.getElementById('userName').innerText = profile.full_name;
    document.getElementById('userRole').innerText = profile.role;
    document.getElementById('avatar').innerText = profile.full_name.charAt(0);
    window.logoutAction = logout;

    renderMenu();
    router('inventory'); // Default
};

// --- NAVIGATION ---
function renderMenu() {
    const items = [
        { id: 'inventory', label: 'Inventory', icon: '📦', roles: ['admin', 'storekeeper', 'finance', 'super_admin'] },
        { id: 'bar', label: 'Bar & POS', icon: '🍸', roles: ['admin', 'barman', 'super_admin'] },
        { id: 'approvals', label: 'Approvals', icon: '✅', roles: ['admin', 'finance', 'super_admin'] },
        { id: 'staff', label: 'Team', icon: '👥', roles: ['admin', 'super_admin'] },
    ];

    const allowed = items.filter(i => i.roles.includes(profile.role));
    
    // Render Desktop
    document.getElementById('menu').innerHTML = allowed.map(i => `
        <button onclick="window.router('${i.id}')" class="w-full text-left px-4 py-3 rounded-xl text-gray-500 hover:bg-gray-50 hover:text-black flex gap-3 transition mb-1 nav-item" id="nav-${i.id}">
            <span>${i.icon}</span> <span class="font-medium">${i.label}</span>
        </button>
    `).join('');

    // Render Mobile
    document.getElementById('mobileMenuLinks').innerHTML = allowed.map(i => `
        <button onclick="window.router('${i.id}'); document.getElementById('mobileMenu').classList.add('hidden')" class="w-full text-left text-lg font-medium py-2 border-b border-gray-100">
            ${i.icon} ${i.label}
        </button>
    `).join('');
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    // Highlight Nav
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active', 'bg-white', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('active');

    app.innerHTML = '<div class="opacity-50 text-center mt-20">Loading...</div>';

    if (view === 'inventory') await renderInventory(app);
    if (view === 'bar') await renderBar(app);
    if (view === 'staff') await renderStaff(app);
    if (view === 'approvals') await renderApprovals(app);
};

// --- VIEW: INVENTORY ---
async function renderInventory(container) {
    const data = await getInventory(profile.organization_id, profile.role === 'super_admin' ? null : profile.assigned_location_id);
    
    const rows = data.map(i => `
        <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">
            <td class="p-4 font-bold text-gray-900">${i.products.name}</td>
            <td class="p-4 text-gray-500 text-xs">${i.locations.name}</td>
            <td class="p-4 font-mono">${Number(i.quantity).toFixed(2)} ${i.products.unit}</td>
            <td class="p-4 text-right">
                <button onclick="window.modalDispatch('${i.product_id}', '${i.location_id}')" class="btn-primary px-4 py-2 rounded-lg text-xs">Dispatch</button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="flex justify-between items-end mb-8 fade-in">
            <div>
                <h1 class="text-2xl font-bold tracking-tight">Inventory</h1>
                <p class="text-gray-500 mt-1">Live stock levels.</p>
            </div>
            <div class="bg-white px-4 py-2 rounded-lg border text-xs font-bold">${profile.locations?.name || 'All Locations'}</div>
        </div>
        <div class="glass rounded-2xl overflow-hidden fade-in shadow-sm">
            <table class="w-full text-left">
                <thead class="bg-gray-50/50 border-b border-gray-100 text-xs uppercase text-gray-400 font-bold">
                    <tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Qty</th><th class="p-4 text-right">Actions</th></tr>
                </thead>
                <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-8 text-center text-gray-400">No stock found.</td></tr>'}</tbody>
            </table>
        </div>
    `;
}

// --- VIEW: STAFF (THE INVITE SYSTEM) ---
async function renderStaff(container) {
    const staff = await getStaffList(profile.organization_id);
    
    const rows = staff.map(s => `
        <tr class="border-b border-gray-100 last:border-0">
            <td class="p-4 font-bold">${s.full_name}</td>
            <td class="p-4 text-gray-500">${s.email}</td>
            <td class="p-4"><span class="badge badge-success uppercase">${s.role}</span></td>
            <td class="p-4 text-sm">${s.locations?.name || 'HQ'}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="flex justify-between items-center mb-8 fade-in">
            <h1 class="text-2xl font-bold tracking-tight">Team Access</h1>
            <button onclick="window.modalInvite()" class="btn-primary px-5 py-2.5 rounded-xl text-sm font-medium">Invite User</button>
        </div>
        <div class="glass rounded-2xl overflow-hidden fade-in shadow-sm">
            <table class="w-full text-left">
                <thead class="bg-gray-50/50 border-b border-gray-100 text-xs uppercase text-gray-400 font-bold">
                    <tr><th class="p-4">Name</th><th class="p-4">Email</th><th class="p-4">Role</th><th class="p-4">Location</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// --- VIEW: BAR POS ---
async function renderBar(container) {
    // Logic to fetch bar items...
    container.innerHTML = `<div class="text-center mt-20 text-gray-400">Bar Module Loaded. (Select location to start sale)</div>`;
}
async function renderApprovals(container) {
    container.innerHTML = `<div class="text-center mt-20 text-gray-400">No Pending Approvals</div>`;
}

// --- MODALS (INTERACTIVE) ---
window.modalInvite = async () => {
    // Fetch locations to populate select
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    const locOptions = locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

    const html = `
        <h3 class="text-lg font-bold mb-4">Invite Team Member</h3>
        <input id="invEmail" placeholder="Email Address" class="input-field w-full p-3 rounded-xl mb-3">
        <select id="invRole" class="input-field w-full p-3 rounded-xl mb-3">
            <option value="storekeeper">Storekeeper</option>
            <option value="barman">Bar Manager</option>
            <option value="finance">Finance / Auditor</option>
        </select>
        <select id="invLoc" class="input-field w-full p-3 rounded-xl mb-4">${locOptions}</select>
        <button onclick="window.sendInvite()" class="btn-primary w-full py-3 rounded-xl">Send Access Invite</button>
        <button onclick="document.getElementById('modal').classList.add('hidden')" class="w-full mt-3 text-gray-400 text-xs">Cancel</button>
    `;
    
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
}

window.sendInvite = async () => {
    const email = document.getElementById('invEmail').value;
    const role = document.getElementById('invRole').value;
    const locId = document.getElementById('invLoc').value;

    try {
        await inviteStaff(profile.organization_id, email, role, locId);
        alert(`Invite sent to ${email}. Ask them to Sign Up to accept.`);
        document.getElementById('modal').classList.add('hidden');
        router('staff');
    } catch(e) { alert(e.message); }
}

window.modalDispatch = (prodId, fromLoc) => {
    // Dispatch logic UI...
    alert("Dispatch Feature ready for deployment.");
}