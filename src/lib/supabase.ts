import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False until you create .env.local. The game still runs as a guest in that case. */
export const backendReady = !!url && !!key

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'not-configured')
