import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
const url = req.nextUrl;

// Lire les cookies posés par /auth/callback
const sub = req.cookies.get('subscription_status')?.value;
const userId = req.cookies.get('user_id')?.value;

// Pages qui exigent d'être connecté(e)
const needsAuth = url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/premium');

if (needsAuth && !userId) {
// Non connecté → vers /login
const login = new URL('/login', url);
login.searchParams.set('next', url.pathname);
return NextResponse.redirect(login);
}

// Pages premium : besoin d'un statut actif
if (url.pathname.startsWith('/premium')) {
if (!sub || (sub !== 'active' && sub !== 'trialing')) {
// Ici je laisse 'trialing' passer, adapte selon ta logique
return NextResponse.redirect(new URL('/pricing', url));
}
}

return NextResponse.next();
}

// Active le middleware sur les routes voulues
export const config = {
matcher: ['/dashboard/:path*', '/premium/:path*'],
};