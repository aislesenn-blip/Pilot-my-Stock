import { supabase } from './supabase.js';

// --- SETUP WIZARD ---
export async function createOrganization(name, userId) {
    // 1. Create Org
    const { data: org, error: orgErr } = await supabase.from('organizations').insert({ name }).select().single();
    if (orgErr) throw orgErr;
    // 2. Link Admin
    await supabase.from('profiles').update({ organization_id: org.id }).eq('id', userId);
    return org;
}

export async function createLocation(orgId, name, type, parentId = null) {
    const { data, error } = await supabase.from('locations').insert({
        organization_id: orgId, name, type, parent_location_id: parentId
    }).select().single();
    if (error) throw error;
    return data;
}

// --- STAFF MANAGEMENT (THE INVITE SYSTEM) ---
export async function inviteStaff(orgId, email, role, locationId) {
    const { error } = await supabase.from('staff_invites').insert({
        organization_id: orgId, email, role, assigned_location_id: locationId
    });
    if (error) throw error;
}

export async function getStaffList(orgId) {
    // Combine Profiles (Active) and Invites (Pending) logic would go here in V2
    // For now, fetching Active Profiles
    const { data, error } = await supabase.from('profiles')
        .select('*, locations(name)')
        .eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

// --- INVENTORY ---
export async function getInventory(orgId, locId) {
    let query = supabase.from('inventory').select('*, products(*), locations(name)').eq('organization_id', orgId);
    if (locId) query = query.eq('location_id', locId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function dispatchStock(orgId, prodId, fromLoc, toLoc, qty, userId) {
    // 1. Audit Log
    await supabase.from('stock_movements').insert({
        organization_id: orgId, product_id: prodId, from_location_id: fromLoc,
        to_location_id: toLoc, quantity: qty, type: 'transfer', performed_by: userId
    });
    // 2. Move Stock
    await updateStock(orgId, fromLoc, prodId, -qty);
    await updateStock(orgId, toLoc, prodId, qty);
}

async function updateStock(orgId, locId, prodId, qty) {
    const { data: exist } = await supabase.from('inventory').select('*').eq('location_id', locId).eq('product_id', prodId).single();
    if (exist) {
        await supabase.from('inventory').update({ quantity: Number(exist.quantity) + Number(qty) }).eq('id', exist.id);
    } else {
        await supabase.from('inventory').insert({ organization_id: orgId, location_id: locId, product_id: prodId, quantity: qty });
    }
}

// --- BAR MODULE (TOTS LOGIC) ---
export async function recordBarSale(orgId, locId, prodId, totsSold, userId) {
    const { data: prod } = await supabase.from('products').select('*').eq('id', prodId).single();
    
    // Logic: Calculate revenue & cost based on bottle fraction
    const bottleFraction = totsSold / prod.tots_per_bottle;
    const revenue = (prod.selling_price / prod.tots_per_bottle) * totsSold;
    const profit = revenue - ((prod.cost_price / prod.tots_per_bottle) * totsSold);

    // 1. Record Sale
    await supabase.from('bar_sales').insert({
        organization_id: orgId, location_id: locId, product_id: prodId,
        tots_sold: totsSold, revenue, gross_profit: profit, sold_by: userId
    });
    
    // 2. Reduce Stock
    await updateStock(orgId, locId, prodId, -bottleFraction);
}

// --- APPROVALS ---
export async function requestAdjustment(orgId, locId, prodId, qty, reason, userId) {
    const { error } = await supabase.from('adjustments').insert({
        organization_id: orgId, location_id: locId, product_id: prodId, quantity: qty, reason, requested_by: userId
    });
    if (error) throw error;
}

export async function approveAdjustment(adjId, adminId) {
    const { data: adj } = await supabase.from('adjustments').select('*').eq('id', adjId).single();
    await updateStock(adj.organization_id, adj.location_id, adj.product_id, adj.quantity);
    await supabase.from('adjustments').update({ status: 'approved', approved_by: adminId }).eq('id', adjId);
}