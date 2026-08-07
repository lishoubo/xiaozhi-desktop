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
    getAudioMuted: 'browser:get-audio-muted',
    hide: 'browser:hide',
    list: 'browser:list',
    reload: 'browser:reload',
    requestIntercepted: 'browser:request-intercepted',
    setBounds: 'browser:set-bounds',
    setAudioMuted: 'browser:set-audio-muted',
    stateChanged: 'browser:state-changed',
  },
  calendar: {
    load: 'calendar:load',
    createEvent: 'calendar:create-event',
    updateEvent: 'calendar:update-event',
    deleteEvent: 'calendar:delete-event',
  },
  otaCredential: {
    listByChannel: 'ota-credential:list-by-channel',
    openExisting: 'ota-credential:open-existing',
    openForNewLogin: 'ota-credential:open-for-new-login',
    openWithImportedCookie: 'ota-credential:open-with-imported-cookie',
    discoveryCompleted: 'ota-credential:discovery-completed',
  },
  cookies: {
    import: 'cookies:import',
    listSources: 'cookies:list-sources',
    listImportedChannels: 'cookies:list-imported-channels',
  },
  system: {
    getPreferences: 'system:get-preferences',
    setAutoLaunch: 'system:set-auto-launch',
  },
} as const;
