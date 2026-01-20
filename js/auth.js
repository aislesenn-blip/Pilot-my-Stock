import { supabase } from './supabase.js';

export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function register(email, password, fullName) {
    // This triggers the 'handle_new_user' DB function
    const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    return data;
}

export async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
}

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return null; }
    return session;
}

export async function getCurrentProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*, organizations(name), locations(name, type)')
        .eq('id', userId)
        .single();
    if (error && error.code === 'PGRST116') return null;
    return data;
}