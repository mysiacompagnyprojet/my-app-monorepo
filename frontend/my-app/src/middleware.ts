// frontend/my-app/src/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
 const url = req.nextUrl
 const path = url.pathname

 // Cookies posés par /auth/callback
 const userId = req.cookies.get('user_id')?.value || ''

 // Seule la zone dashboard reste protégée
 const needsAuth = path.startsWith('/dashboard')

 if (needsAuth && !userId) {
   const login = new URL('/login', url)
   login.searchParams.set('next', path)
   return NextResponse.redirect(login)
 }

 return NextResponse.next()
}

export const config = {
 matcher: ['/dashboard/:path*'],
}
