import type { StaffRole } from '../../domain'

/** Example questions shown in a new chat and under an out-of-scope reply, by role. */
export const EXAMPLE_QUESTIONS: Record<StaffRole, string[]> = {
  manager: [
    'How many jobs were completed today?',
    'Which technician completed the most jobs this week?',
    'What jobs did Ali complete last week?',
    'Which jobs are waiting for review?',
  ],
  admin: [
    'How many jobs were completed today?',
    'Which technician completed the most jobs this week?',
    'Which branch completed the most jobs last month?',
    'What is scheduled for tomorrow?',
  ],
  finance: [
    'Which jobs are still unpaid?',
    'How much was collected this week?',
    'Which receipts still need verifying?',
    'How many jobs were completed today?',
  ],
  technician: [
    'How many jobs did I complete this week?',
    'What is scheduled for me tomorrow?',
    'Did I have any returns for rework this month?',
    'What are my ratings this month?',
  ],
}
