import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Cookies posés par /auth/callback
  const userId = req.cookies.get('user_id')?.value || '';
  const sub = (req.cookies.get('subscription_status')?.value || '').toLowerCase();

  // === 1) Définis tes zones protégées (garde ton comportement actuel) ===
  const needsAuth =
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/premium')
    // Décommente quand tu voudras protéger ces sections :
    // || url.pathname.startsWith('/recipes')
    // || url.pathname.startsWith('/shopping-list')
    // || url.pathname.startsWith('/import')
    // || url.pathname.startsWith('/billing/checkout')
  ;

  // === 2) Non connecté → /login (on garde ta logique) ===
  if (needsAuth && !userId) {
    const login = new URL('/login', url);
    login.searchParams.set('next', url.pathname);
    return NextResponse.redirect(login);
  }

  // === 3) Pages premium : besoin d'un statut actif (tu laisses 'trialing' passer) ===
  if (url.pathname.startsWith('/premium')) {
    if (!sub || (sub !== 'active' && sub !== 'trialing')) {
      return NextResponse.redirect(new URL('/pricing', url));
    }
  }

  return NextResponse.next();
}

// === 4) Matcher : garde le tien, avec option d’extension prête ===
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/premium/:path*',
    // Ajoute quand tu seras prête :
    // '/recipes/:path*',
    // '/shopping-list/:path*',
    // '/import/:path*',
    // '/billing/:path*',
  ],
};
