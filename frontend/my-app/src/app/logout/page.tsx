'use client';
import { supabase } from '../../lib/supabase';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
const router = useRouter();

useEffect(() => {
(async () => {
await supabase.auth.signOut();
// Effacer nos cookies
document.cookie = 'user_id=; path=/; max-age=0';
document.cookie = 'subscription_status=; path=/; max-age=0';
router.replace('/login');
})();
}, [router]);

return <p>Déconnexion…</p>;
}