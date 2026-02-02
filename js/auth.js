import { supabase } from './supabase.js';

// Helper for error handling
const handleError = (error, context) => {
    console.error(`[${context}] Full Error:`, error);
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(error.message || JSON.stringify(error), "error");
    }
};

export async function login(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    } catch (error) {
        handleError(error, "Login");
        throw error;
    }
}

export async function register(email, password, fullName) {
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName
                }
            }
        });
        if (error) throw error;
        return data;
    } catch (error) {
        handleError(error, "Register");
        throw error;
    }
}

export async function logout() {
    try {
        localStorage.clear(); // Safisha data za browser
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        window.location.href = 'index.html';
    } catch (error) {
        handleError(error, "Logout");
        // Force redirect anyway in case of network error, to avoid being stuck
        window.location.href = 'index.html';
    }
}

export async function getSession() {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const session = data?.session;

        if (!session) {
            // Usi-redirect hapa, rudisha null ili app.js iamue
            return null;
        }
        return session;
    } catch (error) {
        handleError(error, "Get Session");
        return null;
    }
}

export async function getCurrentProfile(userId) {
    try {
        // FIX KUBWA HAPA: Tunatumia 'maybeSingle()' badala ya 'single()'
        // Hii inazuia ERROR ya "Row not found" kugandisha mfumo
        const { data, error } = await supabase
            .from('profiles')
            .select('*, organizations(name), locations(name, type)')
            .eq('id', userId)
            .maybeSingle();

        // Kama kuna error yoyote, irushe
        if (error) throw error;

        return data; // Hii itarudisha 'null' kama profile haipo (ambayo ni sawa)
    } catch (error) {
        handleError(error, "Profile Fetch");
        return null;
    }
}
