import { ROLE_LABELS, type StaffRole } from '../domain'

const ROLE_SUMMARIES: Record<StaffRole, { tagline: string; todo: string[] }> = {
  admin: {
    tagline: 'Runs the order desk for all branches.',
    todo: [
      'Create service orders and assign technicians',
      'Reassign or reschedule orders and cancel them with a reason',
      'Watch every order across branches',
    ],
  },
  manager: {
    tagline: 'Reviews finished work for their branch.',
    todo: [
      'See orders waiting for review',
      'Approve completed jobs or return them for rework with a note',
      'Track branch activity and the weekly summary',
    ],
  },
  technician: {
    tagline: 'Works their own assigned jobs in the field.',
    todo: [
      'See only the jobs assigned to them',
      'Acknowledge, start, and complete jobs with photos and notes',
      'Record customer payments and request reschedules',
    ],
  },
  finance: {
    tagline: 'Confirms payments and closes completed orders.',
    todo: [
      'See reviewed orders awaiting payment confirmation',
      'Record payments and check balances',
      'Close orders once they are fully paid',
    ],
  },
}

export function RoleHome({ role }: { role: StaffRole }) {
  const { tagline, todo } = ROLE_SUMMARIES[role]
  return (
    <section
      aria-labelledby="role-home-title"
      className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="role-home-title" className="text-xl font-semibold">
        {ROLE_LABELS[role]} home
      </h2>
      <p className="mt-1 text-slate-600">{tagline}</p>
      <p className="mt-4 text-sm font-medium text-slate-700">Coming in later modules:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {todo.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
