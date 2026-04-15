import { updateSession } from '@/lib/supabase/proxy';
import { type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files — CSS, JS, fonts)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - image files (.svg .png .jpg .jpeg .gif .webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
