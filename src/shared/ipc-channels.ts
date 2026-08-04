export const IPC_CHANNELS = {
  automation: {
    getCtripCheckIn: 'automation:get-ctrip-check-in',
  },
  browser: {
    acknowledgeInterception: 'browser:acknowledge-interception',
    activate: 'browser:activate',
    close: 'browser:close',
    create: 'browser:create',
    goBack: 'browser:go-back',
    goForward: 'browser:go-forward',
    hide: 'browser:hide',
    list: 'browser:list',
    reload: 'browser:reload',
    requestIntercepted: 'browser:request-intercepted',
    setBounds: 'browser:set-bounds',
    stateChanged: 'browser:state-changed',
  },
  calendar: {
    load: 'calendar:load',
    createEvent: 'calendar:create-event',
    updateEvent: 'calendar:update-event',
    deleteEvent: 'calendar:delete-event',
  },
  otaAccount: {
    startLogin: 'ota-account:start-login',
    listByChannel: 'ota-account:list-by-channel',
    openExisting: 'ota-account:open-existing',
  },
  cookies: {
    import: 'cookies:import',
    listSources: 'cookies:list-sources',
  },
  system: {
    getPreferences: 'system:get-preferences',
    setAutoLaunch: 'system:set-auto-launch',
  },
} as const;
