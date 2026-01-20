import { supabase } from './supabase.js';

// --- PROFILE SERVICES ---

export async function getCurrentProfile(userId) {
    // HAPA NDIPO PENYE FIX: Tunatumia 'maybeSingle()' badala ya 'single()'
    // Hii inazuia error kama profile haipo, na inaruhusu system kukupeleka Setup
    const { data, error } = await supabase
        .from('profiles')
        .select('*, organizations(name), locations(name, type)')
        .eq('id', userId)
        .maybeSingle(); 
    
    if (error) {
        console.error("Profile Error:", error);
        return null;
    }
    return data;
}

export async function createOrganization(name, userId) {
    // 1. Create Organization
    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: name, created_by: userId })
        .select()
        .single();
    
    if (orgError) throw orgError;

    // 2. Update Profile to be Manager
    const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
            organization_id: org.id, 
            role: 'manager' 
        })
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
        .insert({
            organization_id: orgId,
            name: name,
            type: type,
            parent_location_id: parentId
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// --- INVENTORY SERVICES ---

export async function getInventory(orgId, locationId = null) {
    let query = supabase
        .from('inventory')
        .select('*, products(name, unit), locations(name)')
        .eq('organization_id', orgId);

    if (locationId) {
        query = query.eq('location_id', locationId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
}
