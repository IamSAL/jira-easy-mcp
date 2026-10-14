import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    env: {
      JIRA_BASE_URL: 'https://jira.example.com',
      JIRA_USERNAME: 'test-user',
      JIRA_PASSWORD: 'test-pass',
      JIRA_LOG_LEVEL: 'ERROR',
    },
  },
});
