export const IPC_CHANNELS = {
  auth: {
    currentSession: 'auth:current-session',
    loginWithPhoneCode: 'auth:login-with-phone-code',
    logout: 'auth:logout',
    requestPhoneCode: 'auth:request-phone-code',
  },
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
    discoveryCompleted: 'ota-credential:discovery-completed',
  },
  otaTab: {
    openExisting: 'ota-tab:open-existing',
    openForNewLogin: 'ota-tab:open-for-new-login',
    openWithImportedCookie: 'ota-tab:open-with-imported-cookie',
    openView: 'ota-tab:open-view',
  },
  cookies: {
    import: 'cookies:import',
    listSources: 'cookies:list-sources',
    listImportedChannels: 'cookies:list-imported-channels',
  },
  hotelManagement: {
    load: 'hotel-management:load',
    createHotel: 'hotel-management:create-hotel',
    deleteHotel: 'hotel-management:delete-hotel',
    unbindOtaAccount: 'hotel-management:unbind-ota-account',
  },
  system: {
    getPreferences: 'system:get-preferences',
    setAutoLaunch: 'system:set-auto-launch',
  },
} as const;
