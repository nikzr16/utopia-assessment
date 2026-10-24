import {
  FEEDBACK_COMMENT_TOO_LONG_MESSAGE,
  FEEDBACK_RATING_LABELS,
  FEEDBACK_RATING_REQUIRED_MESSAGE,
  FEEDBACK_STATE_MESSAGES,
  FEEDBACK_WORKING_REQUIRED_MESSAGE,
  type FeedbackLinkState,
} from '../../domain'

/**
 * The customer feedback page's own words in English and Malay (PRD 0011
 * Q19, Q19b). Only this page is translated: the answers sent are the same
 * values in both, and messages that come from the database stay as they are.
 * English comes from the domain constants, so it never drifts from the rules.
 */
export type FeedbackLang = 'en' | 'ms'

export const FEEDBACK_LANG_STORAGE_KEY = 'sejuk.feedback.lang'

export interface FeedbackText {
  tagline: string
  language: string
  title: string
  intro: string
  yourJob: string
  order: string
  service: string
  technician: string
  completed: string
  ratingQuestion: string
  ratingLabels: Record<number, string>
  tapAStar: string
  workingQuestion: string
  yes: string
  no: string
  comment: string
  optional: string
  characters: (count: string, max: string) => string
  send: string
  sending: string
  ratingRequired: string
  workingRequired: string
  commentTooLong: string
  answersKept: string
  thanksTitle: string
  thanksBody: string
  loading: string
  loadErrorTitle: string
  tryAgain: string
  receivedTitle: string
  cannotUseTitle: string
  states: Record<Exclude<FeedbackLinkState, 'open'>, string>
  footer: string
}

export const FEEDBACK_TEXT: Record<FeedbackLang, FeedbackText> = {
  en: {
    tagline: 'Customer feedback',
    language: 'Language',
    title: 'How did we do?',
    intro: 'Please check the work and tell us how it went. It takes under a minute.',
    yourJob: 'Your job',
    order: 'Order',
    service: 'Service',
    technician: 'Technician',
    completed: 'Completed',
    ratingQuestion: 'How would you rate the job?',
    ratingLabels: FEEDBACK_RATING_LABELS,
    tapAStar: 'Tap a star',
    workingQuestion: 'Is your aircon working well now?',
    yes: 'Yes',
    no: 'No',
    comment: 'Comment',
    optional: '(optional)',
    characters: (count, max) => `${count} / ${max} characters`,
    send: 'Send feedback',
    sending: 'Sending…',
    ratingRequired: FEEDBACK_RATING_REQUIRED_MESSAGE,
    workingRequired: FEEDBACK_WORKING_REQUIRED_MESSAGE,
    commentTooLong: FEEDBACK_COMMENT_TOO_LONG_MESSAGE,
    answersKept: 'Your answers are kept.',
    thanksTitle: 'Thank you!',
    thanksBody: 'We have received your feedback. It helps us look after you better.',
    loading: 'Loading…',
    loadErrorTitle: 'Could not load the feedback form',
    tryAgain: 'Try again',
    receivedTitle: 'Feedback received',
    cannotUseTitle: 'This link cannot be used',
    states: FEEDBACK_STATE_MESSAGES,
    footer: 'Sejuk Sejuk Service Sdn Bhd · Aircond installation, servicing and repair',
  },
  ms: {
    tagline: 'Maklum balas pelanggan',
    language: 'Bahasa',
    title: 'Bagaimana servis kami?',
    intro: 'Sila semak kerja yang dibuat dan beritahu kami pendapat anda. Ia mengambil masa kurang daripada seminit.',
    yourJob: 'Kerja anda',
    order: 'Pesanan',
    service: 'Servis',
    technician: 'Juruteknik',
    completed: 'Selesai',
    ratingQuestion: 'Apakah penilaian anda untuk kerja ini?',
    ratingLabels: { 1: 'Sangat lemah', 2: 'Lemah', 3: 'Sederhana', 4: 'Baik', 5: 'Cemerlang' },
    tapAStar: 'Sentuh bintang',
    workingQuestion: 'Adakah aircond anda berfungsi dengan baik sekarang?',
    yes: 'Ya',
    no: 'Tidak',
    comment: 'Komen',
    optional: '(pilihan)',
    characters: (count, max) => `${count} / ${max} huruf`,
    send: 'Hantar maklum balas',
    sending: 'Menghantar…',
    ratingRequired: 'Pilih penilaian antara 1 hingga 5 bintang',
    workingRequired: 'Beritahu kami sama ada aircond anda berfungsi dengan baik sekarang',
    commentTooLong: 'Komen tidak boleh melebihi 1,000 huruf',
    answersKept: 'Jawapan anda masih disimpan.',
    thanksTitle: 'Terima kasih!',
    thanksBody: 'Kami telah menerima maklum balas anda. Ia membantu kami memberi perkhidmatan yang lebih baik.',
    loading: 'Memuatkan…',
    loadErrorTitle: 'Borang maklum balas tidak dapat dimuatkan',
    tryAgain: 'Cuba lagi',
    receivedTitle: 'Maklum balas diterima',
    cannotUseTitle: 'Pautan ini tidak boleh digunakan',
    states: {
      submitted: 'Terima kasih, kami telah menerima maklum balas anda untuk kerja ini',
      replaced: 'Pautan maklum balas ini tidak lagi aktif. Kami akan menghantar pautan baharu apabila kerja selesai',
      expired: 'Pautan maklum balas ini telah tamat tempoh (pautan sah selama 7 hari selepas kerja selesai)',
      not_found: 'Pautan maklum balas ini tidak sah. Pastikan anda membuka pautan penuh daripada mesej kami',
    },
    footer: 'Sejuk Sejuk Service Sdn Bhd · Pemasangan, servis dan pembaikan aircond',
  },
}

/** English first; the customer's choice is remembered on their phone. */
export function readFeedbackLang(): FeedbackLang {
  try {
    return window.localStorage.getItem(FEEDBACK_LANG_STORAGE_KEY) === 'ms' ? 'ms' : 'en'
  } catch {
    return 'en'
  }
}

export function saveFeedbackLang(lang: FeedbackLang) {
  try {
    window.localStorage.setItem(FEEDBACK_LANG_STORAGE_KEY, lang)
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** "Kha 22 Okt 2026, 3:15 PTG"-style Malaysia time for the Malay page. */
export function formatMalayDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
