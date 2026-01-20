import { supabase } from './supabase.js';

// --- PROFILE & AUTH ---
export async function getCurrentProfile(userId) {
    const { data, error } = await supabase.from('profiles').select('*, organizations(name), locations(name, type)').eq('id', userId).maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
}

export async function createOrganization(name, userId) {
    const { data: org, error: orgError } = await supabase.from('organizations').insert({ name, created_by: userId }).select().single();
    if (orgError) throw orgError;
    const { error: profError } = await supabase.from('profiles').update({ organization_id: org.id, role: 'manager' }).eq('id', userId);
    if (profError) throw profError;
    return org;
}

// --- LOCATIONS ---
export async function getLocations(orgId) {
    const { data, error } = await supabase.from('locations').select('*').eq('organization_id', orgId).order('created_at', { ascending: true });
    if (error) throw error;
    return data;
}

export async function createLocation(orgId, name, type, parentId = null) {
    const { data, error } = await supabase.from('locations').insert({ organization_id: orgId, name, type, parent_location_id: parentId }).select().single();
    if (error) throw error;
    return data;
}

export async function updateLocation(locId, updates) {
    const { data, error } = await supabase.from('locations').update(updates).eq('id', locId).select().single();
    if (error) throw error;
    return data;
}

// --- INVENTORY & TRANSFERS ---
export async function getInventory(orgId, locationId = null) {
    let query = supabase.from('inventory').select('*, products(name, unit, selling_price), locations(name)').eq('organization_id', orgId);
    if (locationId) query = query.eq('location_id', locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

// HII HAPA LOGIC MPYA YA KUHAMISHA MZIGO (ARUSHA -> KAMBI)
export async function transferStock(productId, fromLocId, toLocId, qty, userId, orgId) {
    // 1. Check Source Stock
    const { data: source, error: e1 } = await supabase.from('inventory').select('id, quantity').eq('location_id', fromLocId).eq('product_id', productId).single();
    if(!source || source.quantity < qty) throw new Error("Stock haitoshi kwenye chanzo!");

    // 2. Deduct Source
    await supabase.from('inventory').update({ quantity: source.quantity - qty }).eq('id', source.id);

    // 3. Add to Destination
    const { data: dest } = await supabase.from('inventory').select('id, quantity').eq('location_id', toLocId).eq('product_id', productId).maybeSingle();
    if (dest) {
        await supabase.from('inventory').update({ quantity: dest.quantity + Number(qty) }).eq('id', dest.id);
    } else {
        await supabase.from('inventory').insert({ organization_id: orgId, location_id: toLocId, product_id: productId, quantity: qty });
    }

    // 4. Audit Trail
    await supabase.from('stock_movements').insert({ organization_id: orgId, product_id: productId, from_location_id: fromLocId, to_location_id: toLocId, quantity: qty, type: 'transfer', performed_by: userId });
    return true;
}

// --- BAR & POS ---
export async function processBarSale(orgId, locationId, cartItems, userId) {
    const salesData = cartItems.map(item => ({
        organization_id: orgId, location_id: locationId, product_id: item.product_id, tots_sold: item.qty, revenue: item.price * item.qty, sold_by: userId
    }));
    const { error: salesError } = await supabase.from('bar_sales').insert(salesData);
    if (salesError) throw salesError;

    for (const item of cartItems) {
        const { data: stock } = await supabase.from('inventory').select('id, quantity').eq('location_id', locationId).eq('product_id', item.product_id).single();
        if (stock) await supabase.from('inventory').update({ quantity: stock.quantity - item.qty }).eq('id', stock.id);
    }
    return true;
}

// --- STAFF ---
export async function getStaff(orgId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

export async function inviteStaff(email, role, orgId) {
    const { data, error } = await supabase.from('staff_invites').insert({ email, role, organization_id: orgId, status: 'pending' }).select().single();
    if (error) throw error;
    return data;
}

// --- APPROVALS ---
export async function getPendingApprovals(orgId) {
    const { data, error } = await supabase.from('adjustments').select('*, products(name), profiles:requested_by(full_name)').eq('organization_id', orgId).eq('status', 'pending');
    if (error) throw error;
    return data;
}

export async function respondToApproval(id, status, userId) {
    const { data, error } = await supabase.from('adjustments').update({ status, approved_by: userId }).eq('id', id).select().single();
    if (error) throw error;
    return data;
}
