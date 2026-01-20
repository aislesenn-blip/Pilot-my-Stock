import { supabase } from './supabase.js';

// --- PROFILE & AUTH SERVICES ---

export async function getCurrentProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*, organizations(name), locations(name, type)')
        .eq('id', userId)
        .maybeSingle(); 
    
    if (error) { console.error("Profile Error:", error); return null; }
    return data;
}

export async function createOrganization(name, userId) {
    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: name, created_by: userId })
        .select()
        .single();
    
    if (orgError) throw orgError;

    const { error: profileError } = await supabase
        .from('profiles')
        .update({ organization_id: org.id, role: 'manager' })
        .eq('id', userId);

    if (profileError) throw profileError;
    return org;
}

// --- LOCATION SERVICES ---

export async function getLocations(orgId) {
    const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
}

export async function createLocation(orgId, name, type, parentId = null) {
    const { data, error } = await supabase
        .from('locations')
        .insert({ organization_id: orgId, name: name, type: type, parent_location_id: parentId })
        .select().single();
    if (error) throw error;
    return data;
}

export async function updateLocation(locId, updates) {
    const { data, error } = await supabase
        .from('locations')
        .update(updates)
        .eq('id', locId)
        .select().single();
    if (error) throw error;
    return data;
}

// --- INVENTORY SERVICES ---

export async function getInventory(orgId, locationId = null) {
    let query = supabase.from('inventory')
        .select('*, products(name, unit, selling_price, is_bar_item), locations(name)')
        .eq('organization_id', orgId);

    if (locationId) query = query.eq('location_id', locationId);

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

// --- BAR & POS SERVICES (MPYA) ---

export async function processBarSale(orgId, locationId, cartItems, userId) {
    // 1. Rekodi Mauzo (Sales Record)
    // Kwa urahisi, tunarekodi kila item kama sale
    const salesData = cartItems.map(item => ({
        organization_id: orgId,
        location_id: locationId,
        product_id: item.product_id,
        tots_sold: item.qty,
        revenue: item.price * item.qty,
        sold_by: userId
    }));

    const { error: salesError } = await supabase.from('bar_sales').insert(salesData);
    if (salesError) throw salesError;

    // 2. Punguza Stock (Deduct Inventory)
    for (const item of cartItems) {
        // Hapa tunatumia RPC (Database Function) au Logic ya kawaida.
        // Kwa sasa tunafanya logic ya kawaida ya kupunguza quantity.
        const { data: currentStock } = await supabase
            .from('inventory')
            .select('quantity, id')
            .eq('location_id', locationId)
            .eq('product_id', item.product_id)
            .single();

        if (currentStock) {
            const newQty = currentStock.quantity - item.qty;
            await supabase.from('inventory').update({ quantity: newQty }).eq('id', currentStock.id);
        }
    }
    return true;
}

// --- STAFF SERVICES (MPYA) ---

export async function getStaff(orgId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

export async function inviteStaff(email, role, locationId, orgId) {
    // Hii inaingiza kwenye table ya invites
    const { data, error } = await supabase
        .from('staff_invites')
        .insert({
            email: email,
            role: role,
            assigned_location_id: locationId,
            organization_id: orgId,
            status: 'pending'
        })
        .select().single();
    if (error) throw error;
    return data;
}

// --- APPROVALS SERVICES (MPYA) ---

export async function getPendingApprovals(orgId) {
    const { data, error } = await supabase
        .from('adjustments')
        .select('*, products(name), locations(name), profiles:requested_by(full_name)')
        .eq('organization_id', orgId)
        .eq('status', 'pending');
    if (error) throw error;
    return data;
}

export async function respondToApproval(adjustmentId, status, userId) {
    const { data, error } = await supabase
        .from('adjustments')
        .update({ status: status, approved_by: userId })
        .eq('id', adjustmentId)
        .select().single();
    
    // NOTE: Ikiwa 'approved', inabidi tu-update inventory pia (Logic hii itaongezwa V2 kwa usalama)
    // Kwa sasa tunabadilisha status tu.
    
    if (error) throw error;
    return data;
}
