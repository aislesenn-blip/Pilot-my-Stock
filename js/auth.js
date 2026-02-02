import { supabase } from './supabase.js';

export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function register(email, password, fullName) {
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
}

export async function logout() {
    localStorage.clear(); // Safisha data za browser
    await supabase.auth.signOut();
    window.location.href = 'index.html';
}

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        // Usi-redirect hapa, rudisha null ili app.js iamue
        return null;
    }
    return session;
}

export async function getCurrentProfile(userId) {
    // FIX KUBWA HAPA: Tunatumia 'maybeSingle()' badala ya 'single()'
    // Hii inazuia ERROR ya "Row not found" kugandisha mfumo
    const { data, error } = await supabase
        .from('profiles')
        .select('*, organizations(name), locations(name, type)')
        .eq('id', userId)
        .maybeSingle();

    // Kama kuna error yoyote, irushe
    if (error) {
        console.error("Profile Fetch Error:", error);
        return null;
    }

    return data; // Hii itarudisha 'null' kama profile haipo (ambayo ni sawa)
}
