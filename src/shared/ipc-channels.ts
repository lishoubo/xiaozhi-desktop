export const IPC_CHANNELS = {
  browser: {
    activate: 'browser:activate',
    close: 'browser:close',
    create: 'browser:create',
    goBack: 'browser:go-back',
    goForward: 'browser:go-forward',
    hide: 'browser:hide',
    list: 'browser:list',
    reload: 'browser:reload',
    setBounds: 'browser:set-bounds',
    stateChanged: 'browser:state-changed',
  },
  cookies: {
    import: 'cookies:import',
    listSources: 'cookies:list-sources',
  },
  settings: {
    delete: 'settings:delete',
    get: 'settings:get',
    list: 'settings:list',
    set: 'settings:set',
  },
  system: {
    getPreferences: 'system:get-preferences',
    setAutoLaunch: 'system:set-auto-launch',
  },
} as const;
