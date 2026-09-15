import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',

  nav: [
    { text: 'Quick start', link: '/getting-started' },
    { text: 'Capture', link: '/capture/browser' },
    { text: 'Triage', link: '/use/issues-triage' },
    { text: 'Dashboard', link: 'https://bughq.org/dashboard' },
    { text: 'GitHub', link: 'https://github.com/stacksjs/bughq' },
  ],

  markdown: {
    title: 'BugHQ Documentation',
    meta: {
      description: 'Error capture, issue grouping, triage, alerting, Autofix, SDKs, and self-hosting.',
      author: 'BugHQ',
    },
    syntaxHighlightTheme: 'github-dark',
    toc: {
      enabled: true,
      minDepth: 2,
      maxDepth: 3,
    },
    sidebar: {
      '/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is BugHQ', link: '/introduction' },
            { text: 'Quick start', link: '/getting-started' },
          ],
        },
        {
          text: 'Capture errors',
          items: [
            { text: 'Browser SDK', link: '/capture/browser' },
            { text: 'Stacks and stx', link: '/capture/stacks-stx' },
            { text: 'Vue and Nuxt', link: '/capture/vue-nuxt' },
            { text: 'PHP and Laravel', link: '/capture/php-laravel' },
          ],
        },
        {
          text: 'Investigate and respond',
          items: [
            { text: 'Issues and triage', link: '/use/issues-triage' },
            { text: 'Context and breadcrumbs', link: '/use/context-breadcrumbs' },
            { text: 'Releases and alerts', link: '/use/releases-alerts' },
            { text: 'AI Autofix', link: '/use/autofix' },
          ],
        },
        {
          text: 'Manage',
          items: [
            { text: 'Projects and teams', link: '/manage/projects-teams' },
            { text: 'SDK security', link: '/manage/sdk-security' },
            { text: 'Self-hosting', link: '/self-hosting' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'HTTP API', link: '/reference/api' },
            { text: 'Configuration and CLI', link: '/reference/configuration-cli' },
          ],
        },
      ],
    },
  },

  themeConfig: {
    darkMode: 'auto',
    footer: {
      message: 'Open source error tracking, released under the MIT License.',
      copyright: 'Copyright 2026-present BugHQ',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/stacksjs/bughq' },
    ],
  },

  sitemap: {
    enabled: true,
    baseUrl: 'https://bughq.org/docs',
  },

  robots: {
    enabled: true,
  },
}

export default config
