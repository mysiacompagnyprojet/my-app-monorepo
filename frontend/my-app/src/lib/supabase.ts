import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, anon)

//ancien code, d'ici :
//export const supabase = createClient(
//process.env.NEXT_PUBLIC_SUPABASE_URL!,
//process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
//)
// a ici