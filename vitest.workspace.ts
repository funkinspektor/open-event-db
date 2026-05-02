import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/api',
  'packages/db',
  'packages/shared',
  'packages/web',
])
