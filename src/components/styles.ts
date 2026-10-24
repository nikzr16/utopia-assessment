/** Shared Tailwind class strings so buttons and inputs look the same everywhere. */
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60'

export const BUTTON = {
  primary: `${BUTTON_BASE} bg-sky-700 text-white hover:bg-sky-800 focus:ring-sky-300`,
  secondary: `${BUTTON_BASE} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus:ring-slate-300`,
  danger: `${BUTTON_BASE} bg-red-700 text-white hover:bg-red-800 focus:ring-red-300`,
  whatsapp: `${BUTTON_BASE} bg-green-700 text-white hover:bg-green-800 focus:ring-green-300`,
}

export const INPUT =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100'

export const CARD = 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5'

export const LINK = 'font-medium text-sky-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-300'
