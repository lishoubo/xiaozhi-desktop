export const IPC_CHANNELS = {
  agent: {
    capabilities: 'agent:capabilities',
    quickActions: 'agent:quick-actions',
    listConversations: 'agent:list-conversations',
    createConversation: 'agent:create-conversation',
    getConversation: 'agent:get-conversation',
    deleteConversation: 'agent:delete-conversation',
    clearConversations: 'agent:clear-conversations',
    startRun: 'agent:start-run',
    retryRun: 'agent:retry-run',
    submitClarification: 'agent:submit-clarification',
    cancelBusinessExecution: 'agent:cancel-business-execution',
    resumeRun: 'agent:resume-run',
    cancelRun: 'agent:cancel-run',
    streamEvent: 'agent:stream-event',
  },
  auth: {
    currentSession: 'auth:current-session',
    loginWithPhoneCode: 'auth:login-with-phone-code',
    logout: 'auth:logout',
    requestPhoneCode: 'auth:request-phone-code',
  },
  staffAuth: {
    currentSession: 'staff-auth:current-session',
    login: 'staff-auth:login',
    loginWithPhoneCode: 'staff-auth:login-with-phone-code',
    logout: 'staff-auth:logout',
    requestPhoneCode: 'staff-auth:request-phone-code',
  },
  browser: {
    activate: 'browser:activate',
    close: 'browser:close',
    goBack: 'browser:go-back',
    goForward: 'browser:go-forward',
    getAudioMuted: 'browser:get-audio-muted',
    hide: 'browser:hide',
    list: 'browser:list',
    reload: 'browser:reload',
    setBounds: 'browser:set-bounds',
    setAudioMuted: 'browser:set-audio-muted',
    setViewportVisible: 'browser:set-viewport-visible',
    stateChanged: 'browser:state-changed',
    /**
     * 主进程创建了一个界面尚不知情的标签页（网页自身 `window.open`）。
     * 界面收到后走与其他入口相同的收尾流程，主进程不代劳激活——代劳会让新视图
     * 拿不到当前视口尺寸，表现为「标题变了但看不见内容」。
     */
    tabOpened: 'browser:tab-opened',
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
    openExistingForBinding: 'ota-tab:open-existing-for-binding',
    openForNewLogin: 'ota-tab:open-for-new-login',
    openWithImportedCookie: 'ota-tab:open-with-imported-cookie',
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
    startBinding: 'hotel-management:start-binding',
    confirmBinding: 'hotel-management:confirm-binding',
    confirmBackfillHotel: 'hotel-management:confirm-backfill-hotel',
    startReauth: 'hotel-management:start-reauth',
    confirmReauth: 'hotel-management:confirm-reauth',
    findCredentialForAccount: 'hotel-management:find-credential-for-account',
  },
  uiWaitingResult: {
    delivered: 'ui-waiting-result:delivered',
  },
  system: {
    getPreferences: 'system:get-preferences',
    setAutoLaunch: 'system:set-auto-launch',
    openLogsDirectory: 'system:open-logs-directory',
  },
} as const;
